# API Traffic Protection

Per-Organization rate limiting backed by Valkey, plus in-process load shedding, both as middleware on the Effect `HttpApi` server.

## Problem

- Any Organization can send unbounded requests to `/api/*`, which consumes shared Postgres and Node capacity for every tenant.
- There is no per-tenant protection today. The aim is only to stop one Organization degrading the others, so the limit is a capacity guard sized from what Postgres and Node can serve, not a quota.
- Since the Effect HTTP migration, an overloaded process also keeps accepting work until it falls over. Before the migration, `@fastify/under-pressure` shed load with 503s when the event loop or memory crossed set thresholds.

## Scope

- **In scope:**
  - A per-Organization request limit on every `LedgerApi` endpoint, applied after authentication.
  - Counters in Valkey, so the limit holds across instances.
  - A token-bucket budget per Organization, so an exhausted Organization recovers gradually instead of waiting for a full reset.
  - Per-endpoint request costs: an endpoint may declare a weight in tokens; unannotated endpoints cost 1.
  - Configurable `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_SECONDS`, validated at startup.
  - A 429 `TOO_MANY_REQUESTS` problem with `retry-after`.
  - `x-ratelimit-*` headers on successful responses.
  - Fail-open on limiter store errors.
  - Process load shedding modelled on the old under-pressure config:
    - thresholds: event-loop delay > 1000 ms, heap used > 500 MB, RSS > 1 GB;
    - sampled every 1 s;
    - 503 `SERVICE_UNAVAILABLE` with `retry-after: 50` on every route;
    - disabled when `environment` is `test` or `test-*`.
- **Out of scope:**
  - The under-pressure `/status` route (`/health` already exists) and configurable load-shedding thresholds (constants until a need appears).
  - The under-pressure event-loop-utilisation check. It measured utilisation cumulatively since boot, so it was effectively inert; measured per interval it would shed a healthy busy process.
  - A per-IP limit on authentication failures (counting 401s per client IP, with trusted-proxy handling). It is abuse protection, not tenant isolation, and needs its own design because Effect's limiter has no non-consuming check. It is a follow-up spec.
  - Per-Organization tiers, separate read/write or per-endpoint counters, per-Account or per-Ledger limits, and adaptive modes.
  - `/health`, `/docs`, and the worker are not rate limited.

## User Stories

- **US-1 (must):** As an Organization, I want other tenants' bursts capped, so that my requests keep predictable latency.
  - Given `RATE_LIMIT_MAX=N`, when an Organization sends N+1 authenticated requests in quick succession, then request N+1 returns 429 `TOO_MANY_REQUESTS`, `retryable: true`, with a `retry-after` header: the time until the Organization has enough tokens for that request, in whole seconds (rounded up, at least 1).
  - Given Org A is limited, when Org B sends a request, then it succeeds.
  - Given Org A has waited long enough for tokens to refill, when it retries, then it succeeds.
- **US-2 (should):** As an API client, I want `x-ratelimit-limit`, `x-ratelimit-remaining`, and `x-ratelimit-reset` (whole seconds until the bucket is full again) on successful (2xx) responses, so I can pace my requests.
- **US-3 (must):** As an operator, I don't want a Valkey outage to reject or stall API traffic.
  - Given the limiter store fails, when a request arrives, then the request proceeds without rate-limit headers, delayed by at most about 250 ms.
  - Fail-open is logged once when it starts and once when it recovers, not per request.
- **US-4 (must):** As an operator, I want unauthenticated requests rejected before they consume tokens.
  - Given a request without a valid token, then `Authentication` returns 401 and no token is consumed.
  - `/health` and `/docs` are never rate limited.
- **US-5 (must):** As an operator, I want an overloaded instance to shed load fast, so it recovers instead of timing out every request.
  - Given the latest sample exceeds any threshold, when any request arrives (including `/health`), then the response is 503 `SERVICE_UNAVAILABLE`, `retryable: true`, `retry-after: 50`. The handler and rate limiter don't run.
  - Given the next sample is under every threshold, then requests are served normally.
  - Given `environment` is `test` or `test-*`, then shedding is never applied.
