# Transactions Effect implementation plan draft

This draft converts the approved design into implementation units. Each task is intended to fit
one focused TDD cycle. `design.md` remains authoritative when this draft and older Transaction
documents disagree.

## Test boundaries

- HTTP tests inject Fastify requests against a mock Transaction service Layer. They own transport
  validation, permissions, status codes, headers, response serialization, and error mapping.
- Service tests use mock Transaction and idempotency repository Layers. They own orchestration,
  server IDs and time, idempotency flow, retry selection, limits, and typed error propagation.
- PostgreSQL repository tests run against real PostgreSQL. They own domain rules reached through
  persistence, row decoding, tenancy, lifecycle writes, counter deltas, rollback, locking, and races.
- Idempotency repository tests run against real Valkey/Redis. They own key scoping, atomic claims,
  TTL, repopulation, availability errors, and client lifecycle.
- Migration tests run against real PostgreSQL. A small assembled suite proves cross-layer wiring and
  shared-store behavior without repeating the seam matrices.
- Tests use table-driven cases at each seam to exercise all branches owned by that seam. Pure domain
  helpers and internal implementation details receive no separate unit tests when the repository or
  service seam already exercises them.

## P1: Domain and Account projection

### T1: Add the Transaction domain and typed failures

Depends on: none

Inputs:

- The lifecycle, Entry, balancing, and counter-delta rules in `design.md`
- Canonical Ledger, Transaction, Entry, Account, and Organization ID types
- The Account slice's Currency model and the shared HTTP error contract

Description:

Add the pure Transaction and Entry domain model, including exhaustive Pending, Posted, and Voided
transitions. Validate at least two Entries, positive safe-integer Amounts, string metadata, repeated
Accounts, and exact Debit and Credit totals for each Currency Code and Minor Unit Exponent pair.
Group Entries by Account and expose the counter deltas required by create, replace, post, and void.
Add typed validation, lifecycle, persistence, concurrency, and availability failures without I/O or
Effect execution in the domain.

Files:

- Create `apps/api/src/ledgers/transactions/domain/Transaction.ts`
- Create `apps/api/src/ledgers/transactions/TransactionErrors.ts`
- Modify `apps/api/src/ledgers/accounts/index.ts`

Validation:

- Table-driven PostgreSQL repository cases in T7 through T9 cover the lifecycle, validation,
  balancing, repeated-Account, and aggregated-delta branches through the public repository seam.
- The domain reuses canonical IDs and Account Currency types and performs no I/O.
- No direct domain test duplicates behavior observable through a repository or service seam.

### T2: Derive Account balance views from authoritative counters

Depends on: T1

Inputs:

- The four-counter projection and formulas in `design.md`
- The current Account domain, repository row mapping, response mapper, and focused tests

Description:

Make Pending Credits, Pending Debits, Posted Credits, and Posted Debits the Account model's only
authoritative counters. Derive Pending, Posted, and Available balance amounts and direction totals
from those counters and Normal Balance. Keep negative values valid and preserve the public Account
response shape.

Files:

- Modify `apps/api/src/ledgers/accounts/domain/Account.ts`
- Modify `apps/api/src/ledgers/accounts/AccountRepo.ts`
- Modify `apps/api/src/ledgers/accounts/AccountRepo.test.ts`
- Modify `apps/api/src/ledgers/accounts/AccountRoutes.test.ts`

Validation:

- Table-driven Account repository tests use real PostgreSQL for row decoding and all debit-normal and
  credit-normal formulas.
- Account HTTP tests use a mock Account service and verify serialization of the derived balances.
- Account reads return the existing three balance views without stored derived columns.
- Negative balances remain valid.
- Account create still starts all four counters at zero and preserves the current response contract.

## P2: Transaction schema migration

### T3: Contract the Drizzle schema to the approved Transaction model

Depends on: T1, T2

Inputs:

- The approved Transaction, Entry, Account projection, constraint, and index definitions
- Current Drizzle tables, relations, and migration metadata through migration 0004
- Existing composite Ledger ownership constraints

Description:

Update the Drizzle schema to add Posted Time and Entry Ledger ownership, scope idempotency by
Organization, replace Archived with Voided, and express the required composite ownership keys.
Remove Effective Time, Entry lifecycle and duplicated Currency fields, and stored Account projection
columns. Add safe-integer and positivity checks plus the list and lookup indexes required by current
queries. Keep nullable legacy idempotency keys and all Settlement foreign-key relationships valid.

