# Effect OTel: tracing, metrics and logs

## Problem

Operators and engineers cannot see request latency, failures or job delivery across the API and the balance-monitor worker.

- Logs are unstructured. Pino-pretty at debug level was hard-coded for every environment before the Effect HTTP migration, and Effect logs went to the default console logger.
- There are no spans or metrics.
- `traceId` in error responses is a random UUID that links to nothing.

Today they rely on console output and the error body alone.

## Scope

- **In scope:**
  - OTLP export of traces, metrics and logs for the API and the worker.
  - Deep spans on public service and repository methods, plus Valkey and webhook spans.
  - Two domain metrics (`ledger_transactions_posted`, `idempotency_claims`), plus effect-mq's existing job metrics.
  - A real trace id in the `traceId` field of error responses.
  - JSON console logs in production.
- **Out of scope:**
  - Node runtime metrics (heap, event loop).
  - gRPC export.
  - In-process sampling (done in the collector).
  - The `monitor-jobs` CLI.
  - Sending `traceparent` to customer webhooks.
- **Prerequisite:** `feat/effect-http` (the Fastify to Effect HTTP migration). This spec was written against commit `cabf6af`. It does not instrument Fastify.

## User Stories

All are priority **must**.

- US-1: As an operator, I want to enable export with the standard `OTEL_*` environment variables, so that the API and worker send traces, metrics and logs to my collector.
  - Given the variables are unset, when the process runs, then nothing is exported and nothing errors.
  - Given the collector is down, when requests arrive, then no request fails or slows because of telemetry.
- US-2: As an engineer, I want to follow a request through the system, so that I can find where time and errors come from.
  - Given a request, when I open its trace, then I see HTTP server span, `Service.method`, `Repo.method` and `sql.*` spans, plus Valkey client spans.
  - Spans carry `organization.id` and `ledger.id`.
  - A failed span has error status and the error's class.
- US-3: As an API client or support engineer, I want the `traceId` in an error response to be the request's trace id, so that I can find the trace for a reported error.
- US-4: As an engineer, I want a trace to continue from the request through the queue to delivery, so that I can see why a webhook was slow or failed.
  - Given a request enqueues a balance-monitor job, when the worker runs it, then the run span is a child of the enqueue span and contains a `webhook.deliver` client span.
  - No `traceparent` header is sent to customer webhook endpoints, so internal trace ids do not leak.
- US-5: As an operator, I want structured logs that carry `traceId` and `spanId`, so that I can pivot from a log line to its trace.
  - Console output is JSON in production and pretty otherwise. Logs also go out over OTLP when configured.
- US-6: As an operator, I want domain metrics, so that I can alert on posting volume, idempotency behaviour and job health.
  - `ledger_transactions_posted{path=create|post|settlement}`.
  - `idempotency_claims{outcome=new|replay|pending|unavailable}`.
  - effect-mq's `effect_mq_*` metrics.
  - Organisation and ledger ids are never metric attributes, which keeps series cardinality bounded.

**Attribute policy:** ids are allowed on spans. Amounts, metadata, webhook URLs or secrets, JWTs and SQL parameters never go on spans or metrics.

## Constraints

- Uses only the `effect` 4.0.0-rc.112 built-ins (`effect/unstable/observability`); no `@opentelemetry/*` packages.
- Behaviour-preserving apart from the `traceId` format (see API Design). No change to routes, domain rules, persistence, identifiers or job payloads.
- Telemetry must stay out of the test layers: `makeTestWebHandler` builds `appLayer` only, so the telemetry layer lives in `index.ts` and `worker.ts`.
- Request bodies and responses keep the migration's problem-detail shape.

## Context

What exists on `feat/effect-http`:

- Entry is `index.ts`: `NodeRuntime.runMain(Layer.launch(HttpRouter.serve(makeServerLayer(new Config()))))`. There is no `ManagedRuntime` on the API side and no `shutdown.ts`.
- `HttpEffect.toHandled` applies `HttpMiddleware.tracer` to every request: a `server` span with HTTP semantic-convention attributes, `http.route` from `HttpRouter`, and the parent taken from an incoming `traceparent`.
- `HttpMiddleware.logger` is already a global middleware (`EdgeMiddleware` in `server.ts`), so request log lines run inside the request span.
- `Authentication` (`auth.ts`) is an `HttpApiMiddleware` that provides `CurrentToken` (an `OrgToken` with `orgId`).
- `lib/errors.ts` mints `traceId: uuid()` in two places: `toProblemDetail` and `encodeProblem` (a synchronous Schema encode).
- `worker.ts` still uses its own `ManagedRuntime` and has no telemetry layer. `IdempotencyService`, `lib/queues.ts`, `LedgerTransactionRepo`, the balance-monitor service and `db/` are unchanged from `main`.

Existing observability the design reuses:

