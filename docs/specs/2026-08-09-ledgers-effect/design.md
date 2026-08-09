# Ledgers Effect Migration

## Problem

The five Ledger endpoints use the original Promise-based route, service, entity, and repository
stack. Create and update share an upsert, so updating a missing Ledger can insert it. List
pagination is unbounded and only partly deterministic. Persistence failures use thrown errors, and
the existing Ledger entity mixes transport, database, and domain concerns.

The public request still accepts `currency` and `currencyExponent`, although `CONTEXT.md` defines a
Ledger as a boundary that may contain many Assets. Currency belongs to Ledger Accounts during the
next migration step, not to the Ledger. Existing Account, Transaction, and Settlement code still
reads the legacy Ledger Currency columns, so removing the public fields and dropping the columns at
the same time would break the intermediate release.

Organization users need the same five Ledger operations with correct tenant isolation and failure
semantics. API maintainers need this resource migrated to the existing Effect runtime without
repeating the infrastructure and abstraction work removed after the Organization migration.

Success means all five public Ledger endpoints use the Effect slice, expose no Currency fields,
distinguish create from update, and preserve legacy Currency reads until step 03.

## Scope

### In scope

- Migrate list, get, create, update, and delete Ledger endpoints to Effect.
- Place the migrated slice under `apps/api/src/ledgers/`.
- Enforce Organization tenancy on every repository operation.
- Add stable, bounded offset pagination.
- Remove Currency and Minor Unit Exponent from public Ledger requests, responses, and domain types.
- Keep the existing Ledger Currency columns and values as temporary compatibility storage.
- Retain the existing tenant-scoped legacy Ledger read path for unfinished child resources.
- Update OpenAPI schemas, architecture boundaries, and the physical ERD description.
- Test routes with a mocked Effect service, services with a mocked repository, and repositories
  with PostgreSQL.

### Out of scope

- Migrating Accounts, Transactions, Settlements, or any other child-resource endpoint.
- Adding Account Currency fields, running a Currency backfill, or dropping Ledger Currency columns.
- Adding cursor pagination, optimistic locking, rate limiting, retries, events, Ledger idempotency
  keys, or persistent request deduplication.
- Adding a generic Effect HTTP executor, reusable test harness, or HTTP-to-PostgreSQL test suite.
- Changing authentication, permissions, shared error handling, or the managed runtime lifecycle.
- Changing `CONTEXT.md`; its Ledger definition already matches this design.

## User Stories

All stories are must-have.

### US-1: List Ledgers

As an Organization user with `ledger:read`, I want to list my Organization's Ledgers.

- `GET /api/ledgers` returns only Ledgers owned by the JWT Organization.
- Results are ordered by Ledger ID ascending.
- `offset` defaults to `0` and must be a non-negative integer.
- `limit` defaults to `20` and must be an integer from `1` through `100`.
- An Organization with no Ledgers receives an empty array.
- Invalid pagination returns `400`; authentication and permission failures return `401` and `403`.

### US-2: Get a Ledger

As an Organization user with `ledger:read`, I want to retrieve one Ledger without crossing tenant
boundaries.

- `GET /api/ledgers/:ledgerId` returns the Ledger when it belongs to the JWT Organization.
- A malformed or noncanonical Ledger ID returns `400`.
- A missing Ledger and a Ledger owned by another Organization return the same `404` response.
- The representation contains `id`, `name`, optional `description`, optional string-valued
  `metadata`, `created`, and `updated`.
- The representation contains no Currency or Minor Unit Exponent.

### US-3: Create a Ledger

As an Organization user with `ledger:write`, I want to create a Ledger.

- `POST /api/ledgers` accepts `name`, optional `description`, and optional string-valued `metadata`.
- Fastify removes Currency fields and other unknown fields before the handler runs.
- The service generates a canonical Ledger TypeID.
- PostgreSQL supplies timestamps and the temporary legacy Currency defaults.
- Duplicate Ledger names are valid.
- Success returns `201 Created`, the Ledger representation, and a `Location` header.
- A generated-ID collision or unexpected persistence failure returns a sanitized `500`, not a
  synthetic `409`.
- Database unavailability returns `503` with `retryable: false` because the create outcome may be
  ambiguous.

### US-4: Replace a Ledger

As an Organization user with `ledger:write`, I want to replace a Ledger's mutable fields.