Files:

- Modify `apps/api/src/repo/schema.ts`

Validation:

- The schema exposes exactly the columns and lifecycle values approved in `design.md`.
- Composite keys prevent a Transaction or Entry from crossing Organization or Ledger boundaries.
- Account checks cover all four authoritative counters, and Entry Amount checks cover positivity and
  JavaScript's safe-integer range.
- The Transaction list index supports Ledger scope and `created DESC, id DESC` ordering.

### T4: Add and verify the transactional data migration

Depends on: T3

Inputs:

- The ordered migration procedure in `design.md`
- The contracted Drizzle schema from T3
- Existing rows and constraints produced by migrations 0000 through 0004

Description:

Add one transactional migration that expands the schema, backfills Entry Ledger IDs, verifies
tenancy and financial invariants, converts Archived Transactions to Voided, backfills Posted Time,
and rebuilds the four Account counters from Entries joined to their parent Transaction. Replace the
ownership and idempotency constraints and indexes only after verification, then remove obsolete
columns and the old enum. Add a focused migration regression that starts from the 0004 schema and
proves both successful rebuild and rollback on invalid legacy data.

Files:

- Create `apps/api/migrations/0005_transactions_effect.sql`
- Create `apps/api/migrations/meta/0005_snapshot.json`
- Create `apps/api/src/ledgers/transactions/TransactionMigration.test.ts`
- Modify `apps/api/migrations/meta/_journal.json`

Validation:

- Migration cases use real PostgreSQL and a table of valid and invalid 0004 fixtures.
- A clean database migrates through 0005.
- Populated 0004 data retains Transactions and Entries, converts Archived to Voided, receives correct
  Posted Time, and rebuilds all four counters independently.
- Null legacy idempotency keys remain valid.
- Invalid tenancy, Currency, Amount, lifecycle, or unsafe aggregate data aborts the whole migration.
- The post-migration schema matches `apps/api/src/repo/schema.ts`.

## P3: Valkey repository and runtime wiring

### T5: Add the managed Transaction idempotency repository

Depends on: T1

Inputs:

- The Organization-scoped key format, atomic claim, and 24-hour TTL in `design.md`
- The existing managed Effect runtime and resource-finalizer pattern
- The Compose and environment configuration used by local development and tests

Description:

Add a private Transaction idempotency repository backed by one managed ioredis client connected to
the shared Valkey deployment through `VALKEY_URL`. Support lookup, atomic `SET NX` claim, repopulation,
and safe cleanup of an uncommitted claim. Translate command or connection failures to the approved
typed availability failure. Compose the repository once per Fastify server, allow a mock service-test
Layer, and keep unrelated endpoints independent of Valkey readiness. Remove `radash`, whose only
remaining consumers belong to the legacy Transaction stack.

Files:

- Create `apps/api/src/ledgers/transactions/TransactionIdempotencyRepo.ts`
- Create `apps/api/src/ledgers/transactions/TransactionIdempotencyRepo.test.ts`
- Modify `apps/api/src/config.ts`
- Modify `apps/api/src/runtime.ts`
- Modify `apps/api/src/server.ts`
- Modify `apps/api/package.json`
- Modify `pnpm-lock.yaml`
- Modify `apps/api/.env.example`
- Modify `apps/api/.env.test`
- Modify `docker-compose.yml`

Validation:

- Idempotency repository tests use real Valkey/Redis, not a mocked client.
- One table-driven suite covers lookup hit and miss, claim win and loss, repopulation, cleanup, expiry,
  command failure, and connection failure.
- Keys use `exchequer:transactions:idempotency:<organizationId>:<key>` and expire after 24 hours.
- Concurrent claims elect one Transaction ID without overwriting the winner.
- Cache lookup and repopulation return the stored Transaction ID.
- Valkey failures remain typed and do not prevent the server or non-create Transaction endpoints from
  running.
- The runtime owns and closes one live client, while injected test clients remain externally owned.
- The package no longer depends on `radash`.

## P4: Effect repository

### T6: Implement tenant-scoped Transaction reads and idempotency lookup

