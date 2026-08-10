# Ledger Accounts Effect migration

## Summary

Migrate the five Ledger Account endpoints to Effect and move Currency ownership from Ledger to
Account. The change completes the Step 03 expand, backfill, switch, and contract migration from
`EFFECT_MIGRATION.md`.

The implementation reuses the managed server runtime, `DatabaseTag`, direct Fastify handlers,
shared errors, `parseId`, TypeBox, Drizzle, and the existing PostgreSQL test Layer. It adds no
generic Effect executor, HTTP adapter, authorization model, test harness, or lifecycle machinery.

## Scope

### In scope

- Migrate list, get, create, update, and delete Account endpoints to Effect.
- Add Account-owned `currencyCode` and `minorUnitExponent` fields.
- Introduce shared Currency, Minor Unit, Normal Balance, and Account ID value types.
- Require Account currency and normal balance at creation.
- Split Account create and update persistence and repair first-update optimistic locking.
- Map duplicate Account names to a typed Conflict.
- Enforce Account, Ledger, and Organization tenancy in application queries and PostgreSQL.
- Derive Transaction and Settlement currency from Accounts.
- Remove legacy Ledger Currency storage and compatibility code.
- Update focused tests, OpenAPI schemas, the ERD, and superseded Currency documentation.

### Out of scope

- Transaction lifecycle, multi-Currency balancing, idempotency, or locking redesign.
- Settlement lifecycle migration.
- Asset resources or replacement of the interim Currency pair with Asset identity.
- Category, Statement, or Balance Monitor migration.
- Zero-downtime mixed-version deployment.
- New shared runtime, HTTP, testing, retry, authorization, or observability infrastructure.

## Research decisions

| Concern | Existing solution | Decision | Current requirement |
| --- | --- | --- | --- |
| Effect runtime | One managed runtime with `DatabaseTag` | reuse | Run Account effects without per-request runtimes |
| HTTP boundary | Direct Ledger and Organization handlers | reuse | Keep route control flow visible |
| Slice structure | Flat Effect slices with a domain ownership boundary | reuse | Add Accounts under `ledgers/accounts/` |
| Account identity | Canonical `lat` TypeID | reuse | Avoid a second Account ID stack |
| Currency ownership | Compatibility fields on Ledger | delete | Account owns its immutable Currency pair |
| Account persistence | One legacy upsert | delete | Create and update have different behavior |
| Tenancy | Independent Organization and Ledger foreign keys | modify | Enforce the Account-Ledger Organization pair |
| Transactions | Ledger supplies Entry Currency | modify | Derive one pair from referenced Accounts |
| Settlements | Routes read Ledger Currency | modify | Derive the pair and normal balance from Accounts |
| Tests | Focused route, service, and PostgreSQL tests | reuse | Test one contract at each active boundary |

## Architecture

The Account slice lives at `apps/api/src/ledgers/accounts/` and contains an Account domain,
typed errors, TypeBox schemas, an Effect repository, an Effect service, direct Fastify routes, and
one public entrypoint.

```text
Account routes
  -> existing managed runtime
  -> AccountService
     -> LedgerService for parent existence
     -> AccountRepo
        -> PostgreSQL

Legacy TransactionService
  -> temporary legacy Account reader
  -> existing TransactionRepo

Settlement routes
  -> AccountService through the existing runtime
  -> existing SettlementService
```

`AccountService` owns parent checks, ID generation, immutable-field preservation, and update
version handoff. The Account model owns request construction and persisted-row encoding and
decoding. `AccountRepo` owns tenant-scoped SQL, optimistic writes, and database error
classification. The routes own transport validation, authentication, permissions, HTTP status
codes, and response serialization.

The existing server runtime gains the Account Layer. Account routes call it directly. No Promise
to Effect bridge is introduced.

Transactions keep one temporary legacy Account reader until Step 04. The reader gains Account
Currency fields and remains private to Transaction posting. Settlements use the Effect Account
service at their HTTP boundary. Once no production code reads Ledger Currency, the legacy Ledger
entity, repository, service, registrations, and their obsolete tests are removed.

## Domain model

- `LedgerAccountID` reuses the canonical `lat` TypeID.
- `CurrencyCode` is a nonblank, case-preserving opaque string. It may contain an ISO code, ISIN,
  ticker, or Organization-defined value. The API does not normalize it.
- `MinorUnitExponent` is a nonnegative safe integer.
- `Currency` is the exact pair of Currency Code and Minor Unit Exponent.
- `MinorUnits` is a safe integer. Negative values are valid.
- `NormalBalance` is `debit | credit`.
- Currency and Normal Balance are immutable after Account creation.

Shared ledger-domain values live under `apps/api/src/ledgers/domain/` and are exported from the
Ledger public entrypoint. The Account entrypoint re-exports the canonical Account ID type rather
than defining another brand.

An Account contains its identity and ownership, mutable descriptive fields, immutable Currency
and Normal Balance, three balance views, metadata, lock version, and timestamps. Domain and row
decoding reject invalid Currency, unsafe Minor Units, invalid IDs, invalid metadata, and invalid
timestamps instead of silently discarding data.

The model exposes create-only `fromRequest`, plus `fromRow` and `toRow`. It may use Effect for lazy
typed decoding and type-only request or Drizzle row contracts, but it performs no I/O. The
repository remains responsible for SQL, transactions, and database error translation.

## API contract

The five paths and existing `ledger:account:*` permissions remain unchanged.

### Create request

```ts
type AccountCreateRequest = {
  name: string
  description?: string
  normalBalance: "debit" | "credit"
  currencyCode: string
  minorUnitExponent: number
  metadata?: Record<string, string>
}
```

