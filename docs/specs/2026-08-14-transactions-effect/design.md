# Transactions Effect migration

## Problem

The six Ledger Transaction endpoints still use the legacy Promise-based route, service, entity,
and repository stack. The implementation rejects repeated Entries for one Account, requires all
Accounts in a Transaction to share one Currency, accepts client-owned IDs and timestamps, and
physically deletes Transactions. It also exposes an `archived` state that conflicts with the
Pending, Posted, and Voided lifecycle.

Account balance updates are incorrect. The current code applies every Entry to Posted and
Available balances, does not maintain Pending balances, and can update the same Account more than
once from one stale version. Account reads therefore cannot reliably report Pending, Posted, and
Available balances after Transaction lifecycle changes or concurrent writes.

Create idempotency is not reachable through the public API and is not shared safely across API
instances. Transaction mutations also mix business rules with persistence, use ad hoc retries,
and do not enforce Organization and Ledger ownership consistently at both application and database
boundaries.

Organization users need reliable Transaction creation, mutation, posting, and voiding. API
maintainers need the resource migrated to the established Effect runtime without adding generic
frameworks or changing the existing route paths and permissions.

Success means all six endpoints use the Effect slice, every committed mutation has one atomic
balance effect, retries and idempotent replays cannot duplicate that effect, and the public
contract contains only server-owned accounting data.

## Scope

### In scope

- Migrate all six Transaction endpoints to Effect 4.
- Model Pending, Posted, and retained Voided Transactions.
- Allow a Pending Transaction's description, metadata, and complete Entry set to be replaced.
- Make Posted Transactions immutable.
- Permit repeated Entries for one Account and multiple Currencies in one Transaction.
- Balance Debits and Credits independently for each Currency and Minor Unit Exponent pair.
- Maintain atomic current Pending, Posted, and Available Account balances.
- Require shared Valkey-backed idempotency for Transaction creation.
- Add deterministic Account locking, classified retries, composite tenancy constraints, and the
  required database migration.
- Update focused tests and the documentation named by this design.

### Out of scope

- Effective Time, backdating, future activation, as-of balances, or historical balance APIs.
- Caller workflow, scheduling, business dates, valuation, foreign exchange, or pricing.
- Settlement lifecycle migration.
- Organization-owned Assets, which remain Step 09.
- Generic Effect executors, HTTP adapters, Valkey frameworks, or test frameworks.
- Preventing negative balances.

## User stories

All stories are must-have.

### US-1: List and retrieve Transactions

As an Organization user with Transaction read permission, I want to list and retrieve Transactions
inside one Ledger without crossing tenant boundaries.

- `GET /api/ledgers/:ledgerId/transactions` returns only Transactions owned by the authenticated
  Organization and route Ledger.
- List pagination is bounded and defaults to the existing repository convention.
- Results are ordered by `created DESC, id DESC`.
- `GET /api/ledgers/:ledgerId/transactions/:transactionId` returns one matching Transaction.
- Missing and cross-tenant resources return the same `404` response.
- Malformed or noncanonical IDs and invalid pagination return `400`.

### US-2: Create a Pending or Posted Transaction

As an Organization user with Transaction write permission, I want to record a balanced Transaction
once, even if the request is retried.

- Create requires an opaque `Idempotency-Key` header containing 1 through 255 characters.
- The request accepts `status: "pending" | "posted"`, an optional description, optional
  string-valued metadata, and at least two Entries.
- Each Entry accepts an Account ID, Debit or Credit direction, a positive safe-integer Amount in
  Minor Units, and optional string-valued metadata.
- The server generates Transaction and Entry IDs and all timestamps.
- Referenced Accounts must belong to the authenticated Organization and route Ledger.
- The service permits repeated Account IDs and rejects more than 200 distinct Accounts.
- Debits and Credits balance exactly within every Account Currency and Minor Unit Exponent pair.
- A Pending create changes Pending counters once. A Posted create changes Pending and Posted
  counters once and records Posted Time.
- Success returns `201 Created`, the Transaction representation, and a `Location` header.

### US-3: Replace a Pending Transaction

As an Organization user with Transaction write permission, I want to replace a Pending
Transaction before it becomes an immutable accounting fact.

- `PUT /api/ledgers/:ledgerId/transactions/:transactionId` replaces description, metadata, and
  the complete Entry set.
