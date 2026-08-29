# Ledger Account Categories Effect migration

## Problem

The Ledger Account Category slice still runs through Promise-based routes, service wiring, and a
Node Drizzle repository. Organizations, Ledgers, Accounts, and Transactions use the server's
managed Effect runtime. Categories need the same execution model without changing their API,
domain, persistence, concurrency, or operational behavior.

API callers continue to use the existing nine Category operations. The migration is successful
when those operations run through Effect and produce the same observable results from the same
requests and database state.

## Scope

### In scope

- Migrate all nine Ledger Account Category operations to the managed Effect runtime.
- Convert the Category service and repository contracts to return Effects.
- Use `drizzle-orm/effect-postgres` through `DatabaseTag.effectDb`.
- Add Category service and repository tags and Layers for their real dependencies.
- Remove Category construction from the legacy service and repository plugins.
- Adapt focused route, service, and PostgreSQL repository tests without weakening assertions.

### Out of scope

- Organization-scoped Category queries.
- Optimistic concurrency control or a Category `lock_version`.
- Real Category balance aggregation or changes to the placeholder balance response.
- Full cycle detection or stricter Account and Category relationship validation.
- HTTP status, header, schema, permission, pagination, or error-policy changes.
- Database schema changes, migrations, retries, transactions, clocks, ID services, or new runtime
  infrastructure.
- Moving or renaming the existing Category files.

Organization-scoped queries are a requested behavior change. Before this migration starts,
`docs/specs/2026-08-29-categories-organization-scoping/design.md` and its `plan.json` must exist and
be approved. This migration then lands first against the recorded Ledger-only baseline. The
Organization-scoping implementation follows in a separate change set. If that ordering changes,
this migration must be rebaselined and replanned before implementation.

## User stories

All stories are must-have.

### US-1: Preserve Category CRUD

As an authenticated Ledger API caller, I want Category list, get, create, replace, and delete
operations to behave as they did before the migration.

- Given the same valid request and database state, each route returns the same status, headers, and
  JSON body.
- Permissions, TypeBox validation, pagination, `created DESC` ordering, Ledger scoping, identifiers,
  timestamps, metadata handling, placeholder balances, and public errors remain unchanged.
- PUT remains last-writer-wins and keeps the existing nontransactional read-then-upsert behavior.

### US-2: Preserve Category relationships

As an authenticated Ledger API caller, I want Account membership and parent Category links to keep
their current behavior.

- Duplicate links remain successful and idempotent.
- Missing links on unlink return the existing `404` details.
- Multiple parents and direct self-link rejection remain unchanged.
- Existing query order, absence of transactions, and cross-Ledger Account-link behavior remain
  unchanged.

### US-3: Run the Category slice through Effect

As an API maintainer, I want Category routes, service orchestration, and PostgreSQL operations to
use the server's managed Effect runtime.

- Routes execute Category Effects through `server.runtime`.
- The Category service Layer depends on the Category repository Layer.
- The live repository uses `DatabaseTag.effectDb`.
- The migration adds no runtime, resource lifetime, transaction, retry, clock, ID-generator, or
  generic executor abstraction.
- Unrelated legacy slices keep their existing wiring.

### US-4: Isolate behavior changes

As an API maintainer, I want the migration diff to contain no product, tenancy, schema,
concurrency, or operational-policy changes.

- Organization scoping receives the named prerequisite spec, plan, and subsequent change set.
- OCC, real balances, cycle detection, stricter relationship validation, status-code modernization,
  and availability remapping do not enter this migration.
- Any newly discovered deviation stops implementation until it is split out.

## Constraints

- `CONTEXT.md` defines Ledger Account Category terminology and invariants.
- The existing HTTP contract, source, tests, and PostgreSQL schema define current behavior.
- `EFFECT_MIGRATION.md` defines the migration sequence and requires zero behavior deviations.
- Organizations provides the basic Effect ownership pattern. Transactions is the nearest integrated
  slice and provides the current Effect Drizzle pattern.
- Fastify and TypeBox remain the HTTP and OpenAPI boundary. Drizzle remains the PostgreSQL adapter.
- The repository owns SQL and database error translation. The service owns orchestration. The entity
  owns synchronous representation conversion and performs no I/O.