Create has no Currency or Normal Balance defaults. It returns `201 Created`, the Account
representation, and `Location: /api/ledgers/{ledgerId}/accounts/{accountId}`.

### Update request

```ts
type AccountUpdateRequest = {
  name: string
  description?: string
  metadata?: Record<string, string>
}
```

Omitting an optional field clears it, matching the Ledger contract. Fastify removes undeclared
fields, including attempts to update Currency or Normal Balance. Clients do not submit
`lockVersion`.

### Response

```ts
type AccountResponse = {
  id: string
  ledgerId: string
  name: string
  description?: string
  normalBalance: "debit" | "credit"
  currencyCode: string
  minorUnitExponent: number
  balances: Array<{
    balanceType: "pending" | "posted" | "availableBalance"
    credits: number
    debits: number
    amount: number
  }>
  metadata?: Record<string, string>
  lockVersion: number
  created: string
  updated: string
}
```

Currency appears once at Account level. Balance values are JSON numbers expressed in Minor Units.
List defaults to `offset=0` and `limit=20`, caps the limit at `100`, caps offset at `10,000`, and
orders by `created DESC, id ASC`. Get and update return `200`. Delete returns an empty `204`.

## Persistence and concurrency

The Effect repository exposes separate list, get, create, update, and delete operations.

- Create uses `INSERT ... RETURNING`, writes all immutable fields, and starts at `lockVersion: 1`.
- Update filters by Organization, Ledger, Account, and expected lock version. It increments the
  version and never writes Currency or Normal Balance.
- The service reads the current Account before update and passes its version to the repository.
  Two overlapping updates from one version produce one success and one Conflict.
- Delete uses `DELETE ... RETURNING`. PostgreSQL dependencies prevent deletion of a used Account.
- Duplicate-name mapping inspects the named `unique_account_name_per_ledger` constraint locally.
  Generated-ID collisions remain internal persistence failures.

## Database migration

One transactional Drizzle migration performs the following sequence with a short local lock
timeout:

1. Add nullable Account `currency_code` and `minor_unit_exponent` columns.
2. Backfill them from each Account's Ledger.
3. Abort if any Account has missing or blank Currency, a negative exponent, a cross-Organization
   Ledger relationship, or a balance outside JavaScript's safe-integer range.
4. Verify existing Transaction Entry and Settlement Currency pairs match their referenced
   Accounts. Abort on a mismatch.
5. Make the Account Currency columns non-null and add database checks.
6. Add a unique Ledger key on `(organization_id, id)`.
7. Replace the Account ledger-only foreign key with a composite foreign key from
   `(organization_id, ledger_id)` to the Ledger key. Retain the direct Organization foreign key.
8. Drop `ledgers.currency` and `ledgers.currency_exponent`.

The Drizzle schema reflects only the contracted model. New Account Currency columns have no
defaults. The migration and application switch ship together in a maintenance window. If a check
or lock timeout fails, PostgreSQL rolls back the migration. After new multi-Currency Accounts are
created, rollback requires restoring the old database backup with the old application.

## Direct consumer behavior

`LedgerTransactionService` replaces its Ledger dependency with the temporary Account reader. It
loads every referenced Account through Organization and Ledger scoped queries, requires one exact
Currency pair, and builds every Entry from that pair. Existing Transaction request Currency fields
remain accepted but ignored until Step 04. `LedgerTransactionRepo` also scopes its Account query
by Organization and Ledger before updating balances.

Settlement create and update load both Accounts through the Effect service, require matching
Currency pairs, and store the settled Account's Currency and Normal Balance. Settlement listing
uses the Effect Ledger service for its parent check. Settlement transition uses its route Ledger ID
instead of reading a legacy Ledger. Existing Settlement contracts and lifecycle remain unchanged.

## Failure contract

| Failure | HTTP status |
| --- | ---: |
| Invalid ID, Currency, exponent, or request | `400` |
| Missing or cross-tenant Ledger or Account | `404` |
| Duplicate Account name | `409` |
| Concurrent Account update | `409` |
| Account has dependents | `409` |
| Transaction or Settlement Currency mismatch | `409` |
| Database unavailable | `503` |
| Invalid persisted row or unexpected database failure | `500` |

Routes advertise only errors they can produce. The Account routes remove the unused `429`
response.

## Test design

- Domain tests cover request construction, row-codec round trips, decoding failures, Currency
  validation and equality, exponent and Minor Unit validation, negative balances, Normal Balance
  arithmetic, and immutable fields.
- Route tests mock the Effect service and own permissions, validation, pagination, canonical IDs,
  public success contracts, response shape, and typed error mapping.
- Service tests mock repositories and the Ledger service and own parent checks, initial state,
  immutable fields, version handoff, and not-found propagation.
- PostgreSQL repository tests reuse the existing database Layer and own ordering, tenant scoping,
  create versus update, duplicate-name mapping, first and concurrent updates, row decoding, and
  delete dependencies.
- Focused legacy tests prove Transactions and Settlements derive Currency from Accounts and reject
  mismatched pairs.

There is no HTTP to PostgreSQL harness and no new test infrastructure.

## Documentation and verification

Update the ERD so Account owns Currency and Ledger does not. Add focused supersession notices to
older repository and Transaction documents that still claim Ledger-owned Currency. Leave
`CONTEXT.md` unchanged because its glossary already states the intended model.

Run the API tests, repository check, build, and a clean PostgreSQL migration. Review the full diff
for unrelated changes before handoff.

## Open questions

None.
