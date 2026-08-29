# Balance Monitors Effect migration

## Problem

The Ledger Account Balance Monitor resource still uses the API's legacy Promise service,
repository plugin, route handler, and entity wiring. Organizations, Ledgers, Accounts, and
Transactions already run through the server's managed Effect runtime. Balance Monitors must join
that runtime without changing their observable behavior except for the approved request Account ID
prefix validation described below.

API clients currently use five CRUD endpoints. API maintainers support the resource through a
service that delegates to a Drizzle repository. The current implementation is incomplete as a
Balance Monitor product, but this migration does not complete it. It changes the execution model
and code ownership only.

Success means the complete Balance Monitor CRUD slice runs through Effect, follows the integrated
resource structure, removes its legacy Promise wiring, and passes characterization tests with only
the approved Account ID prefix deviation.

## Scope

### In scope

- Migrate all five Balance Monitor CRUD operations to Effect.
- Relocate the resource to `apps/api/src/domains/ledgers/accounts/balance-monitors`.
- Add a domain model, repository capability and live adapter, application service, routes, TypeBox
  schemas, resource errors, tests, and one composed Layer.
- Add the composed Layer and service capability to the shared managed runtime.
- Remove the superseded Balance Monitor Promise service, repository, entity, route, plugin wiring,
  fixtures, tests, exports, and snapshots.
- Preserve the existing HTTP, domain, error, persistence, transaction, concurrency, identifier,
  timestamp, and operational behavior except for strict request Account ID prefix validation.

### Out of scope

- Scoping a Balance Monitor to the Organization, Ledger, or Account path.
- Checking that a path Account exists or matches the request body Account.
- Persisting or evaluating alert conditions.
- Detecting condition crossings, rearming a monitor, or emitting webhooks.
- Returning live balances or changing the placeholder response.
- Adding active-state operations, optimistic locking, retries, idempotency, or explicit
  transactions.
- Changing pagination constraints, success status codes, public schemas, database schemas, indexes,
  migration history, or error statuses beyond the approved Account ID validation deviation.
- Refactoring shared schemas, runtime infrastructure, or adjacent resources beyond the wiring
  required to replace the Balance Monitor slice.

Each out-of-scope behavior requires a separate design, plan, branch, and change set before
implementation.

## User stories

All stories are must-have.

### US-1: Preserve the HTTP contract

As an existing API client, I want to use every Balance Monitor endpoint without changing request or
response handling.

- Given a request accepted before the migration, when the client sends the same request after the
  migration, the route accepts it under the same authentication and permission rules unless the
  body Account ID has a canonical non-`lat` prefix.
- Paths, methods, request bodies, pagination defaults, response bodies, status codes, headers,
  operation IDs, tags, and advertised error schemas remain unchanged.
- Create and delete continue to return `200`.
- Deterministic response fields remain byte-for-byte compatible.

### US-2: Preserve persistence and failure behavior

As an API operator, I want Balance Monitor persistence and failures to behave as they did before the
migration.

- The repository runs the same SQL predicates, ordering, limits, offsets, assignments, and
  `RETURNING` operations.
- Missing get and delete operations return the same `404` behavior. Missing updates return `404`
  when the body Account ID is valid.
- PostgreSQL and unexpected failures return a sanitized `500` response.
- Mutations remain single SQL statements with last-writer-wins concurrency.
- The migration adds no transaction boundary, lock, retry, or idempotency mechanism.

### US-3: Run the complete resource through Effect

As an API maintainer, I want the complete Balance Monitor resource to use the server's managed
Effect runtime.

- Routes run service Effects through the existing server runtime.
- The service owns use-case orchestration, identifier generation and parsing, and application time.
- The repository owns Drizzle I/O and persistence failure translation.
- The domain model owns request, row, persistence, and response transformations.
- The runtime provides the repository and service Layers.
- No live Balance Monitor operation uses the legacy Promise service or repository plugin.

### US-4: Prove that the change is a migration

As a reviewer, I want the diff and tests to distinguish the migration from product development.

- Existing observable characterization coverage remains present and passes; duplicate assertions
  and tests of shared Fastify behavior may be consolidated without weakening the contract.