- `PUT /api/ledgers/:ledgerId` accepts the same public fields as create.
- The operation updates only a Ledger owned by the JWT Organization.
- A missing or cross-Organization Ledger returns `404` and is never inserted.
- `name` is replaced; omitting `description` or `metadata` clears that field.
- Fastify removes Currency fields and other unknown fields before the handler runs.
- Success returns `200` with the updated Ledger.
- The endpoint does not advertise `409` because no current update conflict exists.

### US-5: Delete a Ledger

As an Organization administrator with `ledger:delete`, I want to delete an unused Ledger.

- `DELETE /api/ledgers/:ledgerId` deletes only a Ledger owned by the JWT Organization.
- A missing or cross-Organization Ledger returns the same `404`.
- A real PostgreSQL foreign-key dependency returns `409`.
- Success returns `204 No Content`.

### US-6: Preserve legacy Currency consumers

As an API maintainer, I want unfinished child-resource endpoints to keep working until Account
Currency is migrated.

- Existing Ledger Currency and exponent values remain unchanged in PostgreSQL.
- New Ledgers receive the existing database defaults, `USD` and `2`.
- Account, Transaction, and Settlement code may continue to use the retained internal legacy read.
- The compatibility model is not exported from `apps/api/src/ledgers/index.ts` and never appears in
  Ledger requests or responses.
- Step 03 owns the backfill, consumer migration, compatibility removal, and schema contraction.
- Step 02 creates no database migration.

### US-7: Complete the Effect migration without new infrastructure

As an API maintainer, I want the Ledger endpoints to use the existing Effect runtime and database
Layer.

- Public handlers invoke the Effect Ledger service through the server runtime.
- Repository failures stay in the typed Effect error channel.
- The implementation reuses shared IDs, error classes, database classifiers, and direct handlers.
- Tests cover router to mocked service, service to mocked repository, and repository to PostgreSQL.
- The change adds no generic executor, test harness, HTTP-to-PostgreSQL suite, or speculative shared
  abstraction.

## Constraints

- `CONTEXT.md` is authoritative for domain language and invariants.
- Fastify and TypeBox remain the HTTP and OpenAPI boundary.
- Drizzle remains the PostgreSQL adapter.
- The API uses Effect `4.0.0-beta.105`, as resolved in the lockfile.
- One managed Effect runtime exists per Fastify server.
- Authentication remains an HTTP concern. Each application operation receives the authenticated
  Organization ID explicitly.
- The branch is `feat/ledgers-effect`, and the worktree is `.worktrees/ledgers-effect`.
- Step 03 must integrate before the compatibility path or legacy columns can be removed.
- The implementation must preserve unrelated work and follow stub-driven TDD.

## Context

### Current behavior

The current routes expose:

- `GET /api/ledgers`
- `GET /api/ledgers/:ledgerId`
- `POST /api/ledgers`
- `PUT /api/ledgers/:ledgerId`
- `DELETE /api/ledgers/:ledgerId`

The routes obtain a Promise-based `LedgerService` from the legacy Fastify service plugin. The
service delegates to `LedgerRepo`, and both create and update call `upsertLedger`. The repository
uses `INSERT ... ON CONFLICT DO UPDATE`, which makes a missing update indistinguishable from a
create. List queries order by creation time but have no tie-breaker. The shared pagination schema
accepts unbounded numbers.

The public response already omits Currency, but the request schema still accepts optional
`currency` and `currencyExponent`. The legacy `LedgerEntity` carries those values and transforms
between HTTP, database, and service representations. Invalid persisted metadata is silently
discarded.

The physical `ledgers` table stores non-null `currency` and `currency_exponent` columns with
defaults of `USD` and `2`. Current Account routes use these values when encoding balances.
Transaction creation uses them when constructing Entries. Settlement routes and services also read
them. These are active compatibility consumers, not hypothetical future consumers.

### Organization reference and retrospective

The Organization migration established the managed Effect runtime, `DatabaseTag`, direct Fastify
handlers, `Context.Service` services, Layers, shared ID parsing, PostgreSQL error classifiers, and
the live database test Layer.

Its retrospective found that the original design added unrelated authorization, Redis, HTTP,
resource-lifecycle, and test-platform work. The cleanup kept direct handlers, shared errors and IDs,
ordinary pool shutdown, and focused tests. This design follows that result: it reuses the working
foundation and adds only Ledger behavior.

### Research decisions