- **US-6 (must):** As an operator, I want an invalid rate-limit setting to fail at startup rather than silently disable or block all traffic.
  - Given `RATE_LIMIT_MAX` or `RATE_LIMIT_WINDOW_SECONDS` is set to anything other than a positive integer, then startup fails with a clear error. When unset, the defaults (30000 and 60) apply.
- **US-7 (should):** As an operator, I want expensive operations to cost more tokens than cheap ones, so a tenant running heavy operations is limited sooner than one running cheap ones.
  - Given an endpoint declares a cost of N, when it is requested, then N tokens are consumed. An endpoint with no declared cost consumes 1.
  - Given a declared cost larger than `RATE_LIMIT_MAX`, then the cost is clamped to `RATE_LIMIT_MAX`, so the endpoint stays usable.
  - Initial costs: settlement create, add entries and remove entries = 10; statement create = 10; category list and get = 5; everything else 1.

## Constraints

- Based on `main`, which already has the Effect HTTP server and the OpenTelemetry instrumentation. The design reuses `Authentication` / `CurrentToken`, `TooManyRequestsApiError`, and the `LedgerApi` middleware chain unchanged.
- Valkey keys are prefixed `exchequer:ratelimit:` (cf. `exchequer:idempotency:`).
- The limiter uses its own Redis client with `enableOfflineQueue: false` and `commandTimeout: 250`, so a Valkey outage costs a request at most about 250 ms. It must not reuse the `ValkeyTag` client, which never reconnects (`retryStrategy: () => undefined`).
- Route tests run without Valkey: the shared route-test harness provides the memory limiter store. The API test run starts Postgres and Valkey Testcontainers; only the Valkey integration test uses Valkey.
- `.oxlintrc.json` types every `src/**` file as a `boundaries` element with explicit `allow` rules. Each new `src/lib` module needs an element and rules, an entry in the `boundaries/external` HTTP allow list if it imports `effect/unstable/http` or `httpapi` (`RateLimit.ts` does), and importing modules (`api-composition`, `server`, `runtime`) need an `allow` entry for it.
- `problemResponse` is private to `server.ts` and `server` imports lib modules, so `LoadShedding.ts` must not import from `server.ts`. If `shedLoad` needs it, export or move it.
- The job store keeps its current Redis options, and the raw ioredis error stays as the `RedisError.cause`; Effect's NOSCRIPT recovery depends on it.

## Context

- `src/api.ts` composes `LedgerApi` with `.prefix("/api").middleware(Authentication).middleware(SchemaErrorTransform)`. The first middleware added is innermost, so a later one wraps an earlier one: auth runs first, then request decoding.
- `src/auth.ts`: `Authentication` is an `HttpApiMiddleware.Service` with bearer security that `provides: CurrentToken` (an `OrgToken`). `token.organizationId` is the tenant identity.
- `src/lib/errors.ts`: `TooManyRequestsError` and `TooManyRequestsApiError` already encode the 429 problem body and a `retry-after` header derived from `retryAfterSeconds`.
- `src/lib/ApiContract.ts`: settlements, balance monitors, statements and categories already declare `TooManyRequestsApiError`; the other groups use `commonErrors`. Identical error schemas are de-duplicated.
- `src/server.ts`: `EdgeMiddleware` is the single global router middleware with an explicit order `failServerSpan(correlate(logger(connectionClose(bodyLimit(edgeErrors(httpEffect))))))`. `problemResponse` renders an `HttpError` with `retry-after`. `appLayer` provides `makeAuthenticationLayer` from `ServerConfigTag`.
- `src/lib/testing.ts`: `testServicesLayer` is the shared route-test harness behind `makeTestWebHandler`, `useTestWebHandlers` and `ServerRoutes.test.ts`. It builds the route-test service set with die-if-called defaults and always uses `new Config()` from `.env.test`.
- An `HttpApiMiddleware` receives the matched `endpoint` and `group` with the request, so a middleware can read per-endpoint annotations.
- `src/runtime.ts` builds the Valkey client (`makeValkeyLive`), idempotency, and the balance-monitor job store. `src/lib/queues.ts` builds an Effect `Redis.Redis` over ioredis inline.
- The effect-http migration deleted `@fastify/under-pressure` and `@fastify/rate-limit`, and its design left load shedding to infrastructure. This spec reverses that for load shedding, at the user's request.
- Effect 4.0.0-rc.112 ships `effect/unstable/persistence` `RateLimiter` with `consume` (`algorithm: "token-bucket"`, `onExceeded: "fail"`, optional `tokens`), `layerStoreRedis({ prefix })`, and `layerStoreMemory`.

