# Move the HTTP router layer from Fastify to Effect HttpApi

## Problem
- The API edge runs on Fastify: 9 route modules (50 `/api` routes) plus `/health`, `/docs` and `/status`. Everything behind it (services, repositories, the `ManagedRuntime`) already runs on Effect.
- Each route crosses the boundary by hand. It calls `runtime.runPromise(Effect.result(...))`, unwraps the `Result`, and rethrows into a Fastify error handler. Validation uses TypeBox/AJV, errors are `HttpError` classes outside Effect's typed error model, and OpenAPI is generated from TypeBox route schemas.
- The people affected are maintainers, who work with two execution, schema and error models at the edge.

## Scope
- **In scope:**
  - Serve all routes with Effect `HttpApi` on `@effect/platform-node`.
  - Convert request/response schemas from TypeBox to Effect Schema.
  - Make the `HttpError` base classes Schema error classes that encode to today's problem-detail body.
  - Replace the Fastify JWT and permission hooks with an `HttpApiMiddleware` and an in-handler permission check.
  - Generate OpenAPI and the docs UI from the API definition.
  - Port the route tests, the OpenAPI assertions and snapshots, and `ServerRoutes.test.ts`.
  - Remove Fastify, its plugins, `pino-pretty` and TypeBox.
- **Out of scope:**
  - Changes to services, repositories, entities, database schema or domain rules.
  - New endpoints or new fields.
  - Load shedding (infrastructure owns it).
  - Renaming operations, paths or permissions.
  - Normalising per-route oddities (200 creates, 200 empty deletes, ignored statement path IDs). They are preserved.
  - A generated API client.

## Listed behaviour changes
This is a behaviour-preserving migration with these accepted exceptions. Anything else found during implementation stops the work for a split.

1. `@fastify/under-pressure` and its `/status` route are removed. The unused `@fastify/rate-limit` dependency is deleted.
2. The `detail` text of validation 400s changes to the Effect Schema message. Status, type and title are unchanged.
3. Authentication runs before request validation, so an unauthenticated invalid request gets 401 instead of 400. Authorization (403) still runs after validation.
4. Unknown routes return the NOT_FOUND problem detail instead of Fastify's `{message,error,statusCode}` body.
5. On endpoints that declare a payload, malformed JSON returns a 400 BAD_REQUEST problem and an unsupported content type returns 415 (both 500 today per the pre-migration error handler). `text/plain` was a 400 validation error before (Fastify has a built-in `text/plain` parser) and now returns 415 with a plain-text body (`Unsupported content-type: text/plain`). Endpoints that declare no payload (deletes, transaction post/void, category link/unlink and so on) now ignore the request body and `Content-Type` entirely, because HttpApi parses a body only when a payload is declared. In Fastify, an empty `application/json` body (`FST_ERR_CTP_EMPTY_JSON_BODY`), malformed JSON or an unsupported media type such as `application/xml` on those endpoints failed with a 500 through `globalErrorHandler`; they now succeed. A `text/plain` body to such an endpoint already succeeded.
6. `/docs` is served by `HttpApiSwagger` and `/docs/json` by `OpenApi.fromApi`. UI configuration (`docExpansion`, `deepLinking`) may differ.
7. Request logging moves from pino/pino-pretty to the Effect logger and `HttpMiddleware.logger`. The access line format changes. Per-request correlation is kept: every log line in a request carries `http.request_id` (the incoming `x-request-id` when it matches `^[A-Za-z0-9._:-]{1,128}$`, otherwise a minted uuid) and `http.remote_address` (when known); no response header is added. Errors with status ≥500 are still logged with their cause. Interrupted requests are logged truthfully: a client abort is logged with status 499 (no response is sent), and a server-side interrupt (drain cut) is a 503 problem logged at WARN. Shutdown logs "API shutdown started" before the drain and "API shutdown complete" after the services are released; the old "API shutdown failed" log is replaced by `runMain`'s failure reporting and exit code 1.
8. Request bodies are no longer type-coerced. A body value of the wrong type (e.g. `{name:123}`, `description:null`, or `"false"` for a boolean) returns 400 BAD_REQUEST instead of being coerced. Query-string coercion and body defaults are unchanged.
9. Graceful drain is capped at `NodeHttpServer`'s default 20 s `gracefulShutdownTimeout` (the pre-migration server had no cap). Writes already in a handler are awaited up to the cap (see US-6). A request whose headers are incomplete at SIGTERM is not answered (the request listener is removed first) and can hold `server.close()` until the client disconnects or the cap or headers timeout fires.
10. Routing is case-insensitive, collapses duplicate slashes and ignores trailing slashes (Effect FindMyWay defaults; no `routerConfig` is passed). The only effect is that spellings the old server answered 404 are now served, including item paths with a trailing slash (`/api/organizations/<id>/`). This is recorded as an accepted `review-decision` in `apps/api/src/server.ts` (the `serveApp` composition).
11. Query-string integers are decoded by Effect's string codec: values that Fastify/AJV coerced (hex such as `0x10`, whitespace-padded values, `Infinity`) now return 400, and `NaN`/`Infinity` are rejected by the Finite pagination schema. Query parameters are documented in OpenAPI as optional string patterns without min/max/default.
12. Preserved behaviours worth recording (not changes): server timeouts keep the pre-migration values (`keepAliveTimeout` 72 s, no `requestTimeout`); the 1 MiB request body limit is kept (a declared oversized `Content-Length` gets a sanitised 500 problem, and chunked bodies over the limit have their connection closed); the process exits 0 on SIGTERM/SIGINT.