- Omitted optional fields clear their stored values.
- Replacement Entries satisfy the same ownership, Amount, Account-count, and per-Currency balance
  rules as create.
- The operation subtracts the old Pending Entry effect and applies the replacement effect once in
  the same database transaction.
- Updating a Posted or Voided Transaction returns `409`.
- Success returns `200` with the updated Transaction.

### US-4: Post a Pending Transaction

As an Organization user with Transaction write permission, I want to make a Pending Transaction an
immutable Posted accounting fact.

- `POST /api/ledgers/:ledgerId/transactions/:transactionId/post` changes Pending to Posted and sets
  `postedAt` from the server clock.
- Posting adds the Entries to Posted counters while leaving Pending counters unchanged.
- Repeating the operation for an already Posted Transaction returns the same Posted Transaction
  without another balance effect.
- Posting a Voided Transaction returns `409`.
- Success returns `200` with the Posted Transaction.

### US-5: Void a Pending Transaction

As an Organization user with Transaction delete permission, I want to abandon a Pending
Transaction without deleting its audit record.

- `DELETE /api/ledgers/:ledgerId/transactions/:transactionId` changes Pending to Voided.
- Voiding subtracts the Entries from Pending counters and leaves Posted counters unchanged.
- The Transaction and Entries remain queryable.
- Repeating the operation for an already Voided Transaction has no additional balance effect and
  returns `204 No Content`.
- Voiding a Posted Transaction returns `409`.

### US-6: Preserve correct current balances

As an Organization user, I want Account responses to report current Pending, Posted, and Available
balances after every Transaction lifecycle change.

- Pending Credits and Debits include Pending and Posted Transactions.
- Posted Credits and Debits include Posted Transactions only.
- Available Balance includes Posted increases and both Pending and Posted decreases.
- Negative balances remain valid and never block a Transaction.
- Repeated Entries for one Account are aggregated before one Account update.
- Each changed Account increments `lockVersion` once per mutation.
- Entries and Transaction status remain sufficient to rebuild all authoritative counters.

### US-7: Deduplicate creates across API instances

As an API client, I want a retried create request to resolve to one Transaction across all API
instances.

- Valkey stores one Organization-scoped mapping from idempotency key to Transaction ID for 24
  hours.
- Atomic `SET NX` elects one Transaction for a key.
- Reusing a key returns the first mapped Transaction and ignores the new request body.
- A Valkey cache miss consults PostgreSQL and repopulates the mapping.
- Concurrent requests with one key produce one Transaction and one balance effect.
- Create returns `503` when Valkey is unavailable. Other endpoints remain available.

### US-8: Complete the Effect migration without new frameworks

As an API maintainer, I want Transactions to use the existing managed runtime and conventions.

- Routes call the Transaction service through the shared server runtime.
- Domain rules remain pure, expected failures remain in the Effect error channel, and repositories
  own SQL and transaction boundaries.
- Effect's Clock supplies server time and Effect schedules own typed retries.
- The implementation reuses TypeBox, Drizzle, shared errors, IDs, direct handlers, the Account
  Currency model, and the existing runtime.
- The legacy Promise Transaction stack and temporary Account reader are removed.

## Constraints

- `CONTEXT.md` remains authoritative for Ledger terminology except where this approved migration
  explicitly removes Effective Time and defines Created, Updated, and Posted Time as the complete
  Transaction time model.
- The API uses Effect `4.0.0-beta.105`, as resolved in the lockfile.
- Fastify and TypeBox remain the HTTP and OpenAPI boundary.
- Drizzle remains the PostgreSQL adapter.
- One managed Effect runtime and one managed Valkey client exist per Fastify server.
- Every API instance connects to the shared Valkey deployment through `VALKEY_URL`.
- Authentication and permissions remain in Fastify. Every service operation receives the
  authenticated Organization ID explicitly.
- PostgreSQL transactions cover every financial state transition.
- Currency and Minor Unit Exponent come from immutable Account fields.
- Amounts and every stored balance counter remain within JavaScript's safe-integer range.
- Migration continuity and existing development data must be preserved.
- Implementation follows stub-driven TDD and does not modify unrelated resources.

## Context

### Current behavior