| Concern | Existing solution | Decision | Current requirement |
| --- | --- | --- | --- |
| Domain language | Currency-free Ledger definition in `CONTEXT.md` | reuse | Remove public Currency ownership |
| IDs | Existing `LedgerID`, TypeID, and `parseId` | reuse | Generate and parse canonical IDs |
| Public contract | Currency-free response, Currency-bearing request | modify | Remove Currency fields and ignore undeclared input |
| Persistence | One upsert for create and update | delete | Missing update returns `404` |
| Tenancy | Organization filters on most queries | modify | Filter every operation consistently |
| Pagination | Unbounded shared query and creation-time ordering | modify | Bound and stabilize lists |
| Errors | Shared HTTP errors and PostgreSQL classifiers | reuse | Typed Effect failure channels |
| Runtime | Managed runtime and database Layer | modify | Add the Ledger Layer |
| Currency storage | Existing non-null columns and defaults | reuse | Preserve compatibility values |
| Compatibility | Legacy tenant-scoped Ledger read | reuse | Keep child endpoints working |
| Database migration | No schema change required | reuse | Defer step 03 migration work |
| Tests | Focused Organization boundary tests | modify | One contract per active boundary |
| Full-stack harness | Removed during Organization cleanup | delete | No HTTP-to-PostgreSQL suite |

## Architecture

### Selected approach

Create an isolated Effect Ledger slice for the five public endpoints and retain the existing
tenant-scoped legacy Ledger read for unfinished child resources.

```text
Public Ledger endpoints
Fastify and TypeBox
        |
        v
Effect LedgerService
        |
        v
Effect LedgerRepo
        |
        v
Drizzle and PostgreSQL

Legacy child resources
        |
        v
Existing LedgerService.getLedger or LedgerRepo.getLedger
        |
        v
Legacy LedgerEntity with compatibility Currency
```

The new slice contains only its real boundaries:

```text
apps/api/src/ledgers/
  domain/
    Ledger.ts
  LedgerErrors.ts
  LedgerRepo.ts
  LedgerRoutes.ts
  LedgerSchema.ts
  LedgerService.ts
  index.ts
```

It does not add an ID-generator service, generic HTTP executor, `application/` directory,
`adapters/` directory, or test harness.

### Public Ledger domain

`Ledger` is a pure immutable value containing the existing branded Ledger and Organization IDs,
name, optional description, optional string-valued metadata, and timestamps.

The domain imports no Effect, Fastify, TypeBox, Drizzle, database row, or environment code. It has
no Currency or Minor Unit Exponent. The repository owns row decoding because persisted data is an
adapter concern.

Normal repository queries select only public columns. The private decoder validates IDs,
timestamps, JSON structure, and string-valued metadata. Invalid persisted data produces a typed
persistence-decoding failure instead of disappearing from the response.

### Effect service

`LedgerService` is a `Context.Service` with five operations: list, get, create, update, and delete.
Every operation receives the authenticated Organization ID.

The service generates Ledger IDs directly with the installed TypeID library. A separate generator
service would have one implementation and no product requirement. Tests assert that generated IDs
are canonical rather than controlling their exact value.

The service maps an absent get, update, or delete result to `LedgerNotFound`. Create and update use
separate repository methods. The service adds no access-policy layer, retries, rate limiting, or
generic orchestration.

### Effect repository

The repository capability exposes intention-revealing `list`, `get`, `create`, `update`, and
`delete` methods. The live implementation uses `DatabaseTag` and wraps database promises with
`Effect.tryPromise`.

- List filters by Organization ID, orders by Ledger ID ascending, and applies the validated limit
  and offset.
- Get filters by Ledger and Organization ID and returns explicit absence.
- Create inserts the generated ID, Organization ID, and public request fields. It omits timestamps
  and legacy Currency fields so PostgreSQL supplies their defaults.
- Update filters by both IDs, replaces mutable fields, writes SQL `NULL` for omitted optional
  fields, and sets `updated` with PostgreSQL's current timestamp.
- Delete filters by both IDs and returns explicit absence when no row was deleted.

PostgreSQL error `23503` from delete maps to `LedgerHasDependents`. A missing parent Organization
during create maps to the existing Organization not-found error. Database unavailability during
create maps to the shared `503` with `retryable: false` because the commit outcome may be ambiguous.
The other operations retain the shared retryable `503`. Invalid rows and unexpected operations map
to sanitized `500` errors. A generated primary-key collision is an internal persistence failure
because the client neither chooses nor reuses the ID.

