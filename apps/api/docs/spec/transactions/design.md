# Ledger Transactions technical design

## Boundaries

The Transaction slice follows Routes → Service → Repository → PostgreSQL.

- `TransactionRoutes` owns Fastify validation, permissions, status codes, and response mapping.
- `TransactionService` owns UTC time, idempotency orchestration, request limits, and retry selection.
- `TransactionRepo` owns tenant-scoped SQL, transaction boundaries, Account-derived Currency,
  optimistic concurrency, Account counter updates, and PostgreSQL error
  translation.
- `Transaction` and `Entry` own lifecycle, balancing, metadata, Amount, and counter-delta rules. They
  use Effect values for typed failures and perform no I/O.
- `TransactionIdemService` owns the Valkey claim and release operations.

Fastify composes these services once into its managed Effect runtime. Routes call the Effect service
directly; no legacy Promise Transaction service or repository remains.

## Domain model

A Transaction contains:

- a server-owned Transaction ID;
- its Organization and Ledger IDs;
- status `pending`, `posted`, or `voided`;
- optional description and string metadata;
- at least two Entries;
- optional Posted Time, present exactly when status is `posted`;
- server-owned Created and Updated Times as Luxon `DateTime` values.

An Entry contains a server-owned Entry ID, Account ID, Debit or Credit direction, positive
safe-integer Amount, Account-derived Currency, and optional string metadata. It has no independent
lifecycle or update timestamp.

The domain validates exact Debit and Credit equality for each `(Currency Code, Minor Unit Exponent)`
pair. Repeated Account IDs are valid. Counter deltas group every Entry for an Account before
persistence.

## Persistence model

PostgreSQL stores Organization and Ledger ownership on Transactions and repeats both keys on
Entries. Composite foreign keys prevent cross-Organization and cross-Ledger references. Account
Currency remains the authority; Entry rows store neither Currency nor lifecycle state.

Account rows store four signed, safe-integer counters:

| Counter         | Includes                                          |
| --------------- | ------------------------------------------------- |
| Pending Credits | Credit Entries on Pending and Posted Transactions |
| Pending Debits  | Debit Entries on Pending and Posted Transactions  |
| Posted Credits  | Credit Entries on Posted Transactions             |
| Posted Debits   | Debit Entries on Posted Transactions              |

For a debit-normal Account:

```text
pending   = pendingDebits - pendingCredits
posted    = postedDebits - postedCredits
available = postedDebits - pendingCredits
```

For a credit-normal Account:

```text
pending   = pendingCredits - pendingDebits
posted    = postedCredits - postedDebits
available = postedCredits - pendingDebits
```

Derived balance columns do not exist. Negative results remain valid.

## Atomic writes and concurrency

Create, update, post, and void run in one PostgreSQL transaction. Each mutation:

1. Loads and validates the tenant-scoped Transaction and Accounts.
2. Reads affected Accounts and their lock versions.
3. Builds the domain mutation and validates all resulting safe-integer counters.
4. Writes the Transaction and Entries.
5. Applies one aggregate delta per Account with its lock version predicate.
6. Commits every change or rolls back every change.

Update reads the Transaction and existing Entries, then considers the union of old and new Accounts.
Update, post, and void conditionally update the Transaction using its observed lock version before
applying Account deltas. An Account conflict rolls back the whole PostgreSQL transaction, including
the Transaction update. Repeated post of a Posted Transaction and repeated void of a Voided
Transaction return the current resource without counter changes.

The service retries Account and Transaction version conflicts, PostgreSQL deadlocks (`40P01`), and
serialization failures (`40001`) with 50-millisecond exponential jitter for up to two seconds. It
exposes an exhausted race as a typed conflict.

## Create idempotency

Valkey is the sole idempotency store. The key is:

```text
exchequer:transactions:idempotency:<organizationId>:<idempotencyKey>
```

Create atomically claims a generated Transaction ID in Valkey before any repository query. The claim
returns a `Result`: success contains the newly claimed ID and failure contains the existing ID. The
winning repository call creates the Transaction with that exact ID. A loser waits briefly for the
winner's commit and loads the Transaction by ID.

If PostgreSQL rejects the winner's save, cleanup uses compare-and-delete so it cannot remove another
caller's claim. Claims expire after five minutes; a process crash can leave a stale claim until then.
Idempotency keys are never sent to PostgreSQL.

Valkey command and connection failures map to a typed availability error. The client connects lazily,
so Valkey readiness does not block server startup or unrelated endpoints. The runtime closes its one
owned client; tests may inject an externally owned client.

## Reads and transport

List and get queries scope every row by the authenticated Organization and path Ledger. List order is
`created DESC, id DESC`, backed by the matching Ledger index. Repository reads join Accounts to
derive Entry Currency and decode persisted timestamps into Luxon `DateTime` values.

The six routes are specified in [`spec.md`](./spec.md). TypeBox rejects client-owned accounting
fields. Responses serialize IDs and UTC timestamps, omit absent optional values, and return the
derived Currency pair for every Entry.

## Error model

The slice distinguishes validation, absence, lifecycle conflict, concurrency conflict, repository
availability, idempotency availability, persistence decoding, and unexpected persistence failures.
Repository code classifies PostgreSQL errors once; shared HTTP error handling maps typed failures to
the public problem response.

## Test seams

- Route tests inject Fastify requests with a mock Transaction service Layer.
- Service tests inject mock Transaction repositories and idempotency services.
- Repository and migration tests use real PostgreSQL.
- Idempotency and cross-instance tests use real Valkey.
- Authenticated journeys use Fastify and PostgreSQL to prove assembled wiring without repeating each
  seam's branch matrix.
