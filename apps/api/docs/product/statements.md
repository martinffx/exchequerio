# Ledger Account Statements

Create a Statement to preserve an Account's Entries and balances for an Effective Time period.
The accounting snapshot remains unchanged when Pending Transactions change, become Posted, or are
Voided, and when backdated Entries arrive. You can later replace the Statement's description and
metadata.

## Period and balances

A period includes `startDatetime` and excludes `endDatetime`. Both must be valid timestamps, and the
start must precede the end. Periods may overlap or lie in the future. Generation is synchronous and
captures the Ledger's current knowledge; it does not reconstruct the Pending state that existed at
some earlier time.

The snapshot includes Entries from Transactions that are Posted or Pending at generation. Voided
Transactions contribute neither Entries nor balances. Opening balances aggregate eligible Entries
with Effective Time before the start; closing balances aggregate those before the end. Both use the
same captured state, independently of previous Statements.

`startingBalances` and `endingBalances` each contain three objects with `balanceType`, `credits`,
`debits`, and `amount`:

| `balanceType`      | Included Entries                                        |
| ------------------ | ------------------------------------------------------- |
| `posted`           | Posted Transactions only.                               |
| `pending`          | Posted and Pending Transactions.                        |
| `availableBalance` | Posted increases and both Posted and Pending decreases. |

Amounts follow the captured Account's `normalBalance`: Debits minus Credits for `debit`, Credits
minus Debits for `credit`. Amounts and counters are signed 64-bit integer Minor Units encoded as decimal
strings. Responses and copied Entries carry the Account's Asset as `assetId`, `assetCode`, and
`minorUnitExponent`. Generation fails with 409 if a balance leaves the signed 64-bit range.

An inactive period still produces a Statement with an empty Entry list and equal opening and
closing balances. An unused Account has zero balances. Generating the same period again with a
fresh idempotency key creates an independent Statement and may capture different data.

## Operations

All paths below extend:

```text
/api/ledgers/:ledgerId/accounts/:accountId/statements
```

The authenticated Organization and path determine ownership. Requests do not accept ownership IDs
in their bodies. Every operation checks Organization, Ledger, and Account scope. Reads require
`ledger:account:statement:read`; creation and annotation updates require
`ledger:account:statement:write`.

| Method and path             | Success response                        |
| --------------------------- | --------------------------------------- |
| `POST /`                    | `200`, the created Statement summary.   |
| `GET /`                     | `200`, an array of Statement summaries. |
| `GET /:statementId`         | `200`, one Statement summary.           |
| `GET /:statementId/entries` | `200`, an array of copied Entries.      |
| `PUT /:statementId`         | `200`, the updated Statement summary.   |

### Create a Statement

Send an `Idempotency-Key` header and a JSON body:

```json
{
	"startDatetime": "2026-08-01T00:00:00.000Z",
	"endDatetime": "2026-09-01T00:00:00.000Z",
	"description": "August account statement",
	"metadata": { "reportingPeriod": "2026-08" }
}
```

Description and metadata are optional. Use a fresh UUID key for each intended creation and reuse it
only to retry that creation. Idempotency claims are scoped to the Organization and Statement creation
action and retained for 15 minutes. Replay returns the same saved accounting snapshot with its
current annotations. A replay after annotations change can therefore return a different description,
metadata, `lockVersion`, and Updated Time.

### Read summaries and Entries

A summary contains `id`, `ledgerId`, `accountId`, `startDatetime`, `endDatetime`,
`ledgerAccountVersion`, `normalBalance`, `assetId`, `assetCode`, `minorUnitExponent`, `startingBalances`, `endingBalances`,
optional `description` and `metadata`, `lockVersion`, `created`, and `updated`.
`ledgerAccountVersion` is the captured Account version; it never changes on that Statement. Entries
are available from the separate Entries endpoint.

Both collection endpoints accept `offset` from `0` to `10000` and `limit` from `1` to `100`, with
defaults of `0` and `20`. They return plain arrays; an exhausted page is empty. Statement summaries
sort by Created Time descending, then Statement ID descending. Copied Entries sort by Effective
Time ascending, then Entry ID ascending. There are no period filters.

Each copied Entry contains `id`, `accountId`, `direction`, `amount`, `assetId`, `assetCode`, `minorUnitExponent`, optional
`metadata`, and `created`. Its nested `transaction` contains `id`, `lockVersion`, `status`,
`effectiveAt`, and optional `description` and `metadata`, all captured at generation. Only Entries
for the requested Account are copied; counterpart Entries are excluded. Saved reads use these copies
without joining live Transactions.

### Replace annotations

Send the current Statement `lockVersion` and the complete desired annotations:

```json
{
	"lockVersion": 1,
	"description": "August account statement, reviewed",
	"metadata": { "reviewStatus": "reviewed" }
}
```

`lockVersion` is a required integer of at least `1`. An update atomically matches and increments
it and advances Updated Time. A stale version returns `409`; read the current summary before
submitting another update. Omitted description or metadata is cleared, so sending only
`{ "lockVersion": 1 }` clears both annotations when version `1` is current. Metadata is replaced as
a whole. Updates preserve the period, captured Account version, balances, and Entries.

## Limits and errors

Generation accepts at most **10,000 period Entries** and **16 MiB (16,777,216 bytes)** of serialized
snapshot data. The byte limit uses the UTF-8 byte length of PostgreSQL's JSONB text representation,
including the snapshot header and copied Entry and Transaction metadata. The database preflights the
size before the application loads the Entry payload. Exceeding either limit returns `400` and saves
no partial Statement. Earlier history is aggregated rather than copied; these limits do not bound
historical aggregation work.

Invalid timestamps, periods, request fields, or pagination return `400`.
Missing or incorrectly scoped resources return `404`. Annotation conflicts, int64 balance overflow, and idempotency claims
still pending after a bounded wait return `409`. A rejected create, including overflow, releases its
idempotency key, while infrastructure failures retain it; unavailable idempotency storage returns `503`.
Authentication, permission, rate-limit, and unexpected failures use the API's existing problem
responses.

Generation captures the Account, Account version, balances, and Entries in one PostgreSQL
repeatable-read transaction while posting continues. Application and repository interfaces enforce
accounting immutability; direct SQL changes are not prevented by a database update trigger. There is
no Statement delete endpoint, and there is no cascade, so Statements block ordinary Ledger and
Account deletion; repository-only cleanup removes them for fixtures.

## Migration

The `statement-snapshots` migration deletes all existing placeholder Statements before adding the
required ownership, period, Account version, and JSONB snapshot columns. Those rows hold no
accounting snapshot to preserve, and the deletion is irreversible once the migration commits.
Stop the API before applying it so legacy writers cannot create placeholder rows. Recreating a
period later captures the Ledger state at that later generation.
