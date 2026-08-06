# Organizations Effect Migration

## Problem

The five Organization endpoints currently follow the repository's original Fastify service and repository pattern. Their service is a thin Promise-based wrapper, persistence code raises transport-oriented errors, and the Organization entity mixes HTTP, database, and domain concerns. This makes business behavior difficult to test independently and does not establish the functional-core and Effect architecture required by `EFFECT_MIGRATION.md`.

The migration needs to prove the target architecture through one complete vertical slice. It must establish reusable runtime, Layer, tagged-error, and full-stack testing patterns while preserving Fastify with TypeBox as the HTTP adapter and Drizzle with PostgreSQL as the persistence adapter.

The users affected are platform operators who manage every Organization and Organization users who may read or manage only their own Organization. Today those callers use the existing `/api/organizations` routes; this migration keeps those paths and payload shapes while making authorization and failure behavior explicit.

Success means all five Organization endpoints run through a pure domain and Effect application layer, use real PostgreSQL persistence, share a Redis-backed rate limiter, and are covered by an HTTP-to-PostgreSQL integration pattern that later resources can copy.

## Scope

### In scope

- Migrate list, get, create, update, and delete Organization endpoints.
- Introduce the Organization functional core, Effect application services, repository capability, and live adapters.
- Establish one managed Effect runtime per Fastify server with scoped PostgreSQL and Redis resources.
- Establish exhaustive tagged-error-to-RFC-7807 mapping for the migrated slice.
- Enforce tenant-aware Organization authorization and Redis-backed rate limiting.
- Add real Fastify-to-PostgreSQL and Redis integration-test patterns.
- Adjust shared API infrastructure only where required to host the new runtime while keeping unrelated resources on their existing behavior.
- Update the Organization endpoint semantics described in this document, including `201` for create and `204` for delete.

### Out of scope

- Migrating Ledger or any other API resource to Effect.
- Changing `apps/web`, `apps/docs`, or shared workspace packages.
- Changing Organization database tables or backfilling data. Schema changes are limited to the
  approved indexes on direct Organization foreign keys in existing Ledger tables.
- Adding Organization-name uniqueness, optimistic concurrency, cursor pagination, events, or retry schedules.
- Adding an explicit API operation to clear an Organization description.
- Adding rate limiting to health, documentation, Ledger, or other API routes.
- Updating domain terminology in `CONTEXT.md`; its definition of Organization already matches this design.

The future implementation is scoped to `apps/api/`. The root lockfile may change when API dependencies are installed, but no other application or shared-package implementation is part of the migration.

## User Stories

All stories are must-have.

### US-1: List Organizations

As a platform operator, I want to list Organizations so that I can administer tenants across the platform. As an Organization user, I want the same endpoint to return only my Organization.

- Given `organization:read`, when the caller lists Organizations, then the response contains all matching rows.
- Given only `my:organization:read`, when the caller lists Organizations, then filtering occurs in PostgreSQL and only the JWT actor Organization can be returned.
- Given both permissions, platform access wins.
- Results are ordered by Organization ID and use validated offset pagination.
- Invalid query input returns `400`, missing or invalid authentication returns `401`, and insufficient permission returns `403`.

### US-2: Get an Organization

As an authorized caller, I want to retrieve an Organization by ID.

- A platform reader may retrieve any Organization.
- A current-Organization reader may retrieve only the Organization identified by the JWT actor ID.
- A current-Organization mismatch returns `403` before the repository checks whether the target exists.
- A malformed Organization TypeID returns `400`; an allowed but absent Organization returns `404`.

### US-3: Create an Organization

As a platform operator, I want to create an Organization.

- Only `organization:write` authorizes creation; current-Organization write permission is insufficient.
- The server generates a canonical Organization TypeID through an injected ID generator.
- PostgreSQL supplies creation and update timestamps.
- A successful response is `201 Created`, includes the created representation, and sets `Location` to the new resource.
- Duplicate names are valid and do not produce a synthetic conflict.

### US-4: Update an Organization

As an authorized caller, I want to update an Organization's mutable fields.