The current public routes expose the six paths retained by this design. They use a legacy Fastify
service plugin, `LedgerTransactionService`, `LedgerTransactionRepo`, and repository-owned entities.
Create requests currently include client-controlled Transaction status, Entry IDs, Currency,
Entry status, Created Time, and Updated Time. Responses advertise Posted Time, reversal fields, and
resulting balances that the entity does not produce consistently.

The current domain rejects repeated Accounts and balances one Currency only. The service bulk-loads
Accounts through a temporary reader and uses `radash` for retries. The repository reads Accounts
before opening its database transaction, applies each Entry independently, and writes Account
balances with optimistic version checks. This permits stale calculations and mishandles repeated
Entries for one Account.

`LedgerTransactionEntity.applyEntry` updates Posted and Available values for every Entry regardless
of Transaction status. Pending counters are not maintained. Posting applies the Entries again, and
deletion physically removes the Transaction after reversing balances. The database duplicates
Currency, status, and timestamps on Entries even though an Entry has no lifecycle independent of
its Transaction.

The Organization, Ledger, and Account migrations established the managed Effect runtime,
`DatabaseTag`, direct Fastify handlers, shared ID parsing, typed PostgreSQL error classification,
and Layer-based tests. The Account slice owns immutable Currency and Normal Balance. This migration
extends those patterns rather than creating another execution or testing abstraction.

### Research decisions

| Concern | Existing solution | Decision | Current requirement |
| --- | --- | --- | --- |
| Runtime | One managed Effect runtime with `DatabaseTag` | modify | Add Transaction and Valkey Layers |
| HTTP boundary | Direct Effect-backed Ledger and Account handlers | reuse | Keep route flow and permissions visible |
| Slice structure | Flat resource slices with a `domain/` boundary | reuse | Add `ledgers/transactions/` |
| IDs | Canonical TypeIDs and shared ID parsing | reuse | Generate server IDs and parse route IDs |
| Transaction state | String status with `archived` | modify | Exhaustive Pending, Posted, and Voided lifecycle |
| Entry state | Status duplicated on every Entry | delete | Entry lifecycle belongs to Transaction |
| Currency input | Client Entry Currency ignored in favor of Accounts | delete | Account Currency is authoritative |
| Balancing | One Currency and one Entry per Account | modify | Per-Currency balance with repeated Accounts |
| Balance storage | Ten Account projection fields | modify | Four authoritative counters with derived values |
| Mutation boundary | Account reads outside the SQL transaction | delete | Lock and revalidate inside one transaction |
| Locking | Optimistic Account updates in request order | modify | Deterministic Transaction-first and Account-ID order |
| Retries | Ad hoc `radash` retry | delete | Retry only typed conflicts with an Effect schedule |
| Idempotency | Global nullable database key with no public input | modify | Required header, Organization scope, and shared Valkey mapping |
| Effective Time | Persisted field with incomplete behavior | delete | Current balances and server lifecycle times only |
| Settlement caller | Direct legacy Transaction service dependency | modify | Temporary runtime bridge with a stable Settlement key |
| Tests | Separate legacy route, service, and repository suites | modify | Focused Layers, PostgreSQL, full-stack, and race coverage |

## Architecture

### Selected approach

Create one native Effect Transaction slice and retain materialized current Account counters.
Valkey coordinates create idempotency across API instances, while PostgreSQL remains the source of
truth for Transactions, Entries, and Account balances.

```text
Fastify Transaction routes
  -> managed Effect runtime
     -> TransactionService
        -> Valkey idempotency capability
        -> TransactionRepo
           -> PostgreSQL transaction
              -> lock Transaction
              -> lock Accounts by ascending ID
              -> write Transaction and Entries
              -> apply Account counter deltas

Legacy Settlement service
  -> narrow runtime bridge
     -> TransactionService create with Settlement-derived key
```

The slice lives under `apps/api/src/ledgers/transactions/` and contains the Transaction and Entry
domain, typed errors, TypeBox schemas, repository, service, routes, and one public entrypoint. The
entrypoint exports the public service contract and composed Layer. Persistence rows, concrete Live
implementations, codecs, and internal Valkey details remain private.

### Responsibilities

- Fastify routes own transport validation, JWT permissions, canonical path parsing, HTTP status
  codes, headers, and response serialization.
