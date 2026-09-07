# Balance Monitors Effect migration

## Problem

The Ledger Account Balance Monitor resource still uses the API's legacy Promise service,
repository plugin, route handler, and entity wiring. Organizations, Ledgers, Accounts, and
Transactions already run through the server's managed Effect runtime. Balance Monitors must join
that runtime without changing their observable behavior except for the approved request Account ID
prefix validation and the separate metadata correction described below.

API clients currently use five CRUD endpoints. API maintainers support the resource through a
service that delegates to a Drizzle repository. The current implementation is incomplete as a
Balance Monitor product, but this migration does not complete it. It changes the execution model
and code ownership only.

Success means the complete Balance Monitor CRUD slice runs through Effect, follows the integrated
resource structure, removes its legacy Promise wiring, and passes characterization tests with the
approved Account ID prefix validation and metadata corrections.

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
  timestamp, and operational behavior except for strict request Account ID prefix validation and the separately approved metadata correction.

### Out of scope

- Scoping a Balance Monitor to the Organization, Ledger, or Account path.
- Checking that a path Account exists or matches the request body Account.
- Persisting or evaluating alert conditions.
- Detecting condition crossings, rearming a monitor, or emitting webhooks.
- Returning live balances or changing the placeholder response.
- Adding active-state operations, optimistic locking, retries, idempotency, or explicit
  transactions.
- Changing pagination constraints, success status codes, database schemas, indexes, migration
  history, or contracts beyond the approved Account ID validation and metadata corrections.
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
  body Account ID has a canonical non-`lat` prefix or metadata violates the corrected string-map schema.
- Paths, methods, pagination defaults, status codes, headers, operation IDs, tags, and advertised
  error schemas remain unchanged. Request and response metadata use the corrected string-map schema.
- Create and delete continue to return `200`.
- Deterministic response fields remain byte-for-byte compatible except that metadata retains its keys.

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
the service ignores the array. The legacy metadata schema is an empty mapped object: response serialization drops its keys.
The separate correction below gives metadata its intended string-map contract.

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
public service and schema types, and the composed
`balanceMonitorLayer`.

### Domain model

`LedgerAccountBalanceMonitor` retains the current stored fields: Balance Monitor ID, Account ID,
name, optional description, alert threshold, active state, optional metadata, created time, and
updated time.

The model owns these transformations:

- Construct a monitor from a validated request, generated ID, and application time.
- Decode a Drizzle row using the shared metadata parser, treating absent or invalid string-map
  metadata as absent.
- Produce insert and update rows while preserving `undefined` omission behavior.
- Produce the HTTP response, retaining metadata keys and every existing placeholder field.

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
- `description` and metadata are omitted when absent. Valid metadata keys and string values survive
  response serialization.
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

- Service tests use an Effect repository stub to cover request defaults, ignored alert conditions,
  delegation, identifier behavior, application time, not found, and failure propagation.
- Repository tests use PostgreSQL and the live database test Layer to preserve ordering,
  pagination, CRUD, persisted values, optional-field omission, metadata fallback, timestamp ownership,
  missing rows, and failure behavior.
- Route tests use a complete typed service double and Layer to cover endpoint success and delegation,
  not-found behavior, response snapshots, metadata key preservation, and validation/error handling.
  One full generated-operation snapshot locks OpenAPI; two production-server checks cover authentication
  and write permission. No standalone entity suite repeats these contracts.
- Runtime composition is verified by TypeScript's Layer requirements, API build and type checks,
  existing server construction, and the absence of legacy plugin references. No dedicated runtime
  harness or infrastructure test is added.

Implementation validation runs focused Balance Monitor service, repository, and route tests, followed
by `pnpm run check` and `pnpm run ci`. The existing Vitest setup runs database migrations for every
suite; repository tests and production-server smoke checks use the existing local infrastructure. Existing assertions and snapshots may move or be consolidated,
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
- The slice reuses existing pagination and balance schemas, the shared `Metadata` type and
  encoder/parser, and the shared metadata record schema established by Statements.

### Approved Account ID deviation

Create and update require the body Account ID to use the `lat` TypeID prefix. A syntactically valid
TypeID with another prefix fails before persistence and returns the same sanitized `500` response
as a malformed Account ID. On update, this validation takes precedence over checking whether the
Balance Monitor exists, so a missing monitor with a wrong-prefix body Account ID returns `500`
instead of the legacy `404`.

### Separately approved metadata correction

Following Statements commit `54e34b0`, use `MetadataSchema = Type.Record(Type.String(), Type.String())`
for Monitor request and response metadata. Keep the existing shared
`Metadata` string-map type available from `@/lib/utils`; derive its definition from
`MetadataSchema` in `@/lib/schema` and retain the utility re-export for existing callers. Add no
resource-specific metadata alias. Reuse `encodeMetadata` and `parseMetadata`. The Monitor model recovers parser failures to
absent metadata, covering malformed JSON, arrays, scalars, and objects with non-string values.

This corrects inherited key loss on the wire. The schema now describes and validates string-map
metadata with the existing Fastify coercion rules. It does not change stored data or adjacent
resources. `plan.json` tracks this correction separately as T8 before final validation.

## Completion review: corrective history

- Organizations (`de15f0d`, `0af9224`, `aa3f3dc`): retain explicit Effect handlers and the existing
  runtime/database lifecycle; add no executor or test framework.
- Ledgers and Accounts (`99cb535`, `15b6e07`): keep codecs on the entity and return only presence
  from delete, avoiding decoding after a committed deletion. Preserve this resource's existing
  update assignments, including `id`; the different write contract in `4cbb547` is not copied.
- Organizations, Ledgers, Accounts, and Settlements (`1b0c168`, `5f5a66b`): move unique construction,
  persistence, and response assertions into service, repository, and route tests and remove the
  redundant entity suite.
- Transactions and Categories (`bb628b4`, `a42ef9b`, `90e1af0`): preserve typed failure channels,
  redacted internal causes, and type-check complete test doubles. Do not copy unrelated lifecycle,
  ownership, concurrency, or idempotency changes.
- Statements (`5e71cdb`, `3d7304d`, `54e34b0`): keep the slice entry point narrow, snapshot complete
  OpenAPI operations, and prove metadata serialization plus production-route authorization.

The completion ends at a validated branch. Commits, pushes, PR creation, and merging remain outside
this request.

## Implementation

[plan.json](./plan.json) owns the task descriptions, dependencies, and validation. The completion
corrections above amend the original migration plan.

## Validation record — 2026-09-07

- The metadata regression test first reproduced `{ metadata: { team: "treasury" } }` becoming
  `{ metadata: {} }`; invalid stored string maps also failed before the correction.
- All 50 focused service, repository, and route tests pass. The generated OpenAPI comparison changes
  only the six request/response metadata schemas; existing response snapshots are unchanged.
- `pnpm run check` passes. Full CI against an isolated database passes all 14 tasks and all 485 API
  tests across 33 files.
- The `pnpm run ci` container-startup wrapper encountered an occupied local PostgreSQL port. The
  shared test database also contained a newer Categories migration, so validation used a fresh
  database with this branch's migrations and `pnpm run ci:gh --env-mode=loose` with `DATABASE_URL`
  supplied by the environment. No infrastructure configuration or adjacent resource was changed.

## Open questions

None.