- The target package uses Effect `4.0.0-rc.112`.
- The work uses branch `feat/categories-effect` and worktree
  `/Users/martinrichards/code/exchequerio/.worktrees/categories-effect`.
- The recorded baseline commit is `47779c46418da3558f8f20f61e1edee20de6b72a`.
- Implementation is blocked until the Organization-scoping design and plan named above are
  approved.

## Context

### HTTP baseline

All routes use the prefix `/api/ledgers/:ledgerId/accounts/categories`.

| Operation      | Route suffix                                       | Success | Permission                       |
| -------------- | -------------------------------------------------- | ------: | -------------------------------- |
| List           | `GET /`                                            |   `200` | `ledger:account:category:read`   |
| Get            | `GET /:categoryId`                                 |   `200` | `ledger:account:category:read`   |
| Create         | `POST /`                                           |   `200` | `ledger:account:category:write`  |
| Replace        | `PUT /:categoryId`                                 |   `200` | `ledger:account:category:write`  |
| Delete         | `DELETE /:categoryId`                              |   `200` | `ledger:account:category:delete` |
| Link Account   | `PATCH /:categoryId/accounts/:accountId`           |   `200` | `ledger:account:category:write`  |
| Unlink Account | `DELETE /:categoryId/accounts/:accountId`          |   `200` | `ledger:account:category:write`  |
| Link parent    | `PATCH /:categoryId/categories/:parentCategoryId`  |   `200` | `ledger:account:category:write`  |
| Unlink parent  | `DELETE /:categoryId/categories/:parentCategoryId` |   `200` | `ledger:account:category:write`  |

Create sets no `Location` header. The request and response schemas remain in the existing TypeBox
module. Responses retain three zero-valued USD balance entries and ISO timestamps.

### Domain and persistence baseline

- Queries scope Categories by Ledger ID only. Routes do not pass the authenticated Organization ID
  into the Category slice.
- Lists order by `created DESC` and use the existing offset and limit values without additional
  bounds.
- Create generates a `lac` TypeID in `LedgerAccountCategoryEntity`. PostgreSQL supplies `created`,
  and application time supplies `updated`.
- Update reads the Category for existence, builds replacement state, then performs an ID-based
  upsert. The read and upsert do not share a transaction.
- The upsert updates name, description, Normal Balance, metadata, and updated time. It rejects a
  Ledger ID mismatch.
- Categories have no `lock_version`. Concurrent PUTs are last-writer-wins, and a delete between the
  existence read and upsert can recreate the Category.
- Category deletion relies on database cascades to remove junction rows.
- Account and parent links use separate existence checks and writes. Duplicate links use
  `ON CONFLICT DO NOTHING`.
- Parent links allow multiple parents and reject only direct self-links. Longer cycles remain
  possible.
- Account links verify that the Account exists but do not verify that it belongs to the Category's
  Ledger.
- Malformed stored metadata is silently treated as absent.

### Error and operational baseline

- Fastify validation returns `400`.
- Authentication and permission failures return `401` and `403`.
- Missing or cross-Ledger Categories, missing Account foreign keys, and absent relationships return
  the existing `404` details.
- Direct self-links and upsert Ledger mismatches return the existing `409` details.
- Unexpected row decoding, database, and availability failures return a generic `500`.
- Existing OpenAPI `429` and `503` schemas remain, but the migration adds no producer for them.
- Category operations have no retry, idempotency-key, transaction, lock, or Category-specific
  resource lifetime.

The baseline API suite passes 32 test files and 490 tests.

## Research decisions

