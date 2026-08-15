# Ledger Transactions technical design

## Boundaries

The Transaction slice follows Routes → Service → Repository → PostgreSQL.

- `TransactionRoutes` owns Fastify validation, permissions, status codes, and response mapping.
- `TransactionService` owns IDs, UTC time, idempotency orchestration, request limits, and retry
  selection.
- `TransactionRepo` owns tenant-scoped SQL, transaction boundaries, row locks, Account-derived
  Currency, domain construction after locks, Account counter updates, and PostgreSQL error
  translation.
- `Transaction` and `Entry` own lifecycle, balancing, metadata, Amount, and counter-delta rules. They
  use Effect values for typed failures and perform no I/O.
- `TransactionIdempotencyRepo` owns the Valkey key and managed ioredis client.

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

| Counter | Includes |
| --- | --- |
| Pending Credits | Credit Entries on Pending and Posted Transactions |
| Pending Debits | Debit Entries on Pending and Posted Transactions |
| Posted Credits | Credit Entries on Posted Transactions |
| Posted Debits | Debit Entries on Posted Transactions |

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

Create, replace, post, and void run in one PostgreSQL transaction. Each mutation:

1. Loads and validates the tenant-scoped Transaction and Accounts.
2. Locks affected Accounts in ascending ID order.
3. Builds the domain mutation and validates all resulting safe-integer counters.
4. Writes the Transaction and Entries.
5. Applies one aggregate delta per Account with its lock version predicate.
6. Commits every change or rolls back every change.

Replacement also locks the Transaction, reads its existing Entries, and considers the union of old
and new Accounts. Transitions lock the Transaction before deriving their effects. Repeated post of a
Posted Transaction and repeated void of a Voided Transaction return the current resource without
counter changes.

The service retries Account version conflicts, PostgreSQL deadlocks (`40P01`), and serialization
failures (`40001`) twice after the first attempt. It exposes an exhausted race as a typed conflict.

## Create idempotency

Valkey provides the fast, shared claim; PostgreSQL provides durable uniqueness. The key is:

```text
exchequer:transactions:idempotency:<organizationId>:<idempotencyKey>
```

Create reads Valkey first. On a miss, the service validates the request and distinct-Account cap,
then creates a candidate identity and currency-free repository input with server-owned IDs and UTC
times. One Lua command stores the candidate Transaction ID with `SET NX` and a 24-hour expiry. After
the claim, the winning repository call locks the Accounts, derives their Currency, and constructs and
validates the Transaction domain entity inside the PostgreSQL transaction. A loser reads the stored
ID, waits briefly for the winner's commit, and returns the canonical row.

If PostgreSQL rejects the winner's save, cleanup uses compare-and-delete so it cannot remove another
caller's claim. A PostgreSQL uniqueness race on `(organization_id, idempotency_key)` loads the exact
canonical row and repopulates Valkey. Normal cache misses do not perform a PostgreSQL lookup before
the claim.

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
- Service tests inject mock Transaction and idempotency repositories and a deterministic clock and
  ID source.
- Repository and migration tests use real PostgreSQL.
- Idempotency and cross-instance tests use real Valkey.
- Authenticated journeys use Fastify and PostgreSQL to prove assembled wiring without repeating each
  seam's branch matrix.