### HTTP boundary

The new routes keep the existing paths and permissions. Each direct handler decodes TypeBox input,
parses path IDs with `parseId`, invokes `LedgerService` through the managed runtime, maps the domain
value to its response, and throws typed failures to the existing global handler.

Create and update use separate schemas with `additionalProperties: false`. Fastify's existing AJV
configuration removes undeclared properties during validation, so Currency fields and other extra
input never reach the handler. This slice does not change the shared validator configuration.
Create sets `201` and `Location`; delete sends an empty `204`. No route advertises a failure that
its implementation cannot produce.

### Compatibility boundary

The existing `LedgerEntity` and tenant-scoped `getLedger` path remain available to current Account,
Transaction, and Settlement code. Public Ledger routes stop using the legacy service. The legacy
service may be reduced to its compatibility read when that does not force unrelated child-resource
or fixture rewrites.

Existing repository CRUD helpers may remain temporarily when their removal would require broad
fixture changes. They do not belong to the new Ledger entrypoint or runtime service. The retained
path is marked for removal in step 03.

### Runtime and module boundaries

The Ledger Layer joins the Organization Layer in the existing managed runtime and shares
`DatabaseTag`. The legacy service plugin remains for unfinished child slices.

Boundary configuration adds the Ledger domain, repository, service, transport, routes, and
composition entrypoint. Dependencies flow from routes to service to repository to database. The
runtime and legacy Ledger router may import the Ledger composition entrypoint. Ledger may reuse the
Organization slice's public error contract but cannot import its implementation files.

## API Design

### Representation

```json
{
  "id": "lgr_...",
  "name": "Operating Ledger",
  "description": "Optional description",
  "metadata": {
    "externalId": "book-42"
  },
  "created": "2026-08-09T10:00:00.000Z",
  "updated": "2026-08-09T10:00:00.000Z"
}
```

`description` and `metadata` are omitted when absent.

### Request

```json
{
  "name": "Operating Ledger",
  "description": "Optional description",
  "metadata": {
    "externalId": "book-42"
  }
}
```

`name` is required. `description` and `metadata` are optional. Metadata keys and values are strings.
Fastify removes unknown properties before the handler runs. The remaining declared fields must
still pass validation. On `PUT`, omission clears an optional field; an empty string or empty object
remains an explicit value.

### Endpoints

| Operation | Success | Behavior |
| --- | --- | --- |
| `GET /api/ledgers?offset=0&limit=20` | `200` | Tenant-filtered array ordered by Ledger ID |
| `GET /api/ledgers/:ledgerId` | `200` | Tenant-filtered single Ledger |
| `POST /api/ledgers` | `201` | Creates a Ledger and sets `Location` |
| `PUT /api/ledgers/:ledgerId` | `200` | Replaces mutable fields and never inserts |
| `DELETE /api/ledgers/:ledgerId` | `204` | Deletes an unused Ledger with an empty body |

### Errors

All errors use the existing RFC 7807-compatible response.

| Condition | Status |
| --- | --- |
| Invalid query, body, or Ledger ID | `400` |
| Missing or invalid authentication | `401` |
| Missing permission | `403` |
| Missing parent Organization during create | `404` |
| Missing or cross-Organization Ledger | `404` |
| Delete blocked by dependent records | `409` |
| Persistence decoding or unexpected database failure | `500` |
| PostgreSQL unavailable during create | `503`, `retryable: false` |
| PostgreSQL unavailable during another operation | `503`, `retryable: true` |

Create and update do not advertise `409`. Ledger routes do not advertise `429` because no Ledger
rate limiter exists. A create response with `retryable: false` tells clients not to retry
automatically. The API accepts no Ledger idempotency key. There are no event contracts.

## Data Model

The physical `ledgers` table remains unchanged:

```text
id
organization_id
name
description
currency             NOT NULL DEFAULT 'USD'   temporary compatibility
currency_exponent    NOT NULL DEFAULT 2       temporary compatibility
metadata
created
updated
```

Normal Effect repository queries project only:

```text
id, organization_id, name, description, metadata, created, updated
```

Existing rows keep their Currency values. New rows receive the database defaults. Update never
reads or writes these columns. Step 02 adds no migration, constraint, index, or backfill.

