# Ledger Account Statements Effect migration

## Goal

Migrate the existing Ledger Account Statement slice to Effect v4 and relocate it under
`apps/api/src/domains/ledgers/accounts/statements`, using Organizations and the integrated Ledger
Account slice as structural references. The migration preserves the current HTTP, domain, error,
persistence, transaction, concurrency, identifier, timestamp, and operational behavior exactly.

This is an internal architecture migration, not completion of the Ledger Account Statement domain
described in `CONTEXT.md`. The current placeholder behavior is the compatibility baseline for this
change set.

## Problem

Ledger Account Statements still use the legacy class-based repository and service plugins while
Organizations, Ledgers, Accounts, and Transactions run through the managed Effect runtime. This
leaves one Account subresource on a separate dependency-injection and persistence path, complicates
runtime ownership, and prevents the legacy Statement registrations from being removed.

API consumers must not observe a behavioral change while the slice moves. Today, Statements do not
yet calculate immutable period snapshots. They persist one date and aggregate columns, then return a
placeholder representation. Correct Statement generation is valuable but is a separate product and
domain change.

## Scope

### In scope

- Move the Statement domain object, schema, repository, service, routes, entrypoint, and focused
  tests into `apps/api/src/domains/ledgers/accounts/statements`.
- Express repository and service dependencies with Effect v4 `Context.Service` tags and Layers.
- Use the existing server `ManagedRuntime` and `DatabaseTag.effectDb` Effect-Drizzle client.
- Register the Statement Layer in the server runtime and execute Statement effects explicitly in
  Fastify handlers.
- Remove only Statement-specific legacy repository, service, route, schema, fixture, and plugin
  wiring after equivalent Effect-owned replacements exist.
- Add parity coverage for behavior that the existing tests leave implicit.

### Out of scope

- Calculating balances, totals, transaction counts, Account versions, or copied Entry data.
- Making Statements conform to the complete immutable snapshot definition in `CONTEXT.md`.
- Tenant-scoping Statement reads by Organization, Ledger, or Account.
- Reconciling route path identifiers with identifiers in the POST body.
- Persisting or returning the request description or end time.
- Replacing hard-coded Currency, Minor Unit Exponent, Normal Balance, version, or Balance values.
- Schema changes, SQL migrations, new indexes, or data backfills.
- New transaction boundaries, locks, retries, idempotency, concurrency controls, clocks, identifier
  services, error hierarchies, runtime abstractions, or observability infrastructure.
- Changes to Settlement, Category, Balance Monitor, Account, Ledger, Transaction, or Organization
  behavior beyond imports and composition required to detach Statement legacy wiring.

Any proposed deviation from the compatibility baseline requires a separate approved design,
`plan.json`, branch or stacked change set, and implementation. The first deferred project is
**Complete Ledger Account Statements**; it must define the actual snapshot, tenancy, period,
currency, version, persistence, and concurrency contracts before changing them.

## User stories

### US-1: Read an existing Statement through the Effect runtime

As an authorized API consumer, I want the existing Statement GET endpoint to behave identically
after migration so that clients do not need to change.

- Given a valid Statement ID that exists, when the nested GET endpoint is called, then it returns the
  same `200` representation as today.
- Given a valid Statement ID that does not exist, when the endpoint is called, then it returns the
  existing `404` problem response.
- Given different or nonexistent Ledger and Account IDs in the path, when the Statement ID exists,
  then lookup still uses the Statement ID alone.
- Priority: must.

### US-2: Create a placeholder Statement through the Effect runtime

As an authorized API consumer, I want the existing Statement POST endpoint to preserve its request,
persistence, and response behavior so that migration is transparent.

- Given a valid request, when the endpoint is called, then it returns the same `200` response.
- The body `ledgerId` and `accountId`, rather than the path IDs, remain authoritative for the inserted
  row.
- `startDatetime` becomes the sole persisted Statement date; `endDatetime` and `description` remain
  accepted but ignored.
- The response retains the exact placeholder fields defined in the baseline below.
- Priority: must.

### US-3: Preserve authorization, validation, and failure behavior

As an API operator, I want the migration to preserve the current permission checks, validation,
problem responses, and unexpected-failure handling.

