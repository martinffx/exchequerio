# Ledger Transactions technical design

## Boundaries

The Transaction slice follows Routes → Service → Repository → PostgreSQL.

- `TransactionRoutes` owns Fastify validation, permissions, status codes, and response mapping.
- `TransactionService` owns idempotency orchestration, server time, request limits, and retry selection.
- `LedgerTransactionRepo` owns tenant-scoped SQL, PostgreSQL transactions, optimistic writes, Account
  counter updates, and database error translation.
- `LedgerTransaction` and `LedgerTransactionEntry` own lifecycle transitions, balancing, metadata,
  Amount validation, and counter effects without performing I/O.
- `TransactionIdemService` owns Valkey claim and compare-and-delete release operations.

Fastify composes these services once into its managed Effect runtime. Routes run Transaction effects
through that runtime. The legacy Promise Transaction service and repository no longer exist.

## Domain and transport

A Transaction contains a server-owned ID, Organization and Ledger IDs, status, optional description
and string metadata, at least two Entries, optional Posted Time, and server-owned Created and Updated
Times. Status is `pending`, `posted`, or `voided`.

An Entry contains a server-owned ID, Account ID, Debit or Credit direction, positive safe-integer
Amount, Currency Code, Transaction status, and optional string metadata. Create and update requests
supply Currency Code. Repository validation rejects an Entry whose Currency Code differs from its
Account.

The domain balances Debit and Credit Amounts by Currency Code. Repeated Account IDs are valid. Minor
Unit Exponent is intentionally absent until the Asset model provides its canonical immutable owner.

## Persistence and balances

PostgreSQL stores Organization and Ledger ownership on Transactions and Entries. Composite foreign
keys prevent cross-Organization and cross-Ledger Transaction, Entry, and Account references. Entry
rows retain Currency Code and Transaction status.

Accounts retain Pending, Posted, and Available Amounts plus their corresponding Credit and Debit
counters. The Account entity applies each Entry to an immutable copy; the repository accumulates all
effects for an Account and writes that Account once per mutation.

- Pending includes Pending and Posted Transactions.
- Posted includes Posted Transactions only.
- Available includes Posted increases and both Pending and Posted decreases.
- Voided Transactions have no balance effect.
- Negative balances remain valid.

PostgreSQL constraints enforce safe-integer Account counters and Entry Amounts.

## Atomic writes and concurrency

Create, update, post, and void load their current Transaction and Account snapshots before opening
the write transaction. The repository then writes the Transaction, Entries, and Account projections
in one PostgreSQL transaction. Transaction and Account updates include their observed lock versions;
any conflict rolls the entire write back.

Account updates run sequentially in Account ID order. Update considers the union of old and new
Account IDs. Repeated post of a Posted Transaction and repeated void of a Voided Transaction return
the current resource without changing counters.

The service retries Account and Transaction version conflicts, PostgreSQL deadlocks (`40P01`), and
serialization failures (`40001`) with exponential jitter for up to two seconds.

## Create idempotency

Valkey is the sole idempotency store. The Organization-scoped key is:

```text
exchequer:transactions:idempotency:<organizationId>:<idempotencyKey>
```

Create atomically claims a generated Transaction ID before querying PostgreSQL. The winner creates
the Transaction with that ID. A loser polls for the winner's Transaction for up to two seconds. It
returns the winner when found and a retryable `503 Service Unavailable` while the claim remains
unresolved.

Failed winners release only claims that still contain their Transaction ID. Claims expire after 15
minutes. PostgreSQL stores no idempotency key and performs no idempotency recovery after expiry.

Valkey failures return a typed `503`. The client connects lazily, so Valkey readiness affects create
only. The managed runtime owns and closes its client.

## Migration

The Transaction Effect migration is a clean schema cut. It aborts before changing the schema when
`ledger_transactions` or `ledger_transaction_entries` contains rows. It performs no legacy
Transaction conversion or balance rebuild.

On an empty Transaction schema, the migration:

- replaces `archived` with `voided` in the status enum;
- adds Transaction Posted Time and lock version;
- adds Entry Ledger ID and composite ownership constraints;
- removes Transaction Effective Time and PostgreSQL idempotency keys;
- removes Minor Unit Exponent from Accounts, Entries, and Settlements;
- retains Entry Currency and status plus the existing Account projection columns.

Minor Unit Exponent returns with the Asset model rather than remaining on the interim Account model.

## Reads and errors

List and get scope Transactions by authenticated Organization and path Ledger. List uses offset and
limit pagination ordered by Created Time and Transaction ID descending. Complete reads load Entries
through the Transaction relation and decode their persisted Currency, status, metadata, and times.

The slice distinguishes validation, absence, lifecycle conflict, concurrency conflict, repository
availability, idempotency availability, unresolved creation, persistence decoding, and unexpected
persistence failures. Shared HTTP handling maps them to problem responses.

## Test seams

- Route tests use a mock Transaction service Layer.
- Service tests use mock Transaction repository and idempotency Layers.
- Repository and migration tests use PostgreSQL.
- Idempotency service tests use Valkey.
- Authenticated integration tests use Fastify and PostgreSQL with an in-memory idempotency Layer.