- `TransactionService` owns use-case orchestration, server IDs and time, idempotency coordination,
  Account-count limits, lifecycle requests, and typed retry policy.
- The Transaction domain owns the exhaustive lifecycle, Entry validation, per-Currency balancing,
  Account delta calculation, and immutability rules.
- `TransactionRepo` owns PostgreSQL queries, row decoding, deterministic locks, atomic mutation,
  database error translation, and current balance persistence.
- The Valkey capability owns key names, atomic claim and lookup behavior, TTL, connection
  lifecycle, and availability errors.

No domain, service, or repository module runs an Effect directly. Fastify is the only execution
boundary.

### Domain model

A Transaction contains its ID, Organization and Ledger ownership, lifecycle state, optional
description and string metadata, at least two Entries, optional Posted Time, Created Time, and
Updated Time.

The lifecycle is exhaustive:

```text
Pending -> Pending   replace
Pending -> Posted    post
Pending -> Voided    void
Posted  -> Posted    idempotent post
Voided  -> Voided    idempotent void
```

Every other transition fails with a typed lifecycle Conflict. Posted and Voided Transactions are
immutable. An Entry contains one server-generated ID, Account ID, direction, positive safe-integer
Amount, Account-derived Currency, and optional string metadata. Entry has no independent status or
Updated Time.

Repeated Account IDs are valid. Before persistence, the domain groups Entries by Account to
calculate one counter delta per Account. It separately groups Entries by exact Currency Code and
Minor Unit Exponent. Within each Currency group, total Debits must equal total Credits. There is no
valuation or conversion between groups.

### Current balance projection

The Account row stores four authoritative counters:

- Pending Credits
- Pending Debits
- Posted Credits
- Posted Debits

Pending counters include Entries from Pending and Posted Transactions. Posted counters include
Entries from Posted Transactions only. Account responses derive amounts and Available direction
totals from these counters.

| Account normal balance | Posted amount | Pending amount | Available amount |
| --- | --- | --- | --- |
| Debit | Posted Debits - Posted Credits | Pending Debits - Pending Credits | Posted Debits - Pending Credits |
| Credit | Posted Credits - Posted Debits | Pending Credits - Pending Debits | Posted Credits - Pending Debits |

For a debit-normal Account, Available Credits equal Pending Credits and Available Debits equal
Posted Debits. For a credit-normal Account, Available Credits equal Posted Credits and Available
Debits equal Pending Debits.

Lifecycle mutations apply these deltas:

| Operation | Pending counters | Posted counters |
| --- | --- | --- |
| Create Pending | Add new Entries | No change |
| Create Posted | Add new Entries | Add new Entries |
| Replace Pending | Subtract old Entries, add replacements | No change |
| Post Pending | No change | Add existing Entries |
| Void Pending | Subtract existing Entries | No change |
| Repeat Post or Void | No change | No change |

The repository validates every resulting counter as a safe integer and increments each changed
Account's `lockVersion` once.

### Idempotency flow

The idempotency key is scoped by Organization:

`exchequer:transactions:idempotency:<organizationId>:<key>`

Create first checks Valkey. A hit loads and returns the mapped Transaction. On a miss, the service
checks PostgreSQL for the Organization and key, repopulates Valkey when found, and returns the
persisted Transaction. Otherwise it attempts an atomic `SET NX` with a 24-hour TTL and coordinates
creation with the Organization-scoped database uniqueness constraint. A concurrent loser loads the
winner's Transaction. The mapping stores no request hash; key reuse always selects the first
Transaction and ignores a different body.

Valkey availability is mandatory only for create. A Valkey failure produces `503` before a new
Transaction is attempted. Read, update, post, and void operations do not depend on Valkey.

### Persistence and concurrency

Every mutation uses one PostgreSQL transaction. Existing Transaction mutations first select the
Transaction `FOR UPDATE`. The repository then builds the union of old and new Account IDs, sorts
the unique IDs ascending, and locks those Account rows in that order. Create has no Transaction row
to lock, so it claims the idempotency identity and then locks its Accounts in ascending order.

After acquiring locks, the repository revalidates Organization, Ledger, Account identity,
Currency, lifecycle, and safe-integer deltas. It writes the Transaction and complete Entry set,
applies aggregated Account deltas, and commits. Any failure rolls back the lifecycle and every
balance change.