### Research

| Concern | Existing solution | Decision | Current requirement |
|---|---|---|---|
| Limiter + atomic store | `RateLimiter.consume`, `layerStoreRedis`, `layerStoreMemory` | reuse | US-1, cross-instance counting, Valkey-free tests |
| Effect `Redis.Redis` over ioredis | Inline layer in `makeJobStore` (`src/lib/queues.ts`) | modify: export as `makeRedisLayer(valkeyUrl, overrides?)`, use in both places | The limiter store needs `Redis.Redis` with different options; second current consumer |
| Authenticated Organization | `Authentication` → `CurrentToken` (`src/auth.ts`) | reuse | Key by Organization; US-4 |
| Middleware hook | `HttpApiMiddleware.Service` + `LedgerApi.middleware(...)` (`src/api.ts`) | reuse | Per-request check after auth |
| 429 problem + header | `TooManyRequestsError` / `TooManyRequestsApiError` | reuse | US-1 |
| Middleware layer wiring | `appLayer` provides `makeAuthenticationLayer` from `ServerConfigTag` | modify (+ rate-limit layer) | Wire the middleware |
| Limiter provisioning | `makeServerRuntimeLayer` (`src/runtime.ts`); `testServicesLayer` (`src/lib/testing.ts`) | modify (Redis store in runtime; memory store in tests) | Production counting; route tests without Valkey |
| Per-endpoint cost | Endpoint annotations (`operation` helpers in `src/lib/ApiContract.ts`) and the `endpoint` passed to middleware | new: a `RequestCost` annotation key | US-7 |
| Config | `Config` (`src/config.ts`) | modify (+ validated `rateLimitMax`, `rateLimitWindowSeconds`) | US-6 |
| Load metrics | `node:perf_hooks` `monitorEventLoopDelay`, `process.memoryUsage()` | reuse | US-5 |
| Load-shedding middleware | `EdgeMiddleware` global chain (`src/server.ts`) | modify (+ `shedLoad` step) | US-5 on every route |
| 503 problem | `ServiceUnavailableError` + `problemResponse` | reuse | US-5 |
| Pressure sampling | none | new: `src/lib/LoadShedding.ts` | US-5 |

## Architecture

Transport-only. There are no Service, Repository, or Entity changes, and `CONTEXT.md` does not change, because neither feature is a Ledger domain term.

### Rate limiting (`src/lib/RateLimit.ts`)

One job: consume the endpoint's cost in tokens (1 by default) from the caller's Organization, then annotate or reject.

- `class RateLimit extends HttpApiMiddleware.Service<RateLimit, { requires: CurrentToken }>()("RateLimit", { error: TooManyRequestsApiError })`.
- `makeRateLimitLayer({ limit, window })` takes `RateLimiter.RateLimiter` and returns `(httpEffect) => …`:
  1. Read `CurrentToken`, then `limiter.consume({ key: token.organizationId.toString(), limit, window, tokens: min(cost, limit), algorithm: "token-bucket", onExceeded: "fail" })`, where `cost` is the matched endpoint's `RequestCost` annotation or 1.
  2. On success, run `httpEffect` and set `x-ratelimit-limit`, `x-ratelimit-remaining`, and `x-ratelimit-reset` from `ConsumeResult`, with durations rounded up to whole seconds.
  3. On a `RateLimiterError` whose `reason._tag` is `RateLimitExceeded`, fail with `TooManyRequestsError("Rate limit exceeded", { retryable: true, retryAfterSeconds: ceil(retryAfter in seconds) })`.
  4. On a `RateLimiterError` whose `reason._tag` is `RateLimitStoreError`, return `httpEffect` unchanged (fail-open) and log only on the transition into and out of the failing state.