- A platform writer may update any Organization.
- A current-Organization writer may update only the JWT actor Organization.
- A supplied description replaces the stored value; an omitted description preserves it.
- An allowed but absent Organization returns `404`.
- The response is `200` with the updated representation, and duplicate names remain valid.

### US-5: Delete an Organization

As an authorized caller, I want to delete an Organization when it has no dependent records.

- A platform writer may delete any Organization.
- A current-Organization writer may delete only the JWT actor Organization.
- A missing Organization returns `404`.
- A real PostgreSQL foreign-key dependency returns `409 Conflict`.
- A successful deletion returns `204 No Content`, after which the Organization is unavailable.

### US-6: Reusable Effect foundation

As an API maintainer, I want a complete, testable reference slice so that subsequent migrations have an established pattern.

- One runtime is created per Fastify server and disposed once during server shutdown.
- Domain code is pure and has no Effect, Fastify, Drizzle, environment, or database imports.
- Application and repository capabilities use Effect 4 `Context.Service` services and Layers.
- Expected failures are typed and mapped exhaustively to RFC 7807 responses.
- Full-stack tests execute the real HTTP lifecycle against PostgreSQL and Redis.

## Constraints

- `CONTEXT.md` is authoritative for domain language and invariants.
- API dependencies flow from routes to application services to repositories and entities to PostgreSQL.
- Fastify and TypeBox remain transport adapters; Drizzle remains the SQL adapter.
- Authentication remains an HTTP concern. The verified JWT actor Organization ID is passed explicitly into every application use case.
- Effect 4 beta is the effect system. The API tracks the `beta` distribution tag, while the lockfile pins the resolved beta for reproducible installs. The runtime is shared rather than constructed per request.
- PostgreSQL is required for API integration tests. Redis/Valkey is required for rate-limit integration tests.
- Tests follow stub-driven TDD at the narrowest useful layer, with live infrastructure reserved for adapter and full-stack behavior.
- Validation and CI run under the repository's supported Node 24 toolchain.
- Unrelated work in the branch or worktree must be preserved.

## Context

### Current implementation

The current Organization routes expose:

- `GET /api/organizations`
- `GET /api/organizations/:id`
- `POST /api/organizations`
- `PUT /api/organizations/:id`
- `DELETE /api/organizations/:id`

Fastify and TypeBox validate transport input. A Promise-based Organization service delegates to a Drizzle repository, and the existing Organization entity combines domain, persistence, serialization, Luxon, and TypeID responsibilities. Repository errors are coupled to HTTP behavior. Route tests mock the service, service tests mock the repository, and repository tests use PostgreSQL; there is no reusable test that runs the complete Fastify-to-PostgreSQL path.

The existing permission helper checks every supplied permission even though its message says "one of". Organization is the only current caller that supplies alternative platform and current-tenant permissions. The migration therefore introduces an explicit any-permission/access decision for Organization without changing unrelated permission behavior.

List queries currently have no deterministic ordering. Update already distinguishes a missing row, while delete silently succeeds for a missing row. PostgreSQL dependency failures currently fall through as `500`. Organization names are not unique, so existing create/update conflict expectations are synthetic rather than schema-backed.

The existing repository plugin creates and owns a PostgreSQL pool, including when a database adapter is injected, and delays shutdown. The Effect runtime must become the single resource owner while legacy repositories temporarily continue through the same Drizzle connection.

The repository's Compose configuration already supplies Valkey on port 6379. No Compose change is required for Redis-backed rate limiting.

## Architecture

### Selected approach

Use a native Effect vertical slice with a shared server runtime:

```text
Fastify/TypeBox handler
        |
        v
Organization application service returning Effect
        |
        v
Organization repository capability returning Effect
        |
        v
Drizzle/PostgreSQL adapter
```

"Effect" is not a separate business layer. The domain is the pure vocabulary and rules used by the application service. The service represents application use cases: it receives the authenticated actor, applies access policy, orchestrates ID generation and persistence, and returns an Effect describing its dependencies and typed failures.

The physical layout is a flat vertical slice with a dedicated pure-domain boundary:

```text
apps/api/src/organizations/
  domain/
    Organization.ts
    OrganizationId.ts
    OrganizationAccess.ts
    OrganizationErrors.ts
  OrganizationService.ts
  OrganizationRepo.ts
  OrganizationIdGenerator.ts
  OrganizationRoutes.ts
  OrganizationSchema.ts
  OrganizationAuthorization.ts
  OrganizationHttpErrors.ts
  OrganizationRateLimit.ts
  index.ts

apps/api/src/database/
apps/api/src/runtime/
apps/api/src/http/
```

`domain/` remains separate because it is a meaningful purity boundary. All other application, HTTP, PostgreSQL, row-decoding, and ID-generation modules live at the slice root; the slice does not create `application/` or `adapters/` directories. Each responsibility-named capability module co-locates its contract, Effect tag, concrete implementation, and production or test Layers. The slice entrypoint exports the public Organization contract and composed Layer while concrete Live classes and row codecs remain private. Cross-slice imports use this entrypoint.

### Functional core

The Organization domain contains:

- A branded canonical Organization ID.
- An immutable Organization entity with `id`, `name`, optional `description`, and immutable UTC Luxon `DateTime` values for `created` and `updated`.
- Create and update inputs that preserve the distinction between an omitted description and a supplied description through explicit preserve/replace intent.
- Pure access decisions for platform versus current-Organization capabilities.
- Pure TypeID parsing and validation that returns a value or an explicit domain error rather than throwing.

The domain represents an absent description as `undefined`. PostgreSQL `null` is normalized at the adapter boundary, and HTTP serialization omits an absent description. An update property explicitly present with the value `undefined` is invalid rather than an operation to clear the description; omission preserves the stored value and a supplied string replaces it.

### Application services

`OrganizationService`, `OrganizationRepo`, and `OrganizationIdGenerator` are constructor-injected classes whose methods return Effects. Separate Effect 4 `Context.Service` tags and small Layers wire their instances into the runtime.

The service exposes list, get, create, update, and delete use cases. Each use case receives the actor Organization ID even when a platform permission permits cross-tenant access. The HTTP adapter supplies an access mode derived from verified permissions; the service applies the corresponding pure access rule.

Current-Organization access is checked before lookup for get, update, and delete. Current-Organization list scope is passed to the repository so PostgreSQL performs tenant filtering. The repository returns absence explicitly rather than throwing transport errors.

The generated-ID capability is injectable so service tests can remain deterministic. No automatic retry is added for an unexpected generated primary-key collision; it is treated as an unexpected persistence failure.

### PostgreSQL adapter

The Drizzle adapter implements the repository capability and is solely responsible for SQL and row decoding:

- List applies the requested tenant scope, orders by ID ascending, and applies `LIMIT`/`OFFSET`.
- Get returns an optional domain entity.
- Create uses `INSERT ... RETURNING` and database timestamp defaults.
- Update uses one `UPDATE ... RETURNING` statement, updates `updated` to the database's current time, and excludes `description` from the assignment when it was omitted.
- Delete uses `DELETE ... RETURNING`; no returned row means not found.
- PostgreSQL error `23503` from delete maps to an Organization-has-dependents error.
- Database connectivity failures map to a retryable repository-unavailable error.
- Invalid persisted rows map to a non-public persistence-decoding error.

All promises are captured with Effect constructors so rejected operations remain in the typed error channel. SQL and Drizzle values do not escape the adapter.

### Runtime and resource ownership

`buildServer` creates one `ManagedRuntime` containing the live configuration, PostgreSQL pool, Drizzle database, Redis client, Organization repository, ID generator, and Organization service Layers.

The production PostgreSQL Layer owns its pool. Its finalizer delegates graceful client closure to `pool.end()`, logs cleanup failures, and completes without failing shutdown. The deployment supervisor owns the outer process-shutdown deadline. A test Layer may wrap an externally supplied database without taking ownership. During the transition, the legacy repository plugin receives the runtime-owned Drizzle database and stops creating or closing another pool. This is an infrastructure bridge only; unrelated repositories and services retain their current interfaces and behavior.