Step 03 must expand Accounts with Currency fields, backfill them from the preserved Ledger values,
move every Account, Transaction, and Settlement compatibility consumer, verify the result, and only
then remove the compatibility path and Ledger columns.

## Test Design

Tests cover one contract at each active boundary.

### Router with mocked Effect service

- Existing permissions remain attached to the five operations.
- Pagination defaults and bounds are enforced.
- Malformed and noncanonical IDs return `400`.
- Currency and other unknown request fields are removed before the mocked service receives the
  body; requests with otherwise valid fields still succeed.
- Missing or malformed declared fields return `400`.
- Responses omit Currency.
- Create returns `201` and `Location`; delete returns an empty `204`.
- All five operations pass the authenticated Organization ID to the mocked service.
- Typed not-found and dependency failures map to `404` and `409`; create-time database
  unavailability maps to `503` with `retryable: false`.

Shared authentication and error behavior is not repeated for every endpoint.

### Service with mocked repository

- All five operations forward the Organization ID; list also forwards pagination.
- Create generates a canonical Ledger ID and calls only repository create.
- Create maps database unavailability to `503` with `retryable: false`.
- Update calls only repository update and maps absence to `LedgerNotFound`.
- Get and delete map absence to the same not-found error.
- Repository infrastructure and dependency failures remain in the typed error channel.

### Repository with PostgreSQL

- List ordering, pagination, and Organization isolation are enforced in SQL.
- Get, update, and delete hide cross-Organization rows as absence.
- Duplicate names can be created.
- Create receives database timestamps and legacy `USD` and `2` defaults.
- A missing parent Organization maps PostgreSQL `23503` to the existing Organization not-found
  error; a generated-ID collision maps `23505` to an internal persistence failure.
- Update replaces mutable fields, clears omitted optional fields, preserves `created`, and changes
  `updated`.
- Updating a row with non-default legacy Currency and exponent values preserves both values. A read
  through the retained legacy path returns the original values after the update.
- Updating a missing Ledger does not insert it.
- Delete returns absence for a missing row and a typed conflict for real dependencies.
- Invalid persisted metadata produces a typed decoding failure.

There is no HTTP-to-PostgreSQL suite and no new test harness.

## Trade-offs

Approach A temporarily keeps a Currency-free Effect Ledger model beside the legacy Currency-bearing
entity. This duplication ends when step 03 removes the compatibility path. It costs less than
rewiring unfinished child resources and their fixtures now.

Offset pagination preserves the existing API and becomes deterministic through ID ordering.
Concurrent inserts can still shift later pages. Cursor pagination is deferred because no current
story requires an API redesign.

New Ledgers receive `USD` and exponent `2` until Account Currency exists. Public callers cannot
choose another Currency during this interval. This is the accepted cost of removing Currency from
the Ledger contract before step 03.

`PUT` remains last-write-wins because Ledger has no version field or current concurrency story.
Metadata remains string-valued to preserve the published contract. Invalid persisted metadata
fails visibly instead of being discarded.

Fastify silently removes legacy Currency request fields and other undeclared properties. A caller
may receive success even though the API ignored those fields. OpenAPI no longer advertises them,
and the handler never receives them. This preserves the API's existing tolerant-input behavior and
avoids a shared validator change.

Ledger create has no request-level idempotency. A connection failure after commit can leave the
caller unsure whether PostgreSQL created the Ledger, so create-time unavailability returns
`retryable: false`. Persistent deduplication belongs to later work.

The focused three-boundary test strategy gives less wiring coverage than an HTTP-to-PostgreSQL
suite. It avoids the reusable full-stack harness removed after the Organization migration and does
not repeat the CRUD matrix at every layer.

## Alternatives Considered

### Replace the legacy stack with an explicit compatibility capability

This would produce one persistence owner and a narrower projection, but it would also change
Accounts, Transactions, Settlements, and cross-resource fixtures. That scope repeats the mistake
identified in the Organization retrospective.

### Wrap the existing Promise repository in Effect

This would reuse more code, but Currency, upsert semantics, and transport-oriented errors would
remain inside the migrated architecture. Step 03 would inherit the cleanup.

### Add Account Currency columns in this step

This would remove the temporary internal duplication, but it would mix step 03's schema migration,
backfill, verification, and consumer switch into the Ledger migration.

## Open Questions

None. Scope, contracts, compatibility behavior, failure semantics, and testing boundaries are
resolved.