## User Stories
- **US-1 (must) Single HTTP framework.** As a maintainer, I want every HTTP route served by Effect HttpApi on `@effect/platform-node`, so that the edge shares one runtime and error model with the services.
  - Given the migration is complete, then `rg -i fastify apps/api/src apps/api/test apps/api/package.json` returns nothing, and `pnpm run check` and `pnpm run test` pass.
  - Given the server starts, then it listens on `::`, port 3000, and `GET /health` returns 200 `{}` without auth.
- **US-2 (must) Wire parity.** As an API client, I want no observable change beyond the listed ones.
  - Given any of the 50 `/api` routes, when it is called with today's inputs, then the status, the `Location`/`Retry-After` headers and the response body match today, including:
    - per-route oddities (200 creates, 200 empty deletes, the settlement `Location` built from the raw param, statement path IDs ignored);
    - query integer coercion and body defaults;
    - silent stripping of unknown body fields, except Asset, which rejects them with 400 "Invalid Asset creation request" (create) or "Invalid Asset replacement request" (replace);
    - the string-amount and metadata 400 checks;
    - stripping of undeclared response fields.
  - The existing route-test assertions are ported to the new harness and pass unchanged, except where a listed change applies.
- **US-3 (must) Typed errors with problem bodies.** As an API client, I want every error rendered as today's problem detail.
  - Given a domain error, when it reaches the edge, then the body is `{type,status,title,detail,instance:"/instance/<uuidv7>",traceId:<uuidv7>,retryable?}`, with no `_tag`, and the status is the error's status.
  - Given an error with `retryAfterSeconds`, then `Retry-After` is set (e.g. IdempotencyPending → 409 + `Retry-After: 1`).
  - Given a defect or an undeclared failure, then the response is a 500 INTERNAL_SERVER_ERROR problem, the cause is logged and not exposed, and errors ≥500 are logged.
  - Given the settlement service branch on client errors (`statusCode < 500`), then it behaves as before.
- **US-4 (must) Auth parity.** As an organization user, I want the same authentication and authorization outcomes.
  - Given a missing or invalid JWT, or a `sub` that isn't a canonical `org_` ID, then the response is 401 "Invalid token".
  - Given a token missing any one of the route's permissions, then the response is 403 with today's message. Permissions come from `scope[0]` only, and *all* listed permissions are required.
  - Given a settlement PATCH to `voided`, then `account:settlement:delete` is also required.
  - Organization routes stay unscoped; every other route uses the token's Organization.