- New tests cover only the changed Effect boundaries. They add no runtime-only wrapper, reusable
  harness, or repeated CRUD error matrix.
- The diff contains no schema migration, product completion, duplicated validation, handwritten
  mirror type, speculative abstraction, or unrelated cleanup.
- Discovery of a desired behavioral change stops implementation until separate work is approved.

## Constraints

- Use Organizations as the basic CRUD Effect reference.
- Use Transactions as the nearest approved and integrated slice for the current runtime, nested
  Ledger routes, typed failures, and Effect-enabled Drizzle conventions.
- Copy a reference pattern only when Balance Monitors have the same present requirement.
- Keep Fastify and TypeBox at the HTTP boundary and Drizzle at the PostgreSQL boundary.
- Derive request, response, and row types from TypeBox and Drizzle.
- Keep pure transformations free of I/O.
- Use branch `feat/balance-monitors-effect` and worktree
  `/Users/martinrichards/code/exchequerio/.worktrees/balance-monitors-effect`.
- Preserve unrelated work. Do not commit, push, or open a pull request without explicit approval.

## Context

### Current HTTP behavior

The resource is registered under:

```text
/api/ledgers/:ledgerId/accounts/:accountId/balance-monitors
```

The routes expose list, get, create, update, and delete operations. They authorize with the existing
`ledger:account:balance_monitor:read`, `ledger:account:balance_monitor:write`, and
`ledger:account:balance_monitor:delete` permissions.

The route prefix contains Ledger and Account identifiers, but the handlers neither validate nor
pass those identifiers. List returns monitors from every Account. Get, update, and delete select a
monitor only by its Balance Monitor ID. Create and update use the Account ID in the request body,
even if it differs from the path Account ID.

The request body contains `accountId`, optional `description`, `alertCondition`, and optional
metadata. TypeBox accepts any string as the body Account ID. It validates each alert condition, but
the service ignores the array. Metadata values accepted over HTTP are strings.

The response returns an empty alert-condition array, three zero-valued USD balance objects with
exponent `2`, and `lockVersion: 0`. These values are placeholders. The current implementation does
not evaluate balances, track crossings, rearm monitors, or send webhooks.

### Current domain and persistence behavior

Creation generates an `lbm` TypeID. The legacy parser treated the request Account ID as a `lat`
TypeID at compile time but accepted any canonical TypeID prefix at runtime. The migrated service
requires the `lat` prefix. The internal name is the description or `"Balance Monitor"`. Creation and
update force the stored threshold to `0` and active state to `true`.

The table stores metadata as JSON text. Reading malformed JSON silently produces absent metadata.
Update passes `undefined` for an omitted description or metadata value, so Drizzle preserves that
column. The derived name still becomes `"Balance Monitor"` when the description is omitted.

List orders by `created DESC` and has no stable tie-breaker. Get, update, and delete predicate only
on the Balance Monitor ID. Create, update, and delete each execute one statement. There is no
optimistic lock, explicit transaction, or retry.

PostgreSQL supplies `created`. Application wall-clock time supplies `updated` on create and update.
Responses serialize both timestamps as ISO strings.

Fastify maps route validation to `400`, authentication to `401`, permission failures to `403`, and
missing rows to `404`. Raw database and unexpected failures become sanitized `500` responses.
Malformed request Account IDs pass TypeBox and fail later, producing the same sanitized `500`.

### Reference slices

Organizations provides the minimal resource model, Effect service, repository capability, Layer,
route execution, and error-channel pattern. Its retrospective is authoritative where its original
design added unnecessary infrastructure.

Transactions is the nearest integrated dependency. It provides the current server runtime,
Effect-enabled Drizzle adapter, nested Ledger route conventions, and resource-slice layout. Its
retry, locking, idempotency, transaction, and Account-projection behavior does not apply to Balance
Monitors.

## Research