- **Semantics.** Each Organization has a bucket that starts full at `limit` tokens and gains one token every `window/limit`, up to `limit`. A request is accepted if the bucket holds enough tokens for its cost; a rejected request consumes nothing. An Organization can burst up to `limit`, then is held to `limit/window` per second, and recovers gradually (a rejected 10-token request waits for 10 tokens, not for a full reset). `x-ratelimit-remaining` is tokens, not requests, `x-ratelimit-reset` is the time until the bucket is full, and `retry-after` is the time until enough tokens exist for that request.
- **Request cost.** `RequestCost` is an annotation key declared in `src/lib/ApiContract.ts`. Heavy endpoints set it where they are defined; the middleware reads it from the endpoint it receives and defaults to 1. The cost is clamped to `limit`, because Effect rejects any `tokens > limit` permanently. Costs are not exposed in OpenAPI or the public docs; clients pace from the response headers.
- `src/api.ts`: `.prefix("/api").middleware(RateLimit).middleware(Authentication).middleware(SchemaErrorTransform)`. `RateLimit` is added before `Authentication`, so it runs inside auth (with `CurrentToken` in scope) and before request decoding. The ordering comment is updated.
- `src/server.ts` `appLayer`: provide the rate-limit layer from `ServerConfigTag` (`limit: rateLimitMax`, `window: Duration.seconds(rateLimitWindowSeconds)`), mirroring the Authentication wiring.
- `src/runtime.ts`: add `RateLimiter.layer` ← `RateLimiter.layerStoreRedis({ prefix: "exchequer:ratelimit:" })` ← `makeRedisLayer(config.valkeyUrl, { enableOfflineQueue: false, commandTimeout: 250 })` to the infrastructure layer, and add `RateLimiter` to `ServerRuntimeServices`. The limiter and the job store hold separate connections, which is intended.
- `testServicesLayer` in `src/lib/testing.ts`: add `RateLimiter.layer` ← `layerStoreMemory`. Route tests use `.env.test`, whose very high `RATE_LIMIT_MAX` never trips existing suites or benches.

### Load shedding (`src/lib/LoadShedding.ts`)

One job: answer "is this process over its limits right now?" and reject early when it is.

- `sample(histogramMeanNs, resolutionMs, memoryUsage): boolean` is a pure function with constant thresholds:
  - event-loop delay is the histogram mean minus the timer resolution, with the histogram reset after every sample; a NaN mean (the loop was blocked for the whole interval) counts as overloaded;
  - heap used > 500 MB; RSS > 1 GB.
- `startSampler` is a scoped effect: it enables `monitorEventLoopDelay`, forks a 1 s `Schedule.spaced` sampler that writes the latest verdict to a `Ref`, and disables the histogram on scope close.
- `shedLoad(verdict)(httpEffect)`: when the verdict says overloaded, returns `problemResponse(new ServiceUnavailableError("Service under pressure", { retryable: true, retryAfterSeconds: 50 }))` without running `httpEffect`.
- **Wiring** in `src/server.ts`: the `EdgeMiddleware` construction effect reads `ServerConfigTag`. In `test` / `test-*` the verdict is always false; otherwise it comes from `startSampler`. The chain becomes `failServerSpan(correlate(logger(connectionClose(bodyLimit(edgeErrors(shedLoad(verdict)(httpEffect)))))))`. Shed requests are logged with their 503, and shedding runs before the API middleware, so a shed request never reaches Valkey. There is no per-request service lookup, because that would leak a `GlobalRequires` requirement into `serve` and `toWebHandler`.
- `/health` is shed too, matching the old behaviour. If it is ever used as a liveness probe, an overloaded pod would be restarted.

### Config (`src/config.ts`)

`rateLimitMax` and `rateLimitWindowSeconds` are parsed as positive integers, default 30000 and 60 when unset, and throw on anything else. NaN would silently disable limiting and 0 would reject every request; neither is a store error, so fail-open would not catch them. The default of 30000 per 60 seconds (about 500 requests per second) is sized from `apps/api/docs/product/category-balances-benchmark.md`, where one Organization reached 650 to 940 writes per second on a single dev machine. Both settings are environment variables so the cap can be tuned without a deploy.

### Where IO lives

Only the `RateLimiter` store and the load-shedding sampler. The middleware functions are pure mapping over `ConsumeResult` / `RateLimiterError` and over the verdict.

### Test seams

1. `src/config.test.ts`: a table for the validation rules.
2. `src/lib/RateLimit.test.ts` drives a minimal `HttpApi` with the real `Authentication` and the middleware through a web handler:
   - memory store, `limit: 2`, window about 200 ms, for US-1 and US-2;
   - an endpoint with a declared cost, one without (cost 1), and a cost above the limit (clamped), for US-7;
   - a store layer failing with `RateLimitStoreError` for US-3;
   - no token for US-4.