- `@effect/sql-pg` creates `sql.execute` and `sql.transaction` client spans with `db.query.text` (SQL with placeholders only) and `db.system.name`, `db.namespace`, `server.address`.
- effect-mq creates `<job>.enqueue`, `<job>.enqueueMany` and `<job>.run` spans, stores the enqueuing span as `trace` on the job record, and parents the worker's run span to it (`traceLinking: "auto"`). It also emits `effect_mq_jobs_enqueued`, `effect_mq_job_runs{outcome}`, `effect_mq_job_run_duration_ms` and `effect_mq_job_wait_duration_ms`.
- `Otlp.layerFromConfig` reads the `OTEL_*` variables. A signal is off unless its endpoint is set and `OTEL_<SIGNAL>_EXPORTER` lists `otlp`. The exporter retries transient errors, and after a hard failure drops its buffer and disables itself for 60 seconds. `OtlpLogger` attaches `traceId`/`spanId` from the active span and, by default, adds to the existing logger rather than replacing it.
- `@effect/platform-node` is installed. `FetchHttpClient` is still chosen for the exporter because `NodeHttpClient` offers no advantage here.

Gotchas:

- Transaction statuses are `pending | posted | voided`. There is no "archived".
- The repo returns early when a transaction is already posted (`if (current.status === "posted")`), so the service cannot tell a real post from a no-op re-post. The counter therefore goes in the repo.
- `sendWebhook` uses raw `node:https`, so it has no client span today.
- Valkey is accessed through raw ioredis (`IdempotencyService`, the `lib/queues.ts` adapter). Neither creates spans.

### Research

| Concern | Existing solution | Decision | Current requirement |
|---|---|---|---|
| OTLP export | `Otlp.layerFromConfig` + `OtlpSerialization` + `FetchHttpClient` | reuse | US-1 |
| HTTP spans and `traceparent` | `HttpEffect.toHandled` tracer, `http.route` | reuse | US-2 |
| Organisation on the HTTP span | `CurrentToken` in `Authentication` | modify | US-2 |
| Error `traceId` | random `uuid()` in `encodeProblem` and `toProblemDetail` | modify | US-3 |
| Postgres spans | `@effect/sql-pg` | reuse | US-2 |
| Valkey spans | none | new | US-2 |
| Service and repo spans | none (about 75 methods) | modify | US-2 |
| Logs | `HttpMiddleware.logger`, Effect logger, `OtlpLogger` | reuse + modify | US-5 |
| Worker spans and propagation | effect-mq | reuse | US-4 |
| Worker runtime | `worker.ts` has no telemetry layer | modify | US-1 |
| Webhook span | raw `node:https` | modify | US-4 |
| Job metrics | effect-mq `effect_mq_*` | reuse | US-6 |
| Posted counter | none | new | US-6 |
| Claim counter | none | new | US-6 |

## Architecture

Approach: native Effect OTLP export with explicit `withSpan` calls (approach A). The functional core is unchanged; telemetry is added at the edges.

1. **`src/telemetry.ts`: `makeTelemetryLayer({ serviceName, environment })`.**
   - Combines `Otlp.layerFromConfig`, `OtlpSerialization.layerProtobuf` and `FetchHttpClient.layer`.
   - Resource: fixed `serviceName` (`exchequer-api`, `exchequer-worker`) and a `deployment.environment.name` attribute.
   - Replaces the console logger. In production it writes one JSON line built from `Logger.formatStructured` plus `traceId` and `spanId` from the active span, serialized with `Formatter.formatJson` (plain `JSON.stringify` throws on the bigint ledger amounts and on circular errors, and a throwing logger fails the logging effect). Otherwise it uses `Logger.consolePretty`. The OTLP logger still merges in. `Logger.layer` replaces Effect's default `tracerLogger`, so log lines are not attached to spans as span events; the OTLP logs carry the trace ids instead.
   - Provided outermost in `index.ts` (around `HttpRouter.serve(...)`) and in `worker.ts`, so it flushes last on shutdown.
2. **`src/lib/metrics.ts`.** Two `Metric.counter`s: `transactionsPosted` with attribute `path`, and `idempotencyClaims` with attribute `outcome`.
3. **Spans.**
   - Public service and repository methods get `.pipe(Effect.withSpan("<Interface>.<method>", { attributes }))`.
   - Service spans carry `organization.id` and `ledger.id` taken from the method arguments. Repo spans carry the name only.
   - `Authentication` annotates the current HTTP server span with `organization.id` via `Effect.annotateCurrentSpan`.