| Concern               | Existing solution                                                     | Decision | Current requirement                                                |
| --------------------- | --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| References            | Implemented Organizations and Transactions slices                     | reuse    | Follow proven CRUD and integrated runtime patterns                 |
| HTTP surface          | Five nested Fastify routes and current TypeBox contracts              | modify   | Preserve the surface except for approved validation precedence     |
| Path scope            | Parent Ledger and Account parameters are ignored                      | reuse    | Preserve current lookup and tenancy behavior                       |
| Request behavior      | Body Account ID, optional description, alert conditions, and metadata | modify   | Require a `lat` Account ID and keep alert conditions ignored       |
| Domain construction   | Legacy entity derives name, IDs, threshold, and active state          | modify   | Move the same transformations into the resource domain model       |
| Response              | Empty conditions, zero balances, lock version zero                    | reuse    | Preserve the current JSON representation                           |
| Alert evaluation      | No evaluator, rearm state, or webhook delivery                        | reuse    | Keep product completion outside the migration                      |
| Persistence           | Existing Drizzle table and CRUD statements                            | modify   | Return Effects while preserving SQL and row conversion             |
| Transactions          | One SQL statement per mutation                                        | reuse    | Add no transaction boundary                                        |
| Concurrency           | Last writer wins                                                      | reuse    | Add no lock, retry, or idempotency mechanism                       |
| Identifiers           | Shared TypeID types, parsers, and generators                          | reuse    | Enforce the request Account ID prefix through the shared parser    |
| Timestamps            | PostgreSQL `created` and application `updated`                        | modify   | Express application time through Effect without changing ownership |
| Errors                | Shared HTTP errors and global Fastify handler                         | modify   | Preserve results except for approved validation precedence         |
| Runtime               | One server ManagedRuntime and live database Layer                     | modify   | Provide the new repository and service Layers                      |
| Resource layout       | Legacy route, service, repository, and entity directories             | modify   | Replace them with the approved integrated domain slice             |
| Legacy wiring         | RepoPlugin and ServicePlugin registrations                            | delete   | No Promise adapter remains for the migrated resource               |
| Effect capabilities   | Resource repository tag, service tag, and composed Layer              | new      | The complete resource must run through the managed runtime         |
| Resource errors       | Typed not-found and internal persistence failures                     | new      | Effect must retain current `404` and sanitized `500` semantics     |
| Tests                 | Route snapshots, service stubs, and PostgreSQL repository tests       | modify   | Preserve characterization and test changed boundaries              |
| Behavioral deviations | Legacy parser accepted canonical IDs with any prefix                  | modify   | Require `lat` and return sanitized `500` before persistence        |

## Architecture

### Selected approach

Create a vertical Effect slice and delete the replaced Promise implementation:

```text
Fastify and TypeBox
        |
        v
shared ManagedRuntime
        |
        v
LedgerAccountBalanceMonitorService
        |
        v
LedgerAccountBalanceMonitorRepo
        |
        v
existing Drizzle schema and PostgreSQL table
```

The slice lives at `apps/api/src/domains/ledgers/accounts/balance-monitors` and contains:

```text
LedgerAccountBalanceMonitor.ts
LedgerAccountBalanceMonitorErrors.ts
LedgerAccountBalanceMonitorRepo.ts
LedgerAccountBalanceMonitorRoutes.ts
LedgerAccountBalanceMonitorSchema.ts
LedgerAccountBalanceMonitorService.ts
index.ts
```

Tests remain beside the modules they cover. The slice entry point exports the routes, service tag,
public service and schema types, resource errors needed by consumers, and the composed
`balanceMonitorLayer`.

### Domain model

`LedgerAccountBalanceMonitor` retains the current stored fields: Balance Monitor ID, Account ID,
name, optional description, alert threshold, active state, optional metadata, created time, and
updated time.

The model owns these transformations:

- Construct a monitor from a validated request, generated ID, and application time.
- Decode a Drizzle row, including the existing malformed-metadata fallback.
- Produce insert and update rows while preserving `undefined` omission behavior.
- Produce the unchanged HTTP response, including every placeholder field.

The model performs no I/O. It does not introduce a condition or evaluation model because the
resource does not persist or evaluate those concepts today.

### Application service

`LedgerAccountBalanceMonitorService` keeps the five current use-case names. Each method returns an
Effect. The service uses the repository capability, the shared TypeID helper, and Effect's clock.
It does not depend on Account, Ledger, or Transaction services.

The service owns:

- Pagination orchestration for list.
- Balance Monitor ID parsing for get, update, and delete.
- New Balance Monitor ID generation for create.
- Request Account ID parsing inside the Effect flow.
- Application time sampling for create and update.
- Domain construction and conversion of repository absence into not found.

