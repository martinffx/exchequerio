# Ledger Transactions specification

Ledger Transactions record balanced accounting events within one Organization-owned Ledger. A
Transaction contains at least two Entries and changes every affected Account atomically.

## Resource contract

All paths are relative to `/api/ledgers/:ledgerId/transactions`.

| Method   | Path                   | Result                                                                  |
| -------- | ---------------------- | ----------------------------------------------------------------------- |
| `GET`    | `/`                    | Lists Transaction summaries in `created DESC, id DESC` order.           |
| `GET`    | `/:transactionId`      | Returns one Transaction and its Entries.                                |
| `POST`   | `/`                    | Creates a Pending or Posted Transaction. Requires `Idempotency-Key`.    |
| `PUT`    | `/:transactionId`      | Updates a Pending Transaction's description, metadata, and Entries.     |
| `POST`   | `/:transactionId/post` | Posts a Pending Transaction. Repeating the request is a no-op.          |
| `DELETE` | `/:transactionId`      | Voids a Pending Transaction and returns `204`. Repeating it is a no-op. |

The server owns Transaction IDs, Entry IDs, Created Time, Updated Time, and Posted Time. Create and
update requests contain Account IDs, directions, Amounts, Currency Codes, and optional string
metadata. The Account remains authoritative: a supplied Currency Code must match its Account.
Item and mutation responses derive each Entry's Currency Code and Minor Unit Exponent from its
Account. List responses omit Entries.

`GET /` accepts `offset` from 0 to 10,000 and `limit` from 1 to 100. Defaults are 0 and 20.

## Validation

- Create accepts status `pending` or `posted`; clients cannot create a Voided Transaction.
- Every Transaction has at least two Entries and at most 200 distinct Accounts.
- Every Account belongs to the path Ledger and authenticated Organization.
- Every Amount is a positive integer Minor Unit no greater than `Number.MAX_SAFE_INTEGER`.
- Debit and Credit totals match exactly for each Currency Code and Minor Unit Exponent pair.
- Transaction and Entry metadata map strings to strings.
- A Transaction may contain several Entries for the same Account. Balance effects aggregate by
  Account before the write.

## Lifecycle

```text
Pending --post--> Posted
Pending --void--> Voided
```

Only Pending Transactions can be updated. Posted Transactions are immutable and cannot be Voided.
Voiding retains the Transaction and Entries for reads; no Transaction endpoint physically deletes
accounting data.

## Balance effects

Each write commits the Transaction, Entries, and all Account counter changes in one PostgreSQL
transaction.

- Pending create adds Entries to Pending Credits or Pending Debits.
- Posted create adds Entries to both Pending and Posted counters.
- Pending update removes the old Pending effects and adds the updated effects.
- Posting adds the existing Entries to Posted counters; Pending counters already include them.
- Voiding removes the existing Entries from Pending counters.

Accounts store only Pending Credits, Pending Debits, Posted Credits, and Posted Debits. They derive:

- Pending Balance from Pending counters, which include Pending and Posted Transactions.
- Posted Balance from Posted counters only.
- Available Balance from Posted increases and Pending-plus-Posted decreases.

Negative balances are valid.

## Create idempotency

`Idempotency-Key` is required and scoped by Organization. The create flow is:

1. Generate a candidate Transaction ID and atomically claim the Organization-scoped Valkey key for
   five minutes.
2. If the claim already exists, wait briefly for the winner's commit and load its Transaction ID.
3. If this request wins, validate the request and distinct-Account cap.
4. In PostgreSQL, read the Accounts and their lock versions, derive their Currency, construct and
   validate the Transaction domain entity, and save the Transaction, Entries, and Account effects
   atomically using optimistic concurrency control.
5. If the save fails, compare and delete the Valkey key only when it still contains that candidate
   ID.

A caller that loses the claim returns the winning Transaction. Valkey is the sole idempotency store;
the key is never persisted in PostgreSQL. A process crash may leave a stale claim until its
five-minute expiry.

## HTTP behavior

- `201 Created` creates or replays a Transaction and includes its canonical `Location`.
- `400 Bad Request` reports malformed IDs, invalid input, unbalanced Entries, or unsafe Amounts.
- `404 Not Found` hides missing and cross-tenant Ledgers, Transactions, and Accounts behind the same
  resource response.
- `409 Conflict` reports invalid lifecycle changes or exhausted concurrency retries.
- `503 Service Unavailable` reports PostgreSQL or Valkey availability failures.

Read operations require `ledger:transaction:read`. Create, update, and post require
`ledger:transaction:write`; void requires `ledger:transaction:delete`.