Depends on: T1, T3, T4

Inputs:

- Transaction row codecs and failures from T1
- The migrated Transaction, Entry, Account, and Ledger tables
- Existing DatabaseTag, PostgreSQL classification helpers, and repository test Layer

Description:

Add the Effect Transaction repository contract, tag, live Layer, and read operations. Test this seam
against real PostgreSQL with no mocked database or query builder. Implement tenant-scoped list, get,
lookup by Organization and idempotency key, and complete Transaction loading with Account-derived
Currency. Decode rows through the domain, hide missing and cross-tenant records
behind the same absence result, and translate PostgreSQL availability, decoding, and unexpected
persistence failures at this boundary.

Files:

- Create `apps/api/src/ledgers/transactions/TransactionRepo.ts`
- Create `apps/api/src/ledgers/transactions/TransactionRepo.test.ts`

Validation:

- One table-driven PostgreSQL suite covers read success, absence, tenancy, pagination, ordering,
  decoding, and persistence-failure classifications.
- List defaults are applied at the route boundary and repository pagination is bounded.
- List ordering is stable at `created DESC, id DESC`.
- List, get, and idempotency lookup enforce both Organization and Ledger scope where applicable.
- Responses derive each Entry's Currency and Minor Unit Exponent from its Account.
- Missing and cross-tenant rows return explicit absence, and malformed persisted rows return a typed
  decoding failure.

### T7: Implement atomic Pending and Posted creation

Depends on: T6

Inputs:

- Domain validation and grouped counter deltas from T1
- Database constraints and indexes from T3 and T4
- Deterministic create locking and idempotency rules in `design.md`

Description:

Implement one repository create operation that claims the Organization-scoped database identity,
locks distinct Accounts by ascending ID inside the PostgreSQL transaction, and revalidates ownership,
Currency, balancing, and safe integers before writing. Insert the Transaction
and complete Entry set, apply one aggregated Account update per Account, set Posted Time for Posted
creates, and commit all changes together. Classify unique-key races, Account version conflicts,
deadlocks, and serialization failures without retrying inside the repository.

Files:

- Modify `apps/api/src/ledgers/transactions/TransactionRepo.ts`
- Modify `apps/api/src/ledgers/transactions/TransactionRepo.test.ts`

Validation:

- Table-driven repository cases execute against real PostgreSQL and cover each create status,
  validation failure, tenancy failure, and rollback point once.
- Pending create changes Pending counters once and leaves Posted counters unchanged.
- Posted create changes both counter sets once and records server Posted Time.
- Repeated Entries aggregate into one Account update and one `lockVersion` increment.
- Missing or cross-tenant Accounts are hidden as not found.
- Any failed validation or write rolls back the Transaction, Entries, and every Account counter.
- Concurrent database claims for one Organization and key produce one persisted Transaction and one
  balance effect.

### T8: Implement atomic Pending replacement

Depends on: T7

Inputs:

- Pending replacement and immutability rules in `design.md`
- The repository's create locking, validation, and delta helpers from T7

Description:

Implement complete replacement inside one PostgreSQL transaction. Lock the Transaction first, then
lock the sorted union of old and replacement Account IDs. Revalidate tenancy and the replacement
Entry set, subtract the old Pending effect, apply the new Pending effect, replace all Entries, clear
omitted optional fields, and update server-owned timestamps. Reject Posted and Voided replacements
with the typed lifecycle conflict.

Files:

- Modify `apps/api/src/ledgers/transactions/TransactionRepo.ts`
- Modify `apps/api/src/ledgers/transactions/TransactionRepo.test.ts`

Validation:

- Table-driven repository cases execute against real PostgreSQL and cover replacement success,
  lifecycle conflicts, ownership failures, and rollback points once.
- Replacement removes the old Pending effect and applies the new effect once.
- Accounts present in both Entry sets receive one aggregated update and one `lockVersion` increment.
- Omitted description and metadata are stored as null and omitted from the response.
- Posted and Voided Transactions remain unchanged and return Conflict.
- Failure at any point restores the original Transaction, Entries, and counters.

### T9: Implement atomic post and void transitions

Depends on: T8

Inputs:

- Post, void, and idempotent-repeat rules in `design.md`
- The repository's Transaction-first and sorted Account locking helpers