Invalid body Account IDs retain their current sanitized `500` behavior. The migration does not
promote them to transport validation errors.

### Repository

`LedgerAccountBalanceMonitorRepo` is an Effect capability with a live Drizzle implementation. The
live implementation uses the runtime's Effect-enabled database and retains the current operations:

- List all rows by `created DESC`, then apply limit and offset.
- Get one row by Balance Monitor ID.
- Insert one domain row and return it.
- Update by Balance Monitor ID, including the current mutable assignments and application time.
- Delete by Balance Monitor ID and return whether a row existed.

The repository returns absence explicitly for get, update, and delete. The service maps absence to
the resource not-found error. The repository maps row-decoding and database failures to typed
internal errors whose HTTP detail remains `"Internal Server Error"`.

### Runtime and legacy removal

`balanceMonitorLayer` provides the repository Layer to the service Layer. The server runtime merges
this Layer and includes the service in its runtime service union.

The nested Ledger router imports the relocated routes. The legacy repository and service plugins
remove their Balance Monitor constructors, decorators, types, and override options. Once the new
slice is wired and tested, the old Balance Monitor service, repository, entity, route, tests,
fixtures, snapshots, and exports are deleted.

### Conversion ownership

| Conversion or validation                                     | Owner                                          |
| ------------------------------------------------------------ | ---------------------------------------------- |
| HTTP body, query, and Balance Monitor path schema validation | TypeBox route schema                           |
| Balance Monitor path string to `lbm` TypeID                  | application service                            |
| Request Account string to `lat` TypeID                       | domain construction inside the service Effect  |
| New Balance Monitor ID                                       | application service using the shared generator |
| Mutation time                                                | application service using Effect's clock       |
| Request to domain and domain to response                     | domain model                                   |
| Drizzle row to domain and domain to persistence row          | domain model                                   |
| SQL and persistence failure translation                      | repository                                     |
| HTTP problem response and logging                            | existing global error handler                  |

## API design

The prefix remains `/api/ledgers/:ledgerId/accounts/:accountId/balance-monitors`.

| Method   | Suffix               | Permission                              | Success              |
| -------- | -------------------- | --------------------------------------- | -------------------- |
| `GET`    | `/`                  | `ledger:account:balance_monitor:read`   | `200` array          |
| `GET`    | `/:balanceMonitorId` | `ledger:account:balance_monitor:read`   | `200` object         |
| `POST`   | `/`                  | `ledger:account:balance_monitor:write`  | `200` object         |
| `PUT`    | `/:balanceMonitorId` | `ledger:account:balance_monitor:write`  | `200` object         |
| `DELETE` | `/:balanceMonitorId` | `ledger:account:balance_monitor:delete` | `200` empty response |

List keeps numeric `offset = 0` and `limit = 20` without new integer, minimum, or maximum
constraints.

The request stays:

```json
{
	"accountId": "lat_...",
	"description": "Optional description",
	"alertCondition": [{ "field": "balance", "operator": "<", "value": 1000 }],
	"metadata": { "key": "value" }
}
```

The route keeps `accountId` as a TypeBox string. Alert fields remain `balance`, `created`, or
`updated`; operators remain `=`, `<`, `>`, `<=`, `>=`, or `!=`; values remain numbers. The service
continues to ignore the complete condition array.

The response keeps this shape and behavior:

- `id` and `accountId` are TypeID strings.
- `description` and metadata are omitted when absent.
- `alertCondition` is always empty.
- `balances` contains pending, posted, and available entries with zero credits, debits, and amount,
  Currency Code `USD`, and exponent `2`.
- `lockVersion` is always `0`.
- `created` and `updated` are ISO strings.

The route schemas retain their operation-specific `400`, `401`, `403`, `404`, `409`, `429`, `500`,
and `503` responses. The live resource produces not found and internal failures as described above;
shared Fastify mechanisms retain ownership of authentication, permission, validation, pressure,
and unexpected failures.

The resource publishes and consumes no event or webhook contract.

## Data model

The migration leaves `ledger_account_balance_monitors` unchanged:

| Column            | Behavior                                                         |
| ----------------- | ---------------------------------------------------------------- |
| `id`              | Text primary key containing an `lbm` TypeID                      |
| `account_id`      | Required text foreign key to `ledger_accounts.id`                |
| `name`            | Required internal name derived from description                  |
| `description`     | Optional text                                                    |
| `alert_threshold` | Numeric `(20, 4)`, default and current written value `0`         |
| `is_active`       | Integer, default and current written value `1`                   |
| `metadata`        | Optional JSON encoded as text                                    |
| `created`         | PostgreSQL timestamp with time zone, default `now()`             |
| `updated`         | Timestamp with time zone supplied by the application on mutation |

The migration adds no table, column, constraint, index, backfill, or migration file. The existing
Account foreign key remains the only parent constraint. There is no Organization or Ledger column,
condition storage, evaluation state, webhook state, or lock version.

## Verification

Tests follow stub-driven TDD at the narrowest useful layer:

- Domain tests cover current request construction, row conversion, malformed metadata fallback,
  update omission behavior, and placeholder response serialization.
- Service tests use an Effect repository stub to cover delegation, identifier behavior,
  application time, not found, and failure propagation.
- Repository tests use PostgreSQL and the live database test Layer to preserve ordering,
  pagination, CRUD, optional fields, metadata, missing rows, and failure behavior.
- Route tests use a service Layer stub to cover every endpoint's success and delegation, the
  resource-specific not-found behavior, response snapshots, and representative shared permission,
  validation, and error handling without replaying that matrix for every endpoint.
- Runtime composition is verified by TypeScript's Layer requirements, API build and type checks,
  existing server construction, and the absence of legacy plugin references. No dedicated runtime
  harness or infrastructure test is added.

Implementation validation runs focused Balance Monitor tests, using PostgreSQL only for repository
tests, followed by `pnpm run ci`. Existing assertions and snapshots may move or be consolidated,
but observable characterization coverage may not be weakened.

## Trade-offs

### Selected: relocated vertical Effect slice

This approach replaces the full Promise slice with the resource layout used by integrated Effect
resources. It gives the migrated resource one ownership boundary and removes legacy wiring. It
costs more file movement and import changes than an in-place conversion. The human explicitly
approved that structural cost as part of the migration.

### Rejected: in-place Effect conversion

An in-place conversion would keep the current route, service, repository, and entity directories.
It would produce a smaller diff, but the completed resource would remain split across legacy layer
directories and plugin-oriented exports. It does not match the approved migration architecture.

### Deliberate limitations

- The migration keeps weak parent and tenant scoping.
- The migration keeps placeholder Balance Monitor behavior.
- All PostgreSQL failures remain sanitized `500` responses rather than adopting another slice's
  `503` classification.
- The service reuses the existing ID generator rather than adding an injectable ID service.
- The slice reuses existing shared pagination, metadata, and balance TypeBox definitions rather
  than extracting new common infrastructure.

### Approved deviation

Create and update require the body Account ID to use the `lat` TypeID prefix. A syntactically valid
TypeID with another prefix fails before persistence and returns the same sanitized `500` response
as a malformed Account ID. On update, this validation takes precedence over checking whether the
Balance Monitor exists, so a missing monitor with a wrong-prefix body Account ID returns `500`
instead of the legacy `404`.

## Open questions

None.

## Implementation plan draft

### Phase 1: Domain boundary

#### T1: Establish the Balance Monitor schemas, errors, and domain model

**Depends on:** None.

**Inputs:**

- The approved HTTP, domain, identifier, timestamp, metadata, and placeholder-response behavior in
  this design.
- The existing Balance Monitor TypeBox definitions in
  `apps/api/src/routes/ledgers/schema.ts`, Drizzle row types in
  `apps/api/src/repo/schema.ts`, and TypeID aliases and generators in
  `apps/api/src/repo/entities/types.ts`.
- The Organization entity ownership pattern, while retaining the Balance Monitor-specific
  malformed-metadata fallback and update omission behavior.

**Description:**