The Redis Layer owns one `ioredis` client configured from `REDIS_URL` with bounded connection timeout and command retries. Its finalizer attempts graceful shutdown and disconnects without leaving Fastify shutdown hanging. Fastify's `onClose` hook shares one disposal promise so concurrent close paths dispose the managed runtime once, after request handling has stopped. The existing artificial repository shutdown delay is removed.

### HTTP adapter

The Fastify adapter owns JWT authentication, permission extraction, TypeBox schemas, HTTP status codes, headers, serialization, and invocation of the shared runtime. A reusable Effect HTTP runner:

1. Obtains the Organization application service from the runtime.
2. Runs the returned Effect with `ManagedRuntime.runPromise`.
3. Exhaustively maps expected tagged failures to RFC 7807.
4. Converts unexpected defects to a sanitized `500` without leaking persistence details.

Handlers do not call Drizzle or repositories directly. They translate transport values into domain/application inputs, call one use case, and translate its success value into the existing response DTO.

### Authorization

The access matrix is:

| Operation | Platform permission  | Current-Organization permission | Current-Organization constraint |
| --------- | -------------------- | ------------------------------- | ------------------------------- |
| List      | `organization:read`  | `my:organization:read`          | SQL filter to actor ID          |
| Get       | `organization:read`  | `my:organization:read`          | Target must equal actor ID      |
| Create    | `organization:write` | None                            | Platform only                   |
| Update    | `organization:write` | `my:organization:write`         | Target must equal actor ID      |
| Delete    | `organization:write` | `my:organization:write`         | Target must equal actor ID      |

Platform permission wins when both forms are present. Target mismatches are `403` regardless of whether the requested Organization exists, preventing existence disclosure.

### Error model

Expected failures are discriminated tagged errors:

| Error                                  | HTTP status | Notes                                      |
| -------------------------------------- | ----------- | ------------------------------------------ |
| Invalid Organization ID or request     | `400`       | Safe validation detail                     |
| Authentication failure                 | `401`       | Existing JWT transport behavior            |
| Access denied                          | `403`       | No target-existence disclosure             |
| Organization not found                 | `404`       | Allowed lookup or mutation found no row    |
| Organization has dependents            | `409`       | Only a real delete foreign-key violation   |
| Rate limit exceeded                    | `429`       | Includes `Retry-After`                     |
| Repository unavailable                 | `503`       | Retryable PostgreSQL failure               |
| Rate-limit store unavailable           | `503`       | Redis failure; fail closed                 |
| Persistence decoding failure           | `500`       | Sanitized, non-retryable response          |
| Unexpected persistence error or defect | `500`       | Sanitized response and server-side logging |

Problem responses use the API's RFC 7807 representation and include the request URL as `instance` and Fastify request ID as `traceId`. Organization context may be included when it is safe. Error mapping is exhaustive for the migrated Effect error union. Unrecognized defects remain the responsibility of the global error boundary.

### Redis-backed rate limiting

Register `@fastify/rate-limit` with `global: false` and the runtime-owned `ioredis` client. Create one manual limiter and invoke it in the Organization HTTP adapter after successful JWT authentication. Authentication failures therefore do not consume an Organization bucket.

All five endpoints share a bucket keyed by the authenticated actor Organization ID. The stable environment-qualified namespace prevents collisions between deployments while allowing every API instance in one environment to share counters:

```text
exchequer:<environment>:organizations:<actor-organization-id>
```

Configuration is owned by the API:

| Setting                             | Requirement      | Default |
| ----------------------------------- | ---------------- | ------- |
| `REDIS_URL`                         | Required         | None    |
| `ORGANIZATION_RATE_LIMIT_MAX`       | Positive integer | `1000`  |
| `ORGANIZATION_RATE_LIMIT_WINDOW_MS` | Positive integer | `60000` |

Allowed responses include limit, remaining, and reset headers. Exceeded responses additionally include `Retry-After` and an RFC 7807 `429` body. Redis storage errors are not skipped: the pre-handler translates them to a tagged rate-limit-store-unavailable failure and returns a sanitized `503`. Other API routes remain available when Redis is unavailable.

## API Design

The endpoint paths and JSON field names remain stable.