Description:

Implement post and void in PostgreSQL transactions. Lock the Transaction before its Accounts,
revalidate ownership and lifecycle, and apply the approved counter delta once. Posting records Posted
Time from the service clock and adds only Posted counters. Voiding retains the Transaction and Entries,
subtracts Pending counters, and never physically deletes data. Return existing state without balance
changes for repeated post/post and void/void operations.

Files:

- Modify `apps/api/src/ledgers/transactions/TransactionRepo.ts`
- Modify `apps/api/src/ledgers/transactions/TransactionRepo.test.ts`

Validation:

- A table-driven PostgreSQL lifecycle matrix owns every allowed, idempotent, and rejected transition.
- Posting leaves Pending counters unchanged, adds Posted counters once, and is idempotent when
  repeated.
- Voiding subtracts Pending counters once, leaves Posted counters unchanged, retains Entries, and is
  idempotent when repeated.
- Post on Voided and void on Posted return Conflict without changing data.
- Post/post, post/void, update/post, and opposite-order overlapping Account races serialize without
  duplicate effects or deadlock leakage.

## P5: Service and public HTTP slice

### T10: Implement Transaction orchestration, idempotency, and retries

Depends on: T5, T7, T8, T9

Inputs:

- PostgreSQL and idempotency repository contracts
- Existing Ledger service, canonical TypeID generators, and Effect Clock conventions
- The approved retry classification and all six use cases

Description:

Add the Transaction service contract, tag, Layer, and six operations. Pass Organization ID into every
operation, verify the Ledger parent where required, enforce the distinct Account limit before write
or Valkey claim, generate all IDs, and obtain server times from Effect Clock. Implement create replay
as Valkey lookup, PostgreSQL fallback and repopulation, atomic claim, and winner loading. Ensure a
concurrent loser waits for the elected committed Transaction without attempting another balance
effect. Apply one bounded Effect schedule only to typed deadlocks, serialization failures, and Account
version conflicts, mapping exhausted retries to Conflict.

Files:

- Create `apps/api/src/ledgers/transactions/TransactionService.ts`
- Create `apps/api/src/ledgers/transactions/TransactionService.test.ts`

Validation:

- Service tests use mock Ledger service, Transaction repository, and idempotency repository Layers plus
  deterministic Clock and ID inputs. They perform no HTTP, PostgreSQL, or Valkey I/O.
- Table-driven service cases cover all repository and idempotency outcomes, retryable-error classes,
  retry exhaustion, and nonretryable propagation without repeating persistence rules.
- A Valkey hit and PostgreSQL fallback both ignore the replay body and return the first Transaction.
- A PostgreSQL fallback repopulates Valkey for the remaining TTL policy.
- Valkey unavailability returns Service Unavailable before a new create attempt.
- Only classified concurrency failures retry; validation, tenancy, lifecycle, decoding, idempotency,
  and unknown persistence failures run once.
- Read, replace, post, and void never consult Valkey.

### T11: Define the Transaction transport contract

Depends on: T1

Inputs:

- The exact request, response, pagination, header, status, and failure contracts in `design.md`
- Existing Transaction paths and established TypeBox conventions

Description:

Add focused TypeBox request, parameter, query, header, and response schemas for the existing six
paths. Validate canonical IDs, bounded offset pagination, the required 1 to 255 character
`Idempotency-Key`, server-owned fields, metadata, Entries, and Amounts at the transport boundary.
Keep optional response fields absent rather than null and expose no legacy Effective Time, reversal,
Entry lifecycle, client ID, or resulting-balance fields.

Files:

- Create `apps/api/src/ledgers/transactions/TransactionSchema.ts`

Validation:

- The API package type-checks with request and response types derived from the new schemas.
- The schemas define malformed ID, pagination, unknown-field, header-length, metadata, Entry-count,
  and Amount-bound rejection for route tests in T12.
- Responses contain only server-owned IDs, Currency, lifecycle, and timestamps.
- Request types contain no client-owned IDs, Currency, Entry status, or timestamps.

### T12: Add direct Transaction routes and slice composition

Depends on: T6, T10, T11

Inputs:

- The transport contract from T11
- Existing direct Effect-backed Ledger and Account route patterns
- Existing JWT permission names, shared problem schemas, canonical ID parsing, and runtime