3. `src/lib/LoadShedding.test.ts`:
   - a table test of `sample` at each threshold boundary, including NaN;
   - `shedLoad` with a fixed verdict (true → 503 + `retry-after: 50` and the handler is not run; false → passthrough).
   The real sampler loop is not tested.
4. One integration test against the Valkey Testcontainer that the API test run starts proves the Redis store wiring and the token-bucket keys for `exchequer:ratelimit:<org_id>`.
5. The benches assert `non2xx === 0`, so they cannot silently measure the limiter.
6. There is no route-level 429 test: `testServicesLayer` always reads `new Config()`, so a low limit would need a new harness parameter. Seam 2 covers the behaviour at module level, and route suites only assert the declared 429 in OpenAPI.

## API Design

- No new endpoints.
- The groups that use `commonErrors` (Organization, Ledger, Transaction, Account, Asset) gain a declared 429 `TOO_MANY_REQUESTS` response through the middleware `error`. The throttled groups (settlements, balance monitors, statements, categories) already declare it, so their documents change only in the 429 `retry-after` header schema, which becomes an integer (the wire value is the same whole seconds). Explicit status-set assertions for the changed groups are updated, and each differs only by 429.
- Successful (2xx) responses gain `x-ratelimit-limit`, `x-ratelimit-remaining`, and `x-ratelimit-reset`. Declared errors are encoded outside the middleware, so 4xx responses carry no rate-limit headers, even though a 400 from request decoding has consumed a token.
- A 429 carries `retry-after` (whole seconds, the time until enough tokens exist), encoded by `TooManyRequestsApiError`.
- Under pressure, any route returns 503 `SERVICE_UNAVAILABLE` with `retry-after: 50`. It is rendered at the edge and is not declared per endpoint in OpenAPI, as before the migration.

## Data Model

- No Postgres changes.
- Valkey keys are `exchequer:ratelimit:<org_id>`, owned by the Effect Redis store and with a companion last-refill key, both owned by the Effect Redis store and expiring when the bucket is full again.
- New env vars `RATE_LIMIT_MAX` (default 30000) and `RATE_LIMIT_WINDOW_SECONDS` (default 60), documented in `apps/api/.env.example`, with a very high `RATE_LIMIT_MAX` in `apps/api/.env.test`.

## Trade-offs

- **Rate limiting, chosen:** Effect `RateLimiter` with the Redis store inside an `HttpApiMiddleware`. It needs no new dependency, the atomic Lua lives in Effect, it composes with the existing `Authentication`, and the memory store keeps route tests Valkey-free.
- **Algorithm, chosen:** token-bucket. Effect's `fixed-window` keeps a count and a TTL that grows with each accepted request: once the count reaches the limit, the Organization is locked out until the whole TTL drains (up to the window) and then resets to zero. Token-bucket refills one token per `window/limit`, so a limited Organization recovers gradually, which matters more with weighted costs. The cost is two Valkey keys per Organization.
- **Rate limiting, rejected:** a custom Lua limiter on the `ValkeyTag` client in the style of `IdempotencyService`. It means more code and tests for the same behaviour, and that client never reconnects.
- **Load shedding, chosen:** a small in-process sampler that reproduces the under-pressure delay, heap and RSS thresholds. This reverses the effect-http decision to leave it to infrastructure, at the user's request.
- **Load shedding, rejected:** relying on platform autoscaling or health checks alone, which do not protect an instance while it is overloaded.
- **Limitations:**
  - A full bucket allows a burst of `limit` before the steady `limit/window` rate applies.
  - Costs are static annotations tuned by hand; they do not adapt to measured load, and the initial values are estimates.
  - Fail-open lets traffic through during a Valkey outage.
  - `RateLimiter` is in `effect/unstable`, so its API may change between rc releases.
  - Rate limiting runs before request decoding, so invalid requests consume tokens.
  - The pressure verdict can be up to 1 s stale; RSS rarely shrinks, so an RSS breach stays shed until restart or heap release.
  - Thresholds are constants, not env config.
  - `/health` is shed under pressure.