### Representation

```json
{
	"id": "org_...",
	"name": "Example Organization",
	"description": "Optional description",
	"created": "2026-08-04T10:00:00.000Z",
	"updated": "2026-08-04T10:00:00.000Z"
}
```

`description` is omitted when absent. Dates are ISO 8601 date-time strings.

### List

`GET /api/organizations?offset=0&limit=20`

- `offset`: integer, default `0`, minimum `0`.
- `limit`: integer, default `20`, minimum `1`, maximum `100`.
- Success: `200` with an array of Organization representations.
- Ordering: Organization ID ascending.

### Get

`GET /api/organizations/:id`

- `id` must be a canonical Organization TypeID.
- Success: `200` with one Organization representation.

### Create

`POST /api/organizations`

```json
{
	"name": "Example Organization",
	"description": "Optional description"
}
```

- `description` is optional.
- Success: `201`, the created representation, and `Location: /api/organizations/{id}`.
- Create does not advertise or produce `409` for a duplicate name.

### Update

`PUT /api/organizations/:id`

```json
{
	"name": "Updated Organization",
	"description": "Optional replacement"
}
```

- `name` is replaced.
- A supplied `description` is replaced; omission preserves the stored description.
- Success: `200` with the updated representation.
- Update does not advertise or produce `409` for a duplicate name.

### Delete

`DELETE /api/organizations/:id`

- Success: `204` with no response body.
- Missing: `404`.
- Existing PostgreSQL dependencies: `409`.

### Documented errors

Organization operations document applicable `400`, `401`, `403`, `404`, `429`, `500`, and `503` responses. Delete additionally documents `409`. OpenAPI schemas use the same RFC 7807 representation emitted at runtime.

## Data Model

The existing Organization table remains authoritative and unchanged. Review follow-up adds B-tree
indexes on the direct `organization_id` foreign keys in Ledgers, Ledger Accounts, Ledger
Transactions, and Ledger Transaction Entries so PostgreSQL dependency checks do not scan those
tables during Organization deletion.

- Names remain non-unique; no index or constraint is added.
- Existing timestamp defaults remain in PostgreSQL.
- Existing foreign keys enforce deletion safety.
- Update concurrency remains last-write-wins.
- The adapter validates every returned row before constructing a domain entity.

Migration `0003_blue_kid_colt.sql` uses transactional `CREATE INDEX`, as required by the standard
Drizzle PostgreSQL migrator. It must be timed against production-scale data and applied during a
write maintenance window. The migration runbook records the preflight and verification steps.

## Testing Strategy

Each test owns one boundary contract. A scenario is repeated across layers only when the
lower test proves adapter translation and the upper test proves externally observable
composition. Full-stack HTTP tests own public CRUD behavior; lower layers do not replay the
same CRUD matrix.

### Pure domain tests

- Table-driven canonical, malformed, wrong-prefix, and non-canonical Organization ID parsing.
- The complete platform/current capability truth table, target access, and list-scope decisions.
- Update behavior for supplied, omitted, and explicitly undefined descriptions.
- Immutability and actual non-UTC-to-UTC normalization without retesting Luxon behavior.

### Application Layer tests

- Provide typed `vi.mocked` repository and ID-generator implementations through `Layer.succeed` at the capability boundary.
- Verify only application orchestration: repository arguments, SQL scope intent, absence
  handling, generated IDs, and operation-specific error eligibility.
- Verify denied and cross-Organization access occurs before repository or ID-generator calls.
- Use one representative infrastructure failure per operation rather than a cross-product of
  every repository failure and use case.

### PostgreSQL adapter tests

- Run SQL-contract tests against PostgreSQL using isolated unique TypeIDs.
- Cover deterministic ordering, tenant filtering and pagination, update omission behavior,
  safe row decoding, and PostgreSQL error translation.
- Create a real dependent Ledger row and verify PostgreSQL `23503` maps to
  Organization-has-dependents; the HTTP suite separately verifies that error maps to `409`.
- Do not terminate backends, deliberately abort transactions, or rely on global table offsets.
- Clean up rows in reverse dependency order; do not truncate shared tables.