Create the relocated TypeBox schemas and derive the public request, response, parameter, and query
types from them without changing schema IDs, descriptions, constraints, or response shapes. Create
the resource errors needed to distinguish absence from sanitized internal persistence failures;
database unavailability must remain a sanitized `500`, not adopt another slice's `503` behavior.
Create `LedgerAccountBalanceMonitor` as the pure owner of request construction, row decoding,
create/update row encoding, and response serialization. It must accept service-supplied IDs and
times, ignore alert conditions, preserve malformed metadata as absent, preserve `undefined` on
omitted update fields, and retain every stored and placeholder value described above. Do not add a
condition model, handwritten transport or row mirror, validation already owned by TypeBox or
Drizzle, or any I/O.

**Files:**

- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorSchema.ts`.
- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorErrors.ts`.
- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitor.ts`.
- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitor.test.ts`.

**Validation:**

- Characterization tests prove request construction keeps the supplied `lbm` ID and `lat` Account
  ID, derives the existing default name, forces threshold `0` and active state `true`, ignores alert
  conditions, and uses the supplied application time.
- Row tests prove TypeID, timestamp, threshold, active-state, optional-field, JSON metadata, and
  malformed-metadata conversions match the legacy entity.
- Persistence encoding tests distinguish create from update and prove omitted description and
  metadata remain `undefined` on update so Drizzle preserves those columns.
- Response tests prove ISO timestamps, omitted optional values, the empty alert-condition array,
  three zero-valued USD balances with exponent `2`, and `lockVersion: 0` remain compatible with the
  existing snapshots.
- No database schema, migration, public schema, domain rule, or operational behavior changes.

### Phase 2: Persistence boundary

#### T2: Implement the Effect repository capability and live Drizzle adapter

**Depends on:** T1.

**Inputs:**

- `LedgerAccountBalanceMonitor`, its persistence conversions, and resource errors from T1.
- The legacy SQL behavior in `apps/api/src/repo/LedgerAccountBalanceMonitorRepo.ts`.
- The Effect-enabled Drizzle database exposed by `DatabaseTag`, plus the Organization and Account
  repository Layer and PostgreSQL test patterns.

**Description:**

Define the smallest `LedgerAccountBalanceMonitorRepo` Effect capability required by the five CRUD
use cases and implement its live adapter with the existing Effect-enabled Drizzle database. Keep
list ordering as `created DESC` with no added tie-breaker; keep limit, offset, ID-only predicates,
assignments, and `RETURNING` behavior unchanged. Get, update, and delete return explicit absence for
the service to classify. Create and update decode the returned row through the domain model. Map
all row-decoding, PostgreSQL, and unexpected persistence failures to the resource's sanitized
internal error. Add no Account or Ledger scope, transaction, lock, retry, index, or migration.

**Files:**

- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorRepo.ts`.
- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorRepo.test.ts`.

**Validation:**

- PostgreSQL tests using the existing live database Layer prove list ordering and pagination, get,
  create, update, and delete retain the current SQL behavior.
- Tests cover stored and omitted description and metadata values, application-supplied update time,
  and current update assignments for Account ID, name, threshold, and active state.
- Missing get, update, and delete return explicit absence rather than failing in the repository.
- A failing or undecodable persistence result enters the typed sanitized `500` error channel.
- Each mutation remains one SQL statement and the Drizzle table and migration history are untouched.

### Phase 3: Application boundary

#### T3: Implement the Effect application service

**Depends on:** T1 and T2.

**Inputs:**

- The repository capability and domain construction API from T1-T2.
- Existing TypeID aliases, `newLedgerAccountBalanceMonitorID`, and the shared Effect-based ID parser.
- The installed Effect v4 clock, service, Layer, and typed-error conventions used by integrated
  Ledger slices.

**Description:**

Create `LedgerAccountBalanceMonitorService` with the five existing use-case names and Effect return
types. List forwards pagination. Get, update, and delete parse only the Balance Monitor ID. Create
generates the existing `lbm` TypeID; create and update parse the request Account ID and sample
application time through Effect before domain construction. Convert repository absence to the
resource not-found error and otherwise preserve repository failures. Keep malformed request Account
IDs and canonical non-`lat` Account IDs on the sanitized `500` path before persistence, and do not
consult Account, Ledger, or Transaction services. Add only the service tag and Layer needed by the
managed runtime; do not add an ID service, interface plus implementation pair, retry, or other
orchestration.

**Files:**

- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorService.ts`.
- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorService.test.ts`.

**Validation:**

- Effect repository stubs prove list pagination and all CRUD delegation without duplicating
  repository SQL tests.
- Controlled time tests prove create and update pass application time to the domain model, while
  creation generates an `lbm` ID and all request Account IDs are parsed as `lat` IDs.
- Missing get and delete results become the same public `404` error behavior. Missing updates do so
  when the body Account ID is valid.
- Repository failures propagate unchanged. A malformed or canonical non-`lat` body Account ID
  remains a sanitized internal failure rather than a new `400` and prevents repository delegation.
- For the approved deviation, Account ID validation takes precedence over missing-monitor
  classification during update.
- The service error channels contain only errors the existing global HTTP handler can map.

### Phase 4: HTTP boundary

#### T4: Relocate the five routes and preserve their characterization coverage

**Depends on:** T1 and T3.

**Inputs:**

- The schemas and Effect service tag from T1 and T3.
- The complete route contract and snapshots in
  `apps/api/src/routes/ledgers/LedgerAccountBalanceMonitorRoutes.ts` and its test.
- The explicit Effect route execution and service-Layer stub pattern from Organizations and
  Transactions.

**Description:**

Create the relocated Fastify route plugin with the same five paths, methods, operation IDs, tags,
summaries, request schemas, response schemas, permission checks, and advertised error schemas. Each
explicit handler must run the service Effect through `rq.server.runtime`, translate the Effect
result through the existing global error handler, and serialize the domain response. Continue to
ignore Ledger and Account path parameters. Preserve `200` for create and delete and the existing
observable characterization coverage. Consolidate duplicate tests of shared Fastify behavior and
replace Promise mocks with one complete service Layer stub; add no route executor, reusable
harness, or new plugin override hook.

**Files:**

- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorRoutes.ts`.
- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorRoutes.test.ts`.
- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/__snapshots__/LedgerAccountBalanceMonitorRoutes.test.ts.snap`.

**Validation:**

- Route tests cover every endpoint's success response, runtime delegation, matching service inputs,
  list defaults and explicit pagination, existing snapshots, and exact create/delete `200`
  behavior.
- Focused tests cover missing get and delete as `404`, plus missing update with a valid body Account
  ID as `404`. Representative tests retain shared `401`, `403`, `400`, and sanitized `500` behavior
  without repeating those cases for every route.
- Route schemas retain every advertised error response, including `409`, `429`, and `503`, without
  manufacturing live Balance Monitor failures solely to exercise the global error handler.
- Paths, parent-parameter behavior, headers, operation IDs, tags, schemas, and deterministic JSON
  fields remain unchanged.

### Phase 5: Runtime composition

#### T5: Export and wire the composed Balance Monitor Layer

**Depends on:** T2, T3, and T4.

**Inputs:**

- The repository and service Layers and relocated routes.
- The integrated slice entry-point pattern and the shared server runtime composition in
  `apps/api/src/runtime.ts`.
- The nested Ledger router registration in `apps/api/src/routes/ledgers/index.ts`.

**Description:**

Create the slice entry point with the approved public exports and one `balanceMonitorLayer` that
provides the repository Layer to the service Layer. Merge that composed Layer into the existing
server runtime and include the service capability in `ServerRuntimeServices`. Switch only the
nested Balance Monitor route import to the relocated plugin, preserving its current prefix and
registration order. Rely on the Layer type, API build and type checks, existing server construction,
and legacy-reference search to verify composition; do not add a dedicated runtime test, runtime
harness, or second runtime.

**Files:**

- Create `apps/api/src/domains/ledgers/accounts/balance-monitors/index.ts`.
- Modify `apps/api/src/runtime.ts`.
- Modify `apps/api/src/routes/ledgers/index.ts`.

**Validation:**

- API build and type checks prove the composed Layer satisfies
  `LedgerAccountBalanceMonitorService` with the live repository and existing database dependency.
- `makeServerRuntimeLayer` exposes the service capability without changing any existing override,
  Valkey, database, disposal, or adjacent resource behavior.
- The nested router still registers
  `/api/ledgers/:ledgerId/accounts/:accountId/balance-monitors` exactly once.
- Existing server construction passes without the legacy repository or service decorators.

### Phase 6: Legacy removal

#### T6: Remove the superseded Promise slice and plugin wiring

**Depends on:** T4 and T5.

**Inputs:**

- The fully wired vertical Effect slice from T1-T5.
- All current Balance Monitor references in the shared legacy repository, service, schema, fixture,
  and export modules.

**Description:**

Delete the old Promise entity, repository, service, route, tests, and snapshot. Remove only Balance
Monitor constructors, decorators, option types, fixture helpers, schema definitions, and exports
from the shared legacy modules; the repository and service plugins remain for Categories,
Settlements, and Statements. Remove no shared TypeID alias, ID generator, Drizzle table, relation,
pagination schema, balance schema, metadata schema, or adjacent fixture still used by the new slice
or another resource. Use compiler and repository-wide searches to prove there is no live legacy
Balance Monitor operation or stale import.

**Files:**

- Delete `apps/api/src/repo/entities/LedgerAccountBalanceMonitorEntity.ts`.
- Delete `apps/api/src/repo/LedgerAccountBalanceMonitorRepo.ts`.
- Delete `apps/api/src/repo/LedgerAccountBalanceMonitorRepo.test.ts`.
- Delete `apps/api/src/services/LedgerAccountBalanceMonitorService.ts`.
- Delete `apps/api/src/services/LedgerAccountBalanceMonitorService.test.ts`.
- Delete `apps/api/src/routes/ledgers/LedgerAccountBalanceMonitorRoutes.ts`.
- Delete `apps/api/src/routes/ledgers/LedgerAccountBalanceMonitorRoutes.test.ts`.
- Delete `apps/api/src/routes/ledgers/__snapshots__/LedgerAccountBalanceMonitorRoutes.test.ts.snap`.
- Modify `apps/api/src/repo/entities/index.ts`.
- Modify `apps/api/src/repo/index.ts`.
- Modify `apps/api/src/repo/types.ts`.
- Modify `apps/api/src/repo/fixtures.ts`.
- Modify `apps/api/src/services/index.ts`.
- Modify `apps/api/src/routes/ledgers/schema.ts`.
- Modify `apps/api/src/routes/ledgers/fixtures.ts`.

**Validation:**

- Repository-wide searches find no imports of the deleted Promise entity, repository, service, or
  route and no Balance Monitor member on the legacy `Repos`, `Services`, or plugin option types.
- The legacy plugins still construct and expose every remaining resource and their existing tests
  continue to compile.
- The new slice derives transport and row types from TypeBox and Drizzle and reuses the shared
  TypeID alias and generator; no duplicate mirror type or fixture remains.
- No unrelated cleanup, shared runtime refactor, database migration, or adjacent behavior change is
  included.

### Phase 7: Migration verification

#### T7: Run targeted and full migration validation

**Depends on:** T1-T6.

**Inputs:**

- The completed Effect slice and removed legacy wiring.
- The repository's pnpm, Vitest, PostgreSQL, Oxc, TypeScript, and Turborepo commands.
- The migration contract and definition of done in `EFFECT_MIGRATION.md`.

**Description:**

Run the focused Balance Monitor domain, service, repository, and route tests first, starting
PostgreSQL only for the repository tests. Then run the full CI pipeline once. Review the final diff
and generated OpenAPI behavior for migration-only scope. Stop and return to design or planning if
any fix would change an approved public, domain, persistence, transaction, concurrency, identifier,
timestamp, or operational behavior.

**Files:**

- Create none.
- Modify none unless validation exposes an implementation defect within the approved tasks; apply
  that correction in the owning task and rerun its validation.

**Validation:**

- Focused Balance Monitor tests pass, with PostgreSQL used only by repository tests.
- `pnpm run ci` passes after the focused suite.
- Existing observable characterization coverage and snapshots are present and not weakened;
  duplicate assertions of shared framework behavior may be consolidated.
- The final diff contains no database schema or migration changes, product completion, parent
  scoping, new retry/locking/transaction/idempotency behavior, duplicated validation, handwritten
  mirror types, speculative abstractions, or unrelated cleanup.
- Every behavior-preservation item in US-1 through US-4 is satisfied apart from the approved strict
  request Account ID prefix validation.