4. **Valkey.** `valkey.<COMMAND>` client spans with `db.system.name=valkey` and `db.operation.name`, and never the key. Applied at the four call sites in `IdempotencyService`. The `lib/queues.ts` adapter creates the same span only when a parent span exists (`withValkeySpan`), because effect-mq's poll, renew and stalled loops run without a parent and would otherwise create several root spans per poll interval; with a parent the spans appear under the API's enqueue span and the worker's run span.
5. **Webhook.** A `webhook.deliver` client span around `sendWebhook`, with method and response status only. No URL, no `traceparent`.
6. **Error `traceId`.** A helper `currentTraceId()` returns `Fiber.getCurrent()?.currentSpan?.traceId ?? uuid()`. It replaces `uuid()` for `traceId` in `encodeProblem` and `toProblemDetail` (which `edgeErrors` uses). The built-in tracer creates spans even when export is off, so the fallback only covers code running outside any span.
7. **`transactionsPosted`.** Incremented in `LedgerTransactionRepo` after the database transaction commits, only on real transitions: create-as-posted (`path=create`), a post that is not a no-op (`path=post`), and a settlement post (`path=settlement`).
8. **`idempotencyClaims`.** Recorded in `IdempotencyServiceRedis.claim`, the single place that decides new, replay, pending or unavailable.

- **Lint boundaries:** `.oxlintrc.json` gains `telemetry` and `lib-metrics` elements and the rules that let the entrypoints, `idempotency-capability` and `transaction-repo` import them.
- **Worker logger:** `worker.ts` provides telemetry with `Layer.provide`, so effect-mq's loops inherit the tracer and logger, but the worker's own startup log line (written outside that layer) still uses the default logger.

Seams and test surfaces:

- **Untrusted input:** an incoming `traceparent` is parsed by Effect's `HttpTraceContext`; nothing new is parsed by this change.
- **Layer:** `makeTelemetryLayer` is tested through `Layer` composition, not by inspecting exporter internals.
- **Metrics:** tested through `Metric.value` on the counters.
- **Repo and service spans:** not tested individually; they are mechanical.

### Tests (boundaries only)

- `makeTelemetryLayer` with no `OTEL_*` variables builds and tears down without error and exports nothing.
- `IdempotencyServiceRedis.claim` increments `idempotencyClaims` with the right `outcome` for new, replay, pending and unavailable.
- `LedgerTransactionRepo` increments `transactionsPosted` once per real transition and not on a no-op re-post (Postgres integration test).
- An error response produced inside a span has `traceId` equal to that span's trace id (extends `errors.test.ts` and the web-handler tests).
- A balance-monitor webhook request carries no `traceparent` header.

## API Design

- No new endpoints and no change to method, path, status or headers.
- **One public field changes format:** `traceId` in problem-detail responses goes from a UUID to the request's 32-hex W3C trace id. `instance` is unchanged. Clients that parse `traceId` as a UUID will break; this is accepted as the point of US-3.
- **Configuration** is entirely through standard variables: `OTEL_EXPORTER_OTLP_ENDPOINT` (and per-signal endpoints), `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SDK_DISABLED`, `OTEL_{TRACES,METRICS,LOGS}_EXPORTER`, and the batch and export interval variables. They are documented in `apps/api/.env.example` and as commented-out entries in `docker-compose.yml` for the `api` and `worker` services. Nothing is added to the `Config` class.
- **Span names:**
  - New: `<Interface>.<method>`, `valkey.<COMMAND>`, `webhook.deliver`.
  - Inherited: `http.server <METHOD>`, `sql.execute`, `sql.transaction`, `<job>.enqueue`, `<job>.run`.
- **Metrics:** `ledger_transactions_posted{path}`, `idempotency_claims{outcome}`, plus `effect_mq_*`.

## Data Model

None. No schema, migration, job-payload or persisted-format change. The trace context for jobs lives on effect-mq's own job record.

## Trade-offs

- **Chosen:** native Effect OTLP with explicit spans. No new dependencies, explicit and greppable span names, and each edit is local and behaviour-preserving.
- **Rejected: auto-wrapping repositories and services in a Proxy.** About 18 one-line edits instead of about 75, and new methods are covered automatically. But it is runtime magic, it cannot add per-method attributes, and it covers private helpers called through `this` inconsistently.
- **Rejected: `@opentelemetry/sdk-node` with auto-instrumentation.** It would give ioredis and https spans for free, but it needs a heavy dependency tree and a preload in the Dockerfile, there is no Effect v4 bridge installed, and it would run two tracing systems at once.
- **Known limitations:**
  - About 75 manual `withSpan` calls, kept consistent by convention rather than enforced.
  - No Node runtime metrics.
  - OTLP over HTTP only.
  - The `monitor-jobs` CLI is not instrumented.
  - `traceId` format change is client-visible.
- **Acceptable failures:** telemetry is lost during a collector outage (the exporter drops its buffer and backs off for 60 seconds), and in-flight spans are lost if the process crashes.
- **Sampling:** every span is exported. Sampling is the collector's job (tail sampling), so no sampler code ships in v1.

## Open Questions

None.