### Full-stack HTTP-to-PostgreSQL tests

Create a reusable harness that starts a real Fastify server instance through `buildServer`, supplies the live managed runtime, signs JWTs, and uses Fastify `inject` to execute the complete HTTP lifecycle. Services and repositories are not mocked.

The ordinary HTTP suite uses an externally owned Redis test Layer. Real Redis is reserved for
the distributed rate-limit suite.

Cover:

- One assembled create/get/list/update/delete journey and the five public success contracts.
- Platform and current-Organization permission paths.
- Platform precedence when both permissions are present.
- Tenant-filtered list results and cross-tenant `403` before existence lookup.
- Malformed IDs and query/body validation.
- Missing resources.
- Real dependent-row delete conflict.
- Duplicate Organization names remaining valid.
- OpenAPI contract alignment.

### Redis tests

- Use the real Compose-managed Redis/Valkey service with unique, short-lived test namespaces.
- Inject a low quota and split requests across two Fastify server instances; the shared actor bucket must be exhausted across instances.
- Verify another actor has an independent bucket.
- Verify rate-limit and reset headers before exhaustion and `Retry-After` plus RFC 7807 after exhaustion.
- Verify invalid JWTs do not consume the valid actor's bucket.
- Use an injected failing limiter or store for deterministic `503` mapping without stopping the shared Redis service.

### Lifecycle and regression tests

- Verify one runtime per server, startup-failure cleanup, and one-time disposal using
  deterministic probes without wall-clock assertions.
- Verify injected test resources are not incorrectly closed by production ownership logic,
  with at most one real-resource connectivity smoke test per infrastructure boundary.
- Run focused Organization tests, the complete API suite, API format/lint/type checks, and full CI under Node 24.

## Trade-offs

### Native Effect vertical slice versus a thin wrapper

The selected approach makes application services and repository capabilities native Effect programs. A thinner alternative would wrap the current Promise service at the handler boundary. That would be faster initially but preserve transport-coupled repositories, mixed entities, and weak dependency modeling, so it would not establish the migration architecture.

### Vertical slice versus migrating the complete API graph

Migrating every resource at once would remove the temporary dual architecture but greatly expand risk and violate the Organization scope. The shared runtime and database bridge deliberately support gradual resource-by-resource adoption.

### Flat vertical slice versus layer directories

Keeping the domain boundary and every other module at the `organizations/` root makes the complete slice discoverable and gives later resources a repeatable template. `application/` and `adapters/` directories would add navigation depth without adding an ownership boundary. Each future slice adds its own public `index.ts` and explicit dependency edges when migrated; child-to-parent dependencies may be allowed, while parent-to-child and sibling dependencies remain disallowed unless explicitly designed.

### Redis versus in-memory rate limiting

Redis adds a required runtime dependency but preserves one quota across API processes and client IP changes. An in-memory limiter would be simpler but would multiply effective capacity with every API instance and fail to represent the authenticated Organization as a platform-wide actor.

### Fail closed versus fail open

Redis failure returns `503` for Organization routes. This sacrifices partial availability to preserve the explicitly selected rate-limit guarantee. Other API routes are unaffected.

### Constraint-driven delete conflict versus preflight checks

Mapping the PostgreSQL foreign-key violation avoids a race between checking dependencies and deleting. A preflight query would add work without replacing the database constraint as the source of truth.

### Intentional compatibility changes

Create changes from `200` to REST-standard `201` with `Location`; delete changes from `200` to `204`. These are intentional public contract changes and must be reflected in TypeBox/OpenAPI schemas and tests.

## Known Limitations

- The API temporarily contains both legacy Promise-based resources and the new Effect slice.
- Offset pagination can shift under concurrent writes; cursor pagination is deferred.
- Updates remain last-write-wins with no version field.
- Description can be replaced or preserved but not explicitly cleared through this contract.
- Organization routes depend on Redis availability by design.
- No application-level retries are introduced for PostgreSQL or Redis operations.

## Open Questions

None. Scope, architecture, endpoint behavior, authorization, rate limiting, failure policy, resource ownership, and testing strategy are resolved for implementation planning.