Only classified PostgreSQL deadlocks, serialization failures, and Account version conflicts are
retryable. The service applies a bounded Effect schedule to those typed failures. Validation,
tenancy, lifecycle, idempotency, decoding, and unknown persistence failures are never retried.

## API design

The route paths and existing `ledger:transaction:*` permissions remain unchanged.

### List

```http
GET /api/ledgers/:ledgerId/transactions?offset=0&limit=20
```

`offset` is an integer from `0` through `10,000`. `limit` is an integer from `1` through `100`.
The response is a Transaction array ordered by `created DESC, id DESC`.

### Get

```http
GET /api/ledgers/:ledgerId/transactions/:transactionId
```

The response is one Transaction. The route returns `404` for missing, cross-Organization, or
cross-Ledger resources.

### Create

```ts
type TransactionCreateRequest = {
  status: "pending" | "posted";
  description?: string;
  metadata?: Record<string, string>;
  ledgerEntries: Array<{
    accountId: string;
    direction: "debit" | "credit";
    amount: number;
    metadata?: Record<string, string>;
  }>;
};
```

The request requires `Idempotency-Key`. Unknown fields are rejected or removed by the established
Fastify policy before the handler runs. Success returns `201`, `Location`, and the Transaction.

### Replace

```ts
type TransactionUpdateRequest = {
  description?: string;
  metadata?: Record<string, string>;
  ledgerEntries: Array<{
    accountId: string;
    direction: "debit" | "credit";
    amount: number;
    metadata?: Record<string, string>;
  }>;
};
```

PUT is a complete replacement of mutable Transaction data. The status, IDs, Currency, Posted Time,
Created Time, and Updated Time are server-owned. Success returns `200` and the Transaction.

### Post and void

Post has no request body and returns the Transaction with `200`. DELETE has no request body and
returns an empty `204`. Both operations are idempotent only when repeated against their own target
state.

### Response

```ts
type TransactionResponse = {
  id: string;
  ledgerId: string;
  description?: string;
  status: "pending" | "posted" | "voided";
  metadata?: Record<string, string>;
  ledgerEntries: Array<{
    id: string;
    accountId: string;
    direction: "debit" | "credit";
    amount: number;
    currencyCode: string;
    minorUnitExponent: number;
    metadata?: Record<string, string>;
  }>;
  postedAt?: string;
  created: string;
  updated: string;
};
```

The contract removes Effective Time, reversal fields, resulting-balance placeholders, and
client-controlled Entry IDs, Currency, status, and timestamps.

### Failure contract

| Failure | HTTP status |
| --- | ---: |
| Invalid ID, pagination, header, Amount, metadata, or request | `400` |
| Fewer than two Entries or unbalanced Currency group | `400` |
| Missing or cross-tenant Ledger, Transaction, or Account | `404` |
| Invalid lifecycle transition | `409` |
| Exhausted typed concurrency retry | `409` |
| Valkey unavailable during create | `503` |
| PostgreSQL unavailable | `503` |
| Invalid persisted row or unexpected failure | `500` |

Routes advertise only failures the operation can produce. Authentication and permission failures
remain `401` and `403`.

### Events

This migration publishes and consumes no events. Transactional outbox work belongs to later
resource migrations.

## Data model

### Transaction

`ledger_transactions` retains ID, Organization ID, Ledger ID, idempotency key, description,
status, metadata, Created Time, and Updated Time. It adds nullable `posted_at` and removes
`effective_at`. The status enum becomes `pending | posted | voided`.

The idempotency key remains nullable for migrated rows but is required by new public creates. Its
unique constraint is scoped by Organization rather than global.

### Entry

`ledger_transaction_entries` retains ID, Transaction ID, Account ID, Organization ID, direction,
Amount, metadata, and Created Time. It adds Ledger ID so composite foreign keys can enforce that
the Entry, parent Transaction, and Account share one Organization and Ledger.

The table removes duplicated Currency, Minor Unit Exponent, status, and Updated Time. Currency is
read through the immutable Account relationship when constructing a response. Amount has database
checks for positivity and JavaScript safe-integer bounds.

### Account projection