- Authentication, `ledger:account:statement:read`, and `ledger:account:statement:write` checks remain
  unchanged.
- Invalid transport inputs continue to produce `400`; missing rows produce `404`; unexpected
  database and application failures produce the current generic `500` response.
- OpenAPI continues to advertise the same operations, schemas, statuses, tags, and descriptions,
  including currently advertised responses that the Statement implementation does not itself
  generate.
- Priority: must.

### US-4: Use the shared managed lifecycle

As an API maintainer, I want Statements to use the same Effect runtime and database lifetime as the
integrated slices so that the Statement-specific legacy service and repository registrations can be
removed.

- A server owns one managed runtime, the Statement Layer is composed into it, and server shutdown
  disposes it through the existing idempotent close path.
- Requests do not create runtimes or database pools.
- Priority: must.

## Constraints

- The owning package uses `effect@4.0.0-rc.112`, `@effect/sql-pg@4.0.0-rc.112`, and the
  Effect-PostgreSQL integration in `drizzle-orm@1.0.0-rc.5-ab785fc`; implementation must use the
  installed v4 APIs.
- Routes own TypeBox transport validation, authentication, permissions, status codes, OpenAPI, and
  execution of lazy Effects.
- Services own use-case orchestration. Repositories own SQL and absence detection. The Statement
  domain object owns request, row, insert, and response transformations without performing I/O.
- The current PostgreSQL table and Drizzle schema remain authoritative. No migration is permitted.
- Stub-driven TDD and the existing PostgreSQL test Layer or fixtures are used at the narrowest useful
  boundary.
- Unrelated work in the worktree must remain untouched.

## Baseline and research decisions

The following table is the migration lock. `reuse` means preserve and call the existing shared
capability, `modify` means relocate or adapt the implementation without changing observable
behavior, and `delete` applies only after the replacement is active.

| Concern | Existing solution | Decision | Current requirement |
| --- | --- | --- | --- |
| Runtime | One server-owned managed Effect runtime already serves Organizations and Accounts | reuse | Run Statement Effects without per-request runtimes |
| Database | `DatabaseTag` exposes `effectDb`; legacy Statement repository uses promise Drizzle | modify | Move Statement SQL onto the installed Effect-Drizzle client |
| Slice location | Statement code is split across legacy `repo`, `services`, and `routes/ledgers` folders | modify | Relocate the complete resource slice under its Account domain owner |
| HTTP paths | `GET /api/ledgers/:ledgerId/accounts/:accountId/statements/:statementId` and `POST /api/ledgers/:ledgerId/accounts/:accountId/statements` | reuse | Preserve the public surface |
| Authorization | Read and write permissions run in Fastify pre-handlers | reuse | Preserve authentication and authorization behavior |
| GET scope | Repository filters only by Statement ID; nested Ledger and Account path IDs are ignored | reuse | Preserve lookup and cross-path behavior |
| POST ownership | Request-body Ledger and Account IDs are parsed and persisted; path IDs are ignored | reuse | Preserve identifier precedence |
| Statement ID | A new `lst` TypeID is generated synchronously for create; GET parses the supplied `lst` ID | reuse | Preserve identifier format, timing, and failure behavior |
| Period | `startDatetime` becomes `statementDate`; `endDatetime` is accepted and ignored | reuse | Preserve persisted and returned times |
| Description | Accepted on create, never persisted, and omitted from responses | reuse | Preserve request and response behavior |
| Stored aggregates | Create writes zero opening, closing, credit, and debit totals and zero transaction count | reuse | Preserve placeholder persistence |
| Response projection | Start and end equal `statementDate`; version is `0`; Normal Balance is Debit; Currency is `USD`; Minor Unit Exponent is `2`; all three starting and ending Balances are zero | reuse | Preserve the exact wire representation |
| Metadata | Create stores no metadata; valid stored JSON is decoded in the domain model, but the current response serializer emits an empty object; malformed JSON is silently treated as absent | reuse | Preserve both domain decoding and the existing wire representation |
| Timestamps | Request construction captures one `Date`; insert omits Created Time for the database default and writes a fresh Updated Time; returned timestamps come from `INSERT ... RETURNING` or SELECT | reuse | Preserve timestamp sources and ordering |
| Read SQL | Select by Statement ID with `LIMIT 1` | reuse | Preserve access pattern and absence behavior |
| Create SQL | One `INSERT ... RETURNING` into `ledger_account_statements` | reuse | Preserve atomicity and returned persisted values |
| Transactions | Each repository call is a single autocommit statement | reuse | Add no explicit transaction |
| Concurrency | No lock, optimistic predicate, retry, uniqueness policy, or idempotency mechanism | reuse | Preserve concurrency and duplicate-request behavior |
| Not found | A missing SELECT produces the existing Not Found problem/error | modify | Express absence in Effect while retaining `404` at HTTP |
| Other failures | Duplicate keys, foreign-key failures, database unavailability, unexpected decode failures, and defects reach the global handler as generic `500` failures | reuse | Do not introduce new `409` or `503` translations during migration |
| OpenAPI | GET advertises `200/400/401/403/404/429/500/503`; POST advertises `200/400/401/403/409/429/500/503` | reuse | Preserve documentation even where no Statement code currently generates a status |
| Legacy wiring | `RepoPlugin` and `ServicePlugin` construct and decorate Statement dependencies | delete | Remove Statement-only registrations once routes use the runtime |

