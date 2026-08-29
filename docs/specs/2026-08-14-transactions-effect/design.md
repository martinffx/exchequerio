# Transactions Effect migration

## Goal

Move Ledger Transactions onto the shared Effect runtime while preserving the six-route HTTP
surface, tenant isolation, balanced accounting, lifecycle behavior, and atomic Account projections.

The maintained Transaction contract lives in:

- [`apps/api/docs/spec/transactions/spec.md`](../../../apps/api/docs/spec/transactions/spec.md)
- [`apps/api/docs/spec/transactions/design.md`](../../../apps/api/docs/spec/transactions/design.md)

Those documents and the implementation are authoritative. This record captures the migration
choices that materially shaped the branch without duplicating the full resource specification.

## Selected architecture

Transactions use a resource slice under `apps/api/src/domains/ledgers/transactions`:

```text
Fastify routes
  -> shared managed Effect runtime
     -> TransactionService
        -> TransactionIdemService -> Valkey
        -> LedgerTransactionRepo -> PostgreSQL
           -> LedgerTransaction and LedgerTransactionEntry
```

Routes own transport validation and permissions. The service owns orchestration, server time,
idempotency, limits, and retries. The Transaction error module owns pure database error
translations, and the repository applies them at its SQL boundary. The repository also owns
transaction boundaries and optimistic version predicates. Domain objects own transformations and
invariants without performing I/O.

The migrated Transaction slice coexists with legacy Settlement code until Settlement receives its
own migration.

## Transaction behavior

- Status is `pending`, `posted`, or `voided`.
- Pending Transactions may be replaced, posted, or voided.
- Posted Transactions are immutable.
- Repeated post of Posted and repeated void of Voided are idempotent.
- Every Transaction contains at least two Entries and balances by Currency Code.
- Repeated Account IDs are valid.
- Amounts are positive JavaScript safe integers.
- Negative Account balances remain valid.

Create and update requests supply Currency Code for each Entry. The repository verifies it against
the Account. Minor Unit Exponent is intentionally absent from this interim model and returns when
Assets become the canonical owner.

## Persistence and concurrency

Transactions and Entries repeat Organization and Ledger ownership. Composite foreign keys enforce
that Entries, Accounts, and Transactions share both boundaries. Entry rows retain Currency and
status. Account rows retain the existing Pending, Posted, and Available projections and counters.

Mutations read current snapshots, calculate the domain result, then write the Transaction, Entries,
and Account projections atomically. Transaction and Account updates use optimistic lock-version
predicates. The service retries only typed version conflicts, PostgreSQL deadlocks, and serialization
failures for up to two seconds.

## Create idempotency

Valkey is the sole idempotency store. Each required `Idempotency-Key` locks creation under its
Organization:

```text
exchequer:transactions:idempotency:<organizationId>:<idempotencyKey>
```

Atomic `SET NX` stores a pending marker and elects the winner. The winner commits PostgreSQL, then
replaces the marker with the Transaction ID. A losing caller checks Valkey once and retries at most
three times within 500 milliseconds. It returns the committed Transaction when the ID appears, or a
retryable `409` with `Retry-After: 1` while creation remains pending. A failed winner uses
compare-and-delete cleanup only when failure is known to precede commit.

Claims expire after 15 minutes. PostgreSQL stores no idempotency key, does not recover expired
claims, and remains independent of Valkey for every non-create operation.

## Schema migration

This is a clean schema cut, not a legacy-data migration. The SQL migration aborts before any schema
change if `ledger_transactions` or `ledger_transaction_entries` contains rows. It contains no row
backfill or legacy compatibility path.

The empty-schema migration adds Posted Time, lock versions, Entry Ledger ownership, composite
foreign keys, and list indexes. It removes Effective Time, database idempotency keys, and Minor Unit
Exponent columns. The future Asset migration restores an immutable exponent source.

## Verification

- Domain and service tests cover balancing, lifecycle, limits, retries, idempotency winner and loser
  behavior, and typed failures.
- Repository tests use PostgreSQL for tenant scoping, atomic writes, projection changes, and races.
- Migration tests prove an empty schema succeeds and any existing Transaction data aborts with a
  complete rollback.
- Idempotency service tests use Valkey for atomic claims, 15-minute expiry, compare-and-delete, and
  malformed stored values.
- Route and authenticated integration tests cover permissions, schemas, problem responses, and the
  complete Pending and Posted journeys.

## Deferred work

- Assets will own Minor Unit Exponent.
- Settlements will replace their legacy Transaction bridge during the next resource migration.
- Cursor pagination, historical queries, events, and transactional outbox behavior remain outside
  this migration.