`ledger_accounts` retains Pending Credits, Pending Debits, Posted Credits, and Posted Debits as the
only authoritative balance counters. Pending Amount, Posted Amount, Available Amount, Available
Credits, and Available Debits are removed as stored columns and derived by the Account model.
Safe-integer checks cover the four counters, and each mutation increments `lock_version` once.

### Constraints and access patterns

- A composite Transaction foreign key enforces Organization and Ledger ownership.
- Composite Entry foreign keys enforce the same Organization and Ledger as both Transaction and
  Account.
- The Transaction idempotency constraint is unique on Organization ID and idempotency key, with
  null legacy keys allowed.
- List uses an index supporting Ledger scope and `created DESC, id DESC` ordering.
- Entry lookup uses Transaction ID. Mutation locking uses Account IDs in ascending order.

### Migration

One transactional Drizzle migration performs this sequence:

1. Add Posted Time, Entry Ledger ID, and the composite keys required for new foreign keys.
2. Backfill Entry Ledger ID from its parent Transaction.
3. Verify Organization, Ledger, Account, Currency, status, Amount, and Entry relationships.
4. Convert Archived Transactions to Voided and backfill Posted Time from Updated Time for existing
   Posted Transactions.
5. Rebuild the four Account counters from Entries joined to parent Transaction status.
6. Verify rebuilt counters against independently aggregated Entry data and safe-integer bounds.
7. Replace ownership and idempotency constraints and add required indexes.
8. Remove Effective Time and redundant Account projection and Entry columns.
9. Replace the old status enum after every row uses the new lifecycle values.

The migration preserves rows whose idempotency key is null. If any verification fails, PostgreSQL
rolls back the migration. Application and migration ship together in a maintenance window; this
design does not add dual writes or mixed-version compatibility.

## Test design

- Domain tests own the lifecycle matrix, Posted immutability, repeated Accounts, per-Currency
  balancing, Amount bounds, aggregated deltas, and debit-normal and credit-normal formulas.
- Service tests use Layers and own Ledger and Account lookup, the 200-Account limit, server IDs and
  time, idempotency orchestration, typed error propagation, and retry selection.
- PostgreSQL repository tests own all lifecycle writes, projection deltas, rollback, stable list
  ordering, tenant constraints, row decoding, and migration rebuild behavior.
- Deterministic race tests cover same-key create, post/post, post/void, update/post, and overlapping
  Transactions that submit Accounts in opposite orders.
- Valkey tests use two API instances to prove one key maps to one Transaction, cache misses and
  expiry repopulate, and store unavailability returns `503` only for create.
- Route tests cover all six success paths, permissions, request validation, the required header,
  response shape, status codes, Location, and operation-specific failures.
- Authenticated Fastify-to-PostgreSQL tests cover complete Pending and Posted journeys, tenant
  isolation, one balance effect per replay, and retained Voided records.
- Verification runs the focused API tests, `pnpm run check`, the full API suite, a clean migration,
  and `pnpm run ci`.

## Trade-offs

### Selected: native Effect slice with materialized current balances

This approach follows the existing Ledger and Account slices, fixes lifecycle and concurrency at
their owning boundaries, and keeps Account reads constant-time. It requires a coordinated schema
migration and careful delta tests, but current balances and deterministic mutations are explicit
requirements.

### Rejected: wrap the legacy Promise service in Effect

A boundary wrapper would reduce the initial file movement, but it would retain stale Account reads,
ad hoc retries, physical deletion, one-Currency balancing, and transport-shaped entities. It would
not satisfy the financial or architecture requirements.

### Rejected: calculate every balance from Entries at read time

Read-time aggregation would remove counter mutation logic and naturally support historical queries.
Historical and as-of queries are explicitly out of scope, and this option would make ordinary
Account reads depend on an ever-growing Entry scan. The four counters are rebuildable from Entries
and keep the current API inexpensive.

### Accepted limitation: Valkey is required for create

PostgreSQL still enforces Organization-scoped uniqueness, but the approved contract requires a
shared 24-hour Valkey mapping across instances. This introduces an operational dependency and makes
create unavailable during a Valkey outage. The other five endpoints remain independent of Valkey.

### Accepted limitation: key reuse ignores request differences

The idempotency mapping stores no request fingerprint. A client that reuses a key with a different
body receives the first Transaction. This keeps the contract simple but places key uniqueness on
the caller.

## Open questions

None.