## Architecture

The relocated resource slice is:

```text
apps/api/src/domains/ledgers/accounts/statements/
  LedgerAccountStatement.ts
  LedgerAccountStatementRepo.ts
  LedgerAccountStatementService.ts
  LedgerAccountStatementSchema.ts
  LedgerAccountStatementRoutes.ts
  index.ts
  focused tests beside their owners
```

The runtime flow is:

```text
Fastify Statement routes
  -> existing server ManagedRuntime
     -> LedgerAccountStatementService
        -> LedgerAccountStatementRepo
           -> DatabaseTag.effectDb
              -> PostgreSQL ledger_account_statements
```

### Domain object

`LedgerAccountStatement` replaces the legacy entity without redesigning it. It holds the same
identifier, Ledger ID, Account ID, Statement date, aggregate values, metadata, Created Time, and
Updated Time. It owns pure or lazy typed transformations from the validated create request and
persisted row, to the insert row, and to the existing response.

The migration may use Effect to represent decoding failure, matching the integrated slices, but it
must preserve legacy successful decoding. In particular, malformed metadata remains `undefined`;
it must not become a new typed client or server error. No Clock or ID-generator service is added:
native `Date` and TypeID creation preserve the existing behavior.

### Repository

`LedgerAccountStatementRepo` is a Context service backed by `DatabaseTag.effectDb`. Its interface
contains only the get and create Effects used by the service. It preserves the current SQL
predicates and single-statement boundaries. Read absence is represented explicitly and converted
to the existing Not Found failure. All other failures retain their generic server-error behavior;
the repository must not adopt Account or Organization database-error translations merely for
consistency. Repository tests remove their rows through the database test Layer, following the
Transaction repository tests, instead of adding a production cleanup capability.

### Service

`LedgerAccountStatementService` is a Context service depending only on the Statement repository.
GET parses the Statement ID and delegates. Create constructs the placeholder Statement from the
body and delegates. It does not load the Organization, Ledger, Account, Transactions, or Entries,
and it adds no business checks.

### Routes and composition

The relocated Fastify plugin keeps the same nested prefixes, TypeBox schemas, operation IDs,
permissions, tags, status codes, and response conversion. Handlers follow the integrated slices:
construct a lazy Effect, run `Effect.result` with `request.server.runtime`, return the response on
success, and throw the failure for the global Fastify handler.

The Statement repository and service Layers compose into one Statement Layer. The server runtime
includes that Layer using the existing Database Layer. The legacy router imports the relocated
plugin until route organization is migrated separately. Statement entries are removed from the
legacy repository and service plugin option types and decorators; other legacy resources remain.

## API design

There are no public API changes.

### Get

```http
GET /api/ledgers/{ledgerId}/accounts/{accountId}/statements/{statementId}
Permission: ledger:account:statement:read
Success: 200
```

Only `statementId` affects persistence lookup. The nested path continues to communicate resource
shape without enforcing scope.

### Create

```http
POST /api/ledgers/{ledgerId}/accounts/{accountId}/statements
Permission: ledger:account:statement:write
Success: 200
```

The request remains:

```ts
type LedgerAccountStatementRequest = {
  ledgerId: string
  accountId: string
  description?: string
  startDatetime: string
  endDatetime: string
}
```

The body IDs remain authoritative. Description and end time remain transport-only placeholders.

### Response

The existing response schema and field names remain unchanged. Every response continues to:

- omit `description`;
- set `startDatetime` and `endDatetime` to the persisted `statementDate`;
- set `ledgerAccountVersion` to `0`;
- set `normalBalance` to `debit`;
- return Pending, Posted, and Available starting and ending Balances with zero Amount, Credits, and
  Debits;
- set `currency` to `USD` and `currencyExponent` to `2` at both Statement and Balance levels;
- return an empty metadata object when stored metadata decodes successfully, matching the current
  response serializer; and
- serialize persisted Created and Updated Times as ISO strings.

The current RFC 7807-style problem format remains shared with the rest of the API. Validation and
authentication failures remain Fastify concerns. The global handler continues to hide unexpected
failure details behind `Internal Server Error`.

## Data model and persistence

The existing `ledger_account_statements` table remains unchanged:

- primary key: `id`;
- foreign keys: `ledger_id` and `account_id` independently reference their parent tables;
- `statement_date` stores the create request's start time;
- opening, closing, credit, and debit aggregate columns retain numeric precision `20,4`;
- `transaction_count` remains an integer;
- metadata remains nullable text containing JSON; and
- Created and Updated Times retain their database defaults.

No Organization ID is added. No composite foreign key is introduced. The repository does not join
or query parent resources. There is no migration, backfill, index, transaction wrapper, lock, retry,
or cleanup change.

## Verification

Verification follows stub-driven TDD and assigns one contract to each active boundary:

- Domain tests lock request construction, generated TypeID prefix, body-ID precedence, ignored
  description and end time, zero aggregates, metadata decoding including malformed JSON, persisted
  timestamp preservation, insert encoding, and the exact placeholder response.
- Service tests use a tagged stub repository to prove GET parsing/delegation, create construction,
  and failure propagation without adding parent lookups.
- Repository tests use PostgreSQL and the existing test database support to prove ID-only SELECT,
  one-row INSERT/RETURNING, valid metadata round trips, missing-row behavior, and unchanged generic
  handling of duplicate-key and foreign-key failures. Tests clean up through the database test
  Layer rather than the production repository contract.
- Route tests use a runtime Layer override rather than legacy service decoration. They lock paths,
  permissions, validation, advertised status schemas, success payloads including current metadata
  serialization, `200` create status, ignored path scope, body-ID precedence, Not Found, and generic
  internal failures.
- Runtime composition and type checking prove the Statement Layer is available from the shared
  runtime. The migration does not retest unchanged runtime reuse or disposal behavior.
- Focused type checking, linting, formatting checks, Statement tests, and the API test suite must
  pass before the migration is considered complete.

Existing snapshot assertions may be retained only where they make the full compatibility payload
easier to review; critical placeholder values receive explicit assertions.

## Trade-offs

### Selected: relocate the full slice and use Effect-Drizzle

This creates a coherent Account-owned Statement slice and removes the legacy runtime path while
using the database capability already available in the shared runtime. It costs a broader file move
than adapting the service alone and requires focused rewiring of tests and server composition.

### Rejected: migrate only the service in place

This is the smallest code change, but it leaves Statement persistence, routes, schemas, and plugin
wiring split across the legacy architecture. It does not achieve the selected ownership boundary or
remove the Statement legacy dependency path.

### Rejected: relocate the slice but wrap promise Drizzle

This would preserve SQL with less repository adaptation, but it would continue using
`DatabaseTag.db` rather than the selected Effect-Drizzle client and leave a mixed persistence model
inside a newly migrated slice.

### Known limitations

The migrated slice remains intentionally incomplete: it is not tenant-scoped, does not copy Entries,
does not calculate Balances, and does not preserve description or a true period. These are baseline
limitations, not migration defects. Fixing any of them changes domain or public behavior and belongs
to the separate **Complete Ledger Account Statements** project.

## Open questions

None. The migration baseline and architectural approach are approved. Any implementation discovery
that would change a contract in this document must stop the migration and be proposed as a separate
design, plan, and change set.