| Concern                                         | Existing solution                                           | Decision | Current requirement                                         |
| ----------------------------------------------- | ----------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| Runtime                                         | One server-owned managed Effect runtime                     | reuse    | Run Category effects at the route boundary                  |
| HTTP contract                                   | Existing Fastify routes and TypeBox schemas                 | reuse    | Preserve paths, permissions, schemas, statuses, and headers |
| Route execution                                 | Promise service through `server.services`                   | modify   | Run one Effect through `server.runtime`                     |
| Category model                                  | Entity owns request, row, and response conversion           | reuse    | Preserve IDs, timestamps, metadata tolerance, and balances  |
| Service                                         | Constructor-injected Promise class                          | modify   | Return Effects and expose the repository dependency         |
| Repository                                      | Node Drizzle Promise adapter                                | modify   | Express the same SQL through Effect Drizzle                 |
| Tags and Layers                                 | None for Categories                                         | new      | Compose real service and database dependencies              |
| Errors                                          | Shared HTTP errors and generic unexpected `500`             | reuse    | Preserve current status and detail behavior                 |
| Legacy plugin entries                           | Category constructors and decorations                       | delete   | Remove the obsolete Category bridge                         |
| Tests                                           | Route stubs, service stubs, and PostgreSQL repository tests | modify   | Exercise Effect wiring without weakening contracts          |
| Schema and migrations                           | Existing Category and junction tables                       | reuse    | Preserve persistence behavior                               |
| Transactions, locks, retries, clock, ID service | None                                                        | reuse    | Preserve their absence                                      |

## Architecture

The migration converts the existing files in place:

```text
Fastify and TypeBox Category routes
  -> existing managed ServerRuntime
     -> LedgerAccountCategoryServiceTag
        -> LedgerAccountCategoryRepoTag
           -> DatabaseTag.effectDb
              -> existing PostgreSQL tables
```

### Entity and conversion ownership

`LedgerAccountCategoryEntity` remains the pure Category model:

- `fromRequest` owns Category ID generation and request conversion.
- `fromRecord` owns TypeID, nullable-field, timestamp, and metadata decoding, including tolerant
  handling of malformed metadata.
- `toRecord` owns Drizzle row encoding and application-generated update time.
- `toResponse` owns the unchanged HTTP representation and placeholder balances.

The service uses the TypeBox-derived request type instead of a handwritten mirror. The migration
adds no domain validation, decoder abstraction, clock, ID generator, or error class.

### Repository boundary

`LedgerAccountCategoryRepo.ts` keeps the existing operation names and contains:

- An Effect-returning `LedgerAccountCategoryRepo` contract.
- `LedgerAccountCategoryRepoTag` for runtime lookup.
- `LedgerAccountCategoryRepoLive` backed by `DatabaseTag.effectDb`.
- `ledgerAccountCategoryRepoLayer` for live construction.

Every operation keeps its tables, predicates, ordering, limits, offsets, conflict clauses,
returning clauses, and sequential call order. The relationship sequences are exact:

- Link Account reads the Category, then inserts the junction row; it does not pre-read the Account.
- Unlink Account reads the Category, then deletes the junction row.
- Link parent reads the child, reads the parent, checks direct equality, then inserts the junction
  row.
- Unlink parent reads only the child, then deletes the junction row.

Multi-step update and relationship operations remain separate sequential Effects rather than
concurrent programs or database transactions.

The repository continues to create the existing shared `NotFoundError` and `ConflictError` values.
It inspects Effect-wrapped PostgreSQL causes for the existing foreign-key and self-reference cases.
All other SQL and row-decoding failures retain the generic public `500` response. Database
unavailability does not become `503`.

Repository and service capabilities use `unknown` as the Effect failure type because preserving the
existing raw failure objects is part of the migration. Expected `NotFoundError` and `ConflictError`
values enter the failure channel unchanged. Native adapter failures and synchronous TypeID, request,
row, and response conversion throws also enter the failure channel unchanged rather than becoming
defects. Routes rethrow those failures to the existing global handler. No failure is remapped to a
new Category error or `ServiceUnavailableError`.

### Service boundary

`LedgerAccountCategoryService` keeps its nine method names and argument conventions. Each method
returns an Effect and performs the same orchestration:

- List, get, delete, link, and unlink delegate to the repository.
- Create builds a new entity and upserts it.
- Update parses IDs, reads for existence, builds replacement state, then upserts it.

`LedgerAccountCategoryServiceTag` exposes the service. Its Layer depends only on the repository
tag. The service gains no Organization, Ledger, Account, clock, retry, transaction, or idempotency
dependency.

### HTTP and runtime boundary

The existing route module keeps its schemas, paths, permissions, operation IDs, statuses, headers,
and response conversion. Each handler obtains the service through its tag, runs one program through
`server.runtime`, and rethrows failures to the existing global error handler.