Description:

Add direct Fastify handlers for the existing six paths. Preserve permissions, return the approved
statuses and operation-specific failures, set Location on create, and return an empty body for
DELETE. Expose only the service contract and composed Layer through the slice entrypoint, register
the routes, compose the Layer into the shared runtime, and add explicit boundary rules.

Files:

- Create `apps/api/src/ledgers/transactions/TransactionRoutes.ts`
- Create `apps/api/src/ledgers/transactions/TransactionRoutes.test.ts`
- Create `apps/api/src/ledgers/transactions/index.ts`
- Modify `apps/api/src/runtime.ts`
- Modify `apps/api/src/routes/ledgers/index.ts`
- Modify `.oxlintrc.json`

Validation:

- Route tests inject Fastify requests with a mock Transaction service Layer and perform no PostgreSQL
  or Valkey I/O.
- Table-driven route cases cover all six success paths, permissions, request-validation branches,
  and operation-specific service errors once.
- Create returns `201`, Location, and the approved representation.
- Replace and post return `200`; void returns an empty `204`.
- Handlers use the existing server runtime directly, with no generic executor or route adapter.
- OpenAPI advertises only failures each operation can produce.

## P6: Compatibility switch and legacy removal

### T13: Bridge Settlement to the Effect Transaction service

Depends on: T10, T12

Inputs:

- The legacy Settlement transition that creates a Posted Transaction
- The new public Transaction service contract and managed runtime
- The stable Settlement-derived idempotency-key requirement

Description:

Replace Settlement's dependency on the Promise Transaction service with a narrow function that runs
the new create operation through the managed runtime and supplies a stable Settlement-derived
idempotency key. Update the Settlement request to the server-owned Transaction contract and preserve
the existing Settlement lifecycle and HTTP behavior.

Files:

- Modify `apps/api/src/services/LedgerAccountSettlementService.ts`
- Modify `apps/api/src/services/LedgerAccountSettlementService.test.ts`
- Modify `apps/api/src/services/index.ts`

Validation:

- Settlement service tests use mock Settlement repository and Transaction caller dependencies.
- Settlement creates the approved Posted Transaction with a deterministic key on retry.
- Repeating the Settlement transition cannot duplicate its Transaction or balance effect.
- Settlement passes no client-owned Transaction or Entry fields.
- Unrelated Settlement paths remain green.

### T14: Remove the legacy Transaction stack

Depends on: T12, T13

Inputs:

- The registered Effect Transaction routes and Settlement bridge
- All remaining production and test references to the legacy Transaction service, repository,
  entities, reader, schemas, fixtures, and snapshots

Description:

Remove the legacy Transaction service, repository, entities, physical-delete path, temporary Account
reader, plugin registrations, route contracts, fixtures, tests, snapshots, and exports after all
callers use the Effect slice. Preserve every unrelated legacy service and repository registration.

Files:

- Modify `apps/api/src/services/index.ts`
- Modify `apps/api/src/repo/index.ts`
- Modify `apps/api/src/repo/types.ts`
- Modify `apps/api/src/repo/entities/index.ts`
- Modify `apps/api/src/repo/fixtures.ts`
- Modify `apps/api/src/routes/ledgers/schema.ts`
- Modify `apps/api/src/routes/ledgers/fixtures.ts`
- Modify `apps/api/src/repo/LedgerAccountRepo.test.ts`
- Modify `apps/api/src/repo/LedgerAccountSettlementRepo.test.ts`
- Remove `apps/api/src/services/LedgerTransactionService.ts`
- Remove `apps/api/src/services/LedgerTransactionService.test.ts`
- Remove `apps/api/src/repo/LedgerTransactionRepo.ts`
- Remove `apps/api/src/repo/LedgerTransactionRepo.test.ts`
- Remove `apps/api/src/repo/LedgerAccountReader.ts`
- Remove `apps/api/src/repo/entities/LedgerTransactionEntity.ts`
- Remove `apps/api/src/repo/entities/LedgerTransactionEntryEntity.ts`
- Remove `apps/api/src/routes/ledgers/LedgerTransactionRoutes.ts`
- Remove `apps/api/src/routes/ledgers/LedgerTransactionRoutes.test.ts`
- Remove `apps/api/src/routes/ledgers/__snapshots__/LedgerTransactionRoutes.test.ts.snap`