- **US-5 (must) Equivalent OpenAPI.** As an API consumer, I want an equivalent OpenAPI document at `/docs/json` and a docs UI at `/docs`.
  - The document keeps the same paths, methods, operationIds, tags, params, request/response schemas and per-route response-status sets (including where 429 is declared and where it isn't), plus a bearer security scheme.
  - The existing OpenAPI snapshots and inline assertions are ported. Snapshots are regenerated only for structural differences, which a reviewer checks against this equivalence rule.
- **US-6 (must) Graceful shutdown.** As an operator, I want SIGTERM/SIGINT to drain in-flight requests before the runtime and pools are disposed, and to add `connection: close` while draining.
  - The `ServerRoutes.test.ts` drain test is ported and passes.
  - Given a state-changing request is in a handler, when the client disconnects or the drain cap is reached, then the write runs to completion. Every non-GET handler (31 across the nine groups) is registered with `{ uninterruptible: true }` via the shared `runToCompletion` constant in `lib/utils.ts`; reads stay interruptible. A route-registration test asserts that every non-GET route is uninterruptible and every GET is not.

## Constraints
- `effect` and `@effect/platform-node` are pinned to exactly `4.0.0-rc.112`. The `effect/unstable/*` APIs may change between release candidates.
- Wire parity bar: status codes, `Location`/`Retry-After` headers and problem-detail bodies match, except the listed changes.
- One cutover: no period where Fastify and Effect HTTP both serve traffic, and no bridging code.
- No database schema change and no migration.
- Services, repositories and entities keep their logic; only error base classes and schema type definitions change underneath them.
- Writes run to completion, as under Fastify, where handlers ran via `runtime.runPromise(...)` with no abort signal. HttpApi handlers are interruptible by default, which would strand idempotency claims (Valkey, 15-minute TTL), skip the post-commit monitor-job publish and allow a duplicate after the TTL.

## Context

### Current edge
- `src/server.ts:27-53` mounts the route plugins under `/api`, behind a JWT `preHandler`. Outside `/api`: `GET /health` (`{}`, no auth), Swagger UI at `/docs` with the spec at `/docs/json`, and `GET /status` from under-pressure (non-test environments only).
- Routes follow one pattern: `parseId` → service → `toResponse()`, with failures rethrown to `globalErrorHandler` (`src/lib/errors.ts:140`). Exceptions are listed under "Parity hazards" below.
- Every domain error already extends an `HttpError` subclass, and repositories map Postgres codes to them. There is no mapping at the edge.
- `globalErrorHandler` maps:
  - `HttpError` → its problem detail, plus `Retry-After` when `retryAfterSeconds` is set;
  - `FST_ERR_VALIDATION` → 400;
  - under-pressure → 503;
  - anything else → 500, with the cause logged but not exposed.
- Auth (`src/auth.ts`): `@fastify/jwt` verifies the token and builds an `OrgToken`. Permissions come from `scope[0]` only, `hasPermissions` requires all listed permissions, and any JWT failure gives 401 "Invalid token". The five Organization routes do not use the token; every other route does.
- `worker.ts` and `monitor-jobs.ts` are pure Effect and do not use Fastify.

### Parity hazards
- Fastify validates before the auth `preHandler` runs, so a bad request returns 400 even without a token (listed change 3).
- AJV is configured with `coerceTypes`, `useDefaults` and `removeAdditional`: query strings become integers, body defaults are injected (e.g. settlement `status:"pending"`), and unknown fields are stripped where `additionalProperties:false`. Asset rejects unknown fields through a `Value.Check` preValidation hook. AJV also coerces body values to the declared type (`123` → `"123"`, `null` → `""`, `"false"` → `false`); that coercion is dropped (listed change 8).
- Responses are serialised through the per-status response schema, which strips undeclared fields.
- Custom preValidation hooks: `requireStringAmounts` (transactions, balance monitors), `validateMetadata` (categories) and Asset's strict check.
- The settlement PATCH requires `account:settlement:delete` additionally when `body.status === "voided"`.
- The settlement create `Location` header is built from the raw `ledgerId` param.
- Statement routes ignore the `ledgerId`/`accountId` in the path; the create endpoint takes them from the body.
- Several create endpoints return 200 with no `Location` (categories, statements, balance monitors), and several deletes and links return 200 with an empty body.
- Balance-monitor routes pass raw strings to the service, which parses them.
- On payload endpoints, malformed JSON and unsupported content types fall through the error handler to 500 today (inferred from the handler's code, not tested). On endpoints with no payload, Fastify's empty-JSON, malformed-JSON and unsupported-media-type errors also became 500s; `text/plain` is parsed by Fastify's built-in parser.

### Schema coupling
- Outside route files, TypeBox is imported almost entirely as `import type` (`Static` types) in services, entities and repos.
- Runtime coupling: `normalizeAssetCode` (`lib/AssetSchema`), `lib/amounts.ts` (mixes schemas with `parseAmount`/`assertInt64`), `export *` barrels in `settlements/index.ts` and `statements/index.ts`, and `src/db/schema.ts` importing `AlertCondition`.
- The Category and Statement schema files import `FastifyRequest` types.
- TypeBox features in use: ID patterns, `date-time`/`uri` formats, `Integer` min/max with defaults, arrays with `minItems`/`maxItems`/`uniqueItems`, `additionalProperties:false`, literal unions, `Null` unions, `Intersect`, `Composite`, `Omit`, `Never`, `Record`, `writeOnly` and `$id`.
- Two pagination schemas exist: `PaginationQuery` (unbounded `Number`) and `ListQuery` (bounded `Integer`).

### Tests today
- Most route tests build a bare `fastify()` with `globalErrorHandler`, a stubbed service layer, a fake `request.token` and a `hasPermissions` spy. A few use `buildServer` with real `signJWT` tokens.
- Three `__snapshots__` files (balance monitors, statements, categories) hold OpenAPI paths and response sets. Account, Asset, Ledger and Transaction tests assert OpenAPI inline.
- `ServerRoutes.test.ts` covers error mapping, 500 sanitisation and the SIGTERM/SIGINT drain. It does not cover 404s, `/health`, `/docs`, auth or malformed JSON.

### Effect v4 rc.112 surface (`effect/unstable/httpapi`, `effect/unstable/http`)
- **Declaring the API:** `HttpApi.make`, `HttpApiGroup.make` and `HttpApiEndpoint.get|post|put|patch|delete(id, path, { params, query, headers, payload, success, error })`. A group's `.middleware()` only reaches endpoints already added.
  - Status codes: `HttpApiSchema.status(n)`, `NoContent`, `Empty(n)`. Success defaults to 200 and errors to 500.
  - Response headers: `HttpApiSchema.WithHeaders` / `withHeaders` for successes and `encodeToWithHeaders` for errors. A handler may also return an `HttpServerResponse`, which bypasses encoding.
- **Handlers:** `HttpApiBuilder.group(api, id, h => h.handle(...))` and `HttpApiBuilder.layer(api, { openapiPath })`.
- **Auth:** `HttpApiMiddleware.Service` with `provides` and `security: { bearer: HttpApiSecurity.bearer }`. A missing Authorization header is passed through as an empty credential, so the middleware must reject it.
- **Errors:**
  - Declared errors are encoded with their `httpApiStatus`. An undeclared typed error becomes an empty 500.
  - Request decode failures become `HttpApiSchemaError`, rendered as an empty 400. Response-encode failures (`Body`, `ResponseHeaders`) are also rendered as 400.
  - The decode-error body is customised with `HttpApiMiddleware.layerSchemaErrorTransform`.
  - Defects get an empty 500 unless a global `HttpRouter.middleware(..., { global: true })` handles them.
- **OpenAPI:** `OpenApi.fromApi` takes the operationId from the `OpenApi.Identifier` annotation, falling back to `group.endpoint`, and duplicate operationIds throw. Tags come from the group `Title`. Security schemes come from the middleware. Docs UI is `HttpApiSwagger.layer` or `HttpApiScalar.layer`.
- **Serving:** `effect` ships no Node adapter. `@effect/platform-node` and `@effect/vitest` are not installed. `HttpRouter.toWebHandler(layer)` returns `(Request) => Promise<Response>` for socketless tests.
- **Reference:** worked examples are in `node_modules/effect/ai-docs/src/51_http-server/`.

### Research
| Concern | Existing solution | Decision | Current requirement |
|---------|-------------------|----------|---------------------|
| HTTP server and listen | Fastify `listen` | delete (replaced by `@effect/platform-node` `NodeHttpServer`, new dependency) | US-1 |
| Route definitions | `*Routes.ts` Fastify plugins | modify (handlers in `HttpApiBuilder.group`) | US-1, US-2 |
| Endpoint contracts | TypeBox route `schema` blocks | new (`<X>Api.ts` `HttpApiGroup` per domain; replaces the route schemas) | US-2, US-5 |
| Request/response schemas | TypeBox `*Schema.ts` | modify (Effect Schema, same exported names and type aliases) | US-2 |
| Problem body | `HttpError.toProblemDetail` | modify (Schema error classes via `encodeToWithHeaders`) | US-3 |
| Domain error subclasses | ~50 classes extending `HttpError` subclasses | reuse | US-3 |
| Error to response | `globalErrorHandler` | delete (declared errors plus a global defect/404 middleware) | US-3 |
| JWT verification | `@fastify/jwt`, `fast-jwt` signer | modify (`fast-jwt` `createVerifier` in an `HttpApiMiddleware`) | US-4 |
| `OrgToken`, `RolePermissions`, `signJWT` | `src/auth.ts` | reuse | US-4 |
| Permission check | `hasPermissions` preHandler | modify (`requirePermissions` Effect in handlers) | US-4 |
| OpenAPI and docs UI | `@fastify/swagger(-ui)` | delete (`OpenApi.fromApi` plus `HttpApiSwagger`) | US-5 |
| Health | `server.get("/health")` | modify (`HttpRouter.add`) | US-1 |
| Load shedding | under-pressure | delete (listed change 1) | n/a |
| Service wiring | `makeServerRuntimeLayer` | reuse | US-1 |
| Runtime wrapper | `ServerRuntime` (`ManagedRuntime` + `runPromise`) | delete if only the Fastify server uses it | US-1 |
| Shutdown | `shutdown.ts` | delete or shrink (server finalizer) | US-6 |
| Route test harness | `fastify().inject` | modify (`HttpRouter.toWebHandler`) | US-2 |
| Idempotency header handling | `idempotency-key` read in routes | reuse the service; header declared on the endpoint | US-2 |

## Architecture
**Layer flow.** Routes (HttpApi handlers) → Services → Repositories and Entities → PostgreSQL. Only the transport edge, the schemas and the error base classes change. Services, repositories and entities keep their logic.

### Components
1. **Problem error base classes (`src/lib/errors.ts`).**
   - The eight base classes become Schema error classes: BadRequest 400, Unauthorized 401, Forbidden 403, NotFound 404, Conflict 409, TooManyRequests 429, InternalServer 500 and ServiceUnavailable 503. `InvalidIdError` stays a BadRequest subclass.
   - Encoded fields are `detail` and optional `retryable`. `retryAfterSeconds` and `cause` are kept on the instance and never encoded.
   - The problem body has one producer, `HttpError.toProblemDetail()`, used for both declared and edge-rendered problems; `encodeProblem` delegates to it.
   - Encoding uses `HttpApiSchema.encodeToWithHeaders`:
     - the body is `{type,status,title,detail,instance,traceId,retryable?}`, annotated with `httpApiStatus`; `instance` and `traceId` (uuidv7) are minted at encode time, as `toProblemDetail` does today;
     - the headers are `{ "retry-after"?: string }`, derived from `retryAfterSeconds`.
   - The `(message, options)` constructor and the `type`, `statusCode` and `title` members are kept, so the ~50 domain subclasses and their call sites keep `extends NotFoundError` and so on. They change only if a Schema-class constraint forces it (spike risk 1).
   - All problems share one `HttpError` base, so the settlement service's `instanceof HttpError && statusCode < 500` branch keeps working.
2. **API composition (`src/api.ts`).** `LedgerApi` is `HttpApi.make("ledger")` with all groups added, prefixed `/api`, with the `Authentication` middleware and OpenAPI annotations (title, description, version, servers, tags). It also owns the schema-error transform that maps `HttpApiSchemaError` of kind Params/Headers/Query/Payload to a `BadRequestError`. The transform is keyed by group and endpoint where the detail differs: `assets`/`create` gives "Invalid Asset creation request" and `assets`/`update` gives "Invalid Asset replacement request".
3. **Group contracts (`src/domains/**/<X>Api.ts`).** One `HttpApiGroup` per domain (new files). Each declares:
   - endpoints whose identifiers are today's operationIds (`OpenApi.Identifier`), with summary and tags;
   - Effect Schema params, query, headers and payload;
   - success schemas with today's status, using `WithHeaders` for `Location`;
   - an `error` list mirroring today's per-route problem set.

   Shared contract helpers live in `lib/ApiContract.ts` (`commonErrors`, `throttledErrors`, `operation`, `describedOperation`).

   Contracts are separate from handlers so that `api.ts` → groups → handlers has no import cycle.
4. **Handlers (`src/domains/**/<X>Routes.ts`, rewritten).** Each is `HttpApiBuilder.group(LedgerApi, "<group>", h => h.handle(...))`. A handler:
   1. calls `requirePermissions([...])`;
   2. reads `CurrentToken` (all domains except Organizations);
   3. calls `parseId` where it does today;
   4. calls the service and then `toResponse()`.

   The per-route oddities listed under "Parity hazards" stay where they live today. Every non-GET handler is registered with `runToCompletion` (`{ uninterruptible: true }`, from `lib/utils.ts`) so a client abort or the drain cap cannot interrupt a write; GET handlers stay interruptible.
5. **Schemas (`src/domains/**/<X>Schema.ts` and shared `src/lib/*`).**
   - Converted from TypeBox to Effect Schema, keeping the exported names and `type X = typeof X.Type` aliases so type-only imports in services and entities don't change.
   - Behaviour mapping:
     - query coercion comes from HttpApi's string codec; body values are not coerced (listed change 8);
     - body defaults use `Schema.withDecodingDefault`;
     - unknown fields are stripped by Effect's default excess-property handling, and Asset uses `onExcessProperty: "error"`;
     - `requireStringAmounts` and `validateMetadata` become inherent, because `Schema.String` rejects numbers.
   - `normalizeAssetCode` stays in `lib/AssetSchema.ts`. The `FastifyRequest` types in the Category and Statement schema files are deleted. `lib/schema.ts`, `lib/ListQuery.ts`, `lib/amounts.ts` and `lib/IdempotencySchema.ts` are converted in place.
6. **Auth (`src/auth.ts`).**
   - `CurrentToken` is a service holding the `OrgToken`.
   - `Authentication` is an `HttpApiMiddleware.Service` with `security: { bearer }`, `provides: CurrentToken` and `error: UnauthorizedError`. It verifies the token with `fast-jwt` `createVerifier` and the config secret, builds the `OrgToken`, and fails any problem with 401 "Invalid token" (logged).
   - `requirePermissions(perms)` is an Effect that fails with `ForbiddenError` and today's message. Because it runs inside the handler, after request decoding, an authenticated invalid request still gets 400 before 403, as today.
   - `OrgToken`, `RolePermissions` and `signJWT` are reused.
7. **Server layer (`src/server.ts`).** `serveApp(server, services)` composes the server. Services are built before the port opens and released after the drain, and shutdown is logged. `makeServerLayer(config)` (no overrides parameter) remains for the benches. The layer merges:
   - `HttpApiBuilder.layer(LedgerApi, { openapiPath: "/docs/json" })`;
   - `HttpApiSwagger.layer(LedgerApi, { path: "/docs" })`;
   - `HttpRouter.add("GET", "/health", {})`;
   - the group handler layers, the `Authentication` layer and the existing `makeServerRuntimeLayer` services;
   - a global router middleware that maps a problem defect (e.g. the `BadRequestError` thrown by `parseAmount`) to its encoded problem, an unknown route to a NOT_FOUND problem, malformed JSON to a BAD_REQUEST problem and any other defect to a logged 500 problem.
8. **Entrypoint (`src/index.ts`).** `NodeRuntime.runMain` launches the app over `NodeHttpServer.layer(createServer, { port: 3000, host: "::", ... })` with `keepAliveTimeout` 72000 and `requestTimeout` 0, together with `makeServerRuntimeLayer`.
   - SIGTERM/SIGINT interrupt the main fiber; the `NodeHttpServer` finalizer closes the server and drains in-flight requests, and the service layers are released afterwards.
   - `shutdown.ts` is deleted unless spike risk 3 shows that `connection: close` during drain needs a small middleware.
9. **Runtime (`src/runtime.ts`).** `makeServerRuntimeLayer` is reused as the services layer. `ServerRuntime` is deleted if nothing besides the Fastify server uses it.

### Lint boundaries
The `.oxlintrc.json` boundary map classifies every api file and bans importing the test harness and the HTTP framework outside the transport layer.

### Where logic lives
- **Business logic:** services and entities (unchanged).
- **IO:** repositories, plus the server and JWT verification at the edge.
- **Untrusted input:** parsed only by endpoint schemas (params, query, headers, payload) and the JWT verifier. Entities still own `fromRequest` and `fromRow`.

### Test seams
- **Route tests.** `makeTestWebHandler(servicesLayer)` and `testServicesLayer`, in `src/lib/testing.ts` (not `server.ts`), wrap `HttpRouter.toWebHandler` over the server layer. Tests send `new Request(...)` with real `signJWT` tokens against stubbed services (`Layer.succeed(Tag, stub)`). The `hasPermissions` spy assertions become behavioural tests: a role lacking the permission gets 403.
- **OpenAPI tests** assert on `OpenApi.fromApi(LedgerApi)` directly. The three snapshots are regenerated and reviewed against the equivalence rule.
- **`ServerRoutes.test.ts`** is ported to the new seam: error mapping, 500 sanitisation, the listed-change cases (404 body, malformed JSON, 415) and the SIGTERM drain against a real socket. Error encoding is covered through `ServerRoutes.test.ts` and the Routes suites; there is no standalone `lib/errors.test.ts`, `lib/ListQuery.test.ts` or `LedgerAccountCategoryApi.test.ts`, and Category OpenAPI assertions live in `LedgerAccountCategoryRoutes.test.ts`.
- **Route registration.** A test asserts every non-GET route is registered uninterruptible and every GET is not.
- **Repository tests** are unchanged.
- **Batch order (for the later plan):**
  1. Spike and shell: errors, auth, `api.ts`, server, entrypoint, and the Organizations group with its tests.
  2. The remaining eight groups.
  3. Delete Fastify, its plugins, `pino-pretty` and TypeBox (once unused), and port the benches.

## API Design
- **Endpoints.** The 50 `/api` routes keep their method, path, operationId, permissions, status and headers, so the route table in the current code is the contract. `/health` is unchanged. `/docs` serves the UI and `/docs/json` the spec. `/status` is removed (listed change 1).
- **Request contracts.** Each TypeBox schema becomes an Effect Schema with the same constraints: ID patterns, date-time, min/max, `minItems`/`maxItems`/`uniqueItems`, literal unions, nullables, records and defaults. `Intersect`, `Composite` and `Omit` become `Struct` field spreads or unions of structs. The AssetSelector `Never` branches become a union of two structs, each with the other key optional and `Schema.Never`.
- **Response contracts.** Responses are encoded through the declared success schema, so undeclared fields are stripped as today. Each success schema must accept every field `toResponse()` emits.
- **Errors.**
  - Each endpoint declares the problem classes it can return, starting from today's per-route sets.
  - The handler's typed error union must be a subset of the declared set, which TypeScript enforces.
  - Where a service can fail with a problem whose status isn't declared today, the status is added to that endpoint. Fastify renders it today anyway, so the wire response doesn't change, but the OpenAPI document gains a status.
  - The `unknown` error type on the Statement service is narrowed to its real problem union.
  - Response-encode failures become a logged 500 problem, not HttpApi's default 400.
- **Auth contract.** The security scheme is generated from `Authentication`. It replaces today's `bearerAuth` apiKey scheme with a bearer scheme, checked under the OpenAPI-equivalence rule.
- **Dependencies.**
  - Add `@effect/platform-node@4.0.0-rc.112`.
  - Remove `fastify`, all `@fastify/*` packages and `pino-pretty`.
  - Remove `@sinclair/typebox` once no imports remain.
  - `fast-jwt` stays.

## Data Model
No schema changes and no migrations. `src/db/schema.ts` keeps its `AlertCondition` import, which now resolves to the Effect Schema type.

## Trade-offs
- **Alternatives rejected:**
  - *HttpApi plus a problem adapter:* lower churn, but errors stay outside Effect Schema and a wrapper must map each one.
  - *Raw `HttpRouter`, no HttpApi:* loses the generated OpenAPI, which US-5 requires.
  - *Strangler, one spec per domain:* needs temporary bridging for auth, errors and merged OpenAPI.
  - *Porting under-pressure as middleware:* infrastructure owns load shedding.
- **Why this approach wins:**
  - One typed error model from the repository to the wire.
  - OpenAPI derives from the same schemas that validate requests.
  - TypeScript proves each endpoint declares every problem it can return.
- **Cost accepted:** making the base errors Schema classes reaches beyond the router into `src/lib/errors.ts` and, if the constructor constraint bites, the ~50 domain error classes.
- **Known limitations:**
  - `effect/unstable/*` APIs may change between release candidates, hence the exact pinning.
  - The 400 `detail` text changes.
  - The OpenAPI document is equivalent, not byte-identical, and snapshots are regenerated and reviewed. Known differences:
    - it is generated as 3.1.0 (legacy 3.0.x);
    - `additionalProperties: false` is emitted on object schemas, and request/response schemas are `$ref` components;
    - a bearer security scheme replaces the `bearerAuth` apiKey scheme;
    - error responses are described by class names and carry a `retry-after` header whose schema is an integer for 400/401 and a string pattern for other statuses (Effect generator behaviour);
    - new tag descriptions for several groups;
    - extra declared statuses: 404 on settlement create and on balance-monitor list (the services can fail with NotFound; Fastify rendered it anyway).
  - The category-balances benchmark fails its own assertions identically on the Fastify baseline (f651edd: 160 non-2xx on category reads) and on the Effect server.

## Open Questions
None block the design. The first implementation batch is a spike that settles three risks before the work fans out. If a result invalidates an approved section, that section comes back for approval.
1. Can the Schema error classes keep the `(message, options)` constructor, with `cause` and `retryAfterSeconds` outside the encoded shape? Fallback: a mechanical constructor change in the domain error files.
2. Does the schema-error transform separate request kinds (Params, Headers, Query, Payload) from response kinds (Body, ResponseHeaders), so that response-encode failures render as a logged 500 problem?
3. Does the `NodeHttpServer` finalizer drain in-flight requests on interruption, and how is `connection: close` set while draining? Fallback: a small middleware plus a `server.close` finalizer.