The runtime composes the Category repository and service Layers into the server Layer. The legacy
repository and service plugins remove only their Category types, constructors, decorations, and
test injection path. Settlement, Statement, and Balance Monitor wiring remains unchanged.

## API design

There are no public API changes. Request fields, optional-field behavior, response fields, TypeID
patterns, pagination defaults, OpenAPI operation IDs, advertised error schemas, and empty mutation
bodies remain unchanged. The migration adds no `Location`, ETag, version, or retry header and
publishes no events.

The internal service and repository contracts change from Promise-returning classes to
Effect-returning capabilities with `Context.Service` tags and Layers.

## Data model

There are no schema or migration changes.

- `ledger_account_categories` keeps its columns, Ledger foreign key, timestamp defaults, and absence
  of Organization ID and lock version.
- `ledger_account_category_accounts` keeps its composite key, independent Category and Account
  foreign keys, Account index, and cascade deletes.
- `ledger_account_category_parents` keeps its composite key, direct self-reference check, parent
  index, and cascade deletes.
- Existing Drizzle row types remain canonical. The migration adds no mirror persistence model.

## Test design

- Before production changes, test-only characterization locks the uncovered adapter, timestamp,
  sequencing, and concurrency behavior against the legacy implementation.
- Route success and service-failure tests use an isolated Fastify server with a complete Effect
  service provided through `Layer.succeed`.
- Existing invalid-JWT `401` and readonly-token `403` cases continue to use `buildServer` with its
  real authentication and permission hooks. They use the default runtime because their prehandlers
  reject the request before Category persistence runs.
- The route suite retains its current 39 cases or an equivalent named assertion matrix. The
  repository suite retains 38 cases and the service suite retains 13 cases, plus the new baseline
  characterizations. Harness rewrites may consolidate setup but must not remove behavior assertions.
- Service tests provide an Effect repository stub and verify delegation, creation, and
  read-before-upsert sequencing.
- Repository tests use the existing PostgreSQL Layer and preserve assertions for ordering,
  pagination, Ledger isolation, foreign-key errors, immutable Ledger ownership, cascades,
  idempotent links, multiple parents, direct self-link rejection, and missing unlinks.
- Baseline characterizations cover malformed stored metadata, PostgreSQL-owned creation time,
  application-owned update time, created-time preservation on upsert, read-before-upsert order,
  last-writer-wins replacement, the delete-between-read-and-upsert recreation window, relationship
  failure precedence, row-decoding failure, and database unavailability remaining a generic `500`.
- Narrow tests prove that handlers use the runtime and that the Category Layers compose. The
  migration adds no reusable or duplicate end-to-end harness.

Validation runs from the repository root:

```bash
pnpm run ci
```

Before integration, compare the final diff against the recorded baseline and reject any HTTP,
domain, error, SQL, transaction, concurrency, identifier, timestamp, or operational deviation.

## Trade-offs

The native Effect Drizzle adapter matches the nearest integrated slices and removes a transitional
Promise boundary. A Promise-backed Effect repository would preserve the old adapter but add wrapper
code and keep Categories on a different path from Accounts and Transactions.

Converting in place avoids an unrelated relocation. The older file layout remains until a current
requirement justifies changing it.

The production conversion is one atomic, compile-green cutover. Splitting repository, legacy
plugin, service, runtime, and route removal into separately completed tasks would leave known broken
intermediate states. Test-only characterization remains a separate earlier task because it leaves
production unchanged.

Shared errors already express every caller-visible distinction. Category-specific errors would add
types without changing handling.

Exact sequencing preserves the current concurrency contract. Transactions, split create and update
operations, or OCC would change persistence behavior.

The existing entity conversions preserve tolerant metadata decoding and placeholder balances.
Stricter decoding and real balances require separate product changes.

## Known limitations

The migration retains generic database `500` responses, last-writer-wins PUTs, the delete/recreate
race, longer Category cycles, cross-Ledger Account links, Ledger-only Category scoping,
unconstrained pagination values, and placeholder balances.

## Execution prerequisite

The migration is blocked until the named Organization-scoping design and plan are approved. No
other design question remains within the behavior-preserving Effect migration.