Validation:

- Production registration contains no legacy Transaction repository, service, or Account reader.
- No source imports the removed entities or legacy Transaction route contracts.
- Unrelated Settlement paths and remaining legacy resource tests stay green.

## P7: Full-stack concurrency and documentation

### T15: Prove complete authenticated Transaction journeys

Depends on: T12, T14

Inputs:

- The assembled server, real PostgreSQL Layer, and a mock idempotency repository Layer
- Existing JWT signing, fixture isolation, and Fastify injection patterns
- The Pending, Posted, tenant-isolation, replay, and balance stories in `design.md`

Description:

Add two focused authenticated Fastify-to-PostgreSQL journeys: one Pending lifecycle through Account
balance reads and one direct Posted create with replay. Add one tenant-isolation case. These tests
prove assembled wiring only; seam tests retain the exhaustive validation and failure matrices. Reuse
current setup and fixture patterns instead of adding a generic test framework.

Files:

- Create `apps/api/src/ledgers/transactions/TransactionIntegration.test.ts`

Validation:

- Pending create, replace, post, and void journeys report the exact Account projections after each
  committed mutation.
- Posted create and replay produce one Transaction and one balance effect.
- Missing and cross-tenant Ledger, Transaction, and Account resources return the same 404 shape.
- Voided Transactions and Entries remain queryable.

### T16: Prove cross-instance idempotency

Depends on: T15

Inputs:

- The assembled server, real PostgreSQL Layer, and Compose-managed Valkey
- The cross-instance replay and availability requirements in `design.md`
- The existing Transaction benchmark scenarios

Description:

Add real Valkey coverage with two independent Fastify servers sharing one isolated namespace.
Use one table of assembled shared-store cases for same-key create, PostgreSQL fallback after a Valkey
miss, repopulation after expiry, and Valkey failure limited to create. PostgreSQL repository tests own
the mutation race matrix, and idempotency repository tests own individual Valkey commands. Update the
benchmark request and setup for the new public contract.

Files:

- Create `apps/api/src/ledgers/transactions/TransactionIdempotencyIntegration.test.ts`
- Modify `apps/api/test/bench/transaction.bench.ts`

Validation:

- Two servers racing one key return one Transaction ID and increment each affected Account once.
- A cache miss and an expired mapping load PostgreSQL and repopulate Valkey.
- A failing Valkey makes create return `503` while list, get, replace, post, void, health, and unrelated
  routes remain available.
- This suite does not repeat the PostgreSQL mutation-race or Valkey repository matrices.
- The benchmark uses the new request contract and required idempotency header.

### T17: Update Transaction documentation and run final verification

Depends on: T4, T16

Inputs:

- The completed migration and public contract
- Canonical domain terminology and the current ERD
- Repository validation commands in `AGENTS.md` and package scripts

Description:

Update the canonical glossary to remove Effective Time from the current Transaction model and align
Pending, Posted, Voided, Created, Updated, and Posted Time terms with the approved design. Replace or
mark the obsolete Transaction specification, technical design, and checklist so they no longer
advertise decimal Amounts, Archived state, physical deletion, client-owned accounting fields, or the
legacy stack. Update the ERD and local Valkey instructions. Run focused tests, clean and populated
migration checks, repository checks, the complete API suite, and local CI, then review the full diff
for unrelated changes.

Files:

- Modify `CONTEXT.md`
- Modify `README.md`
- Modify `apps/api/docs/product/erd.md`
- Modify `apps/api/docs/spec/transactions/spec.md`
- Modify `apps/api/docs/spec/transactions/design.md`
- Modify `apps/api/docs/spec/transactions/tasks.md`

Validation:

- Documentation describes the current server-owned Transaction contract and four-counter projection.
- Documentation uses Pending, Posted, and Voided consistently and contains no current Effective Time,
  Archived Transaction, physical delete, or decimal Amount claims.
- `pnpm --filter=@exchequerio/api test` passes with PostgreSQL and Valkey running.
- `pnpm run check` passes.
- A clean migration and the populated migration regression pass.
- `pnpm run ci` passes.
- The final diff contains no unrelated changes, generated artifacts, or obsolete Transaction stack.
