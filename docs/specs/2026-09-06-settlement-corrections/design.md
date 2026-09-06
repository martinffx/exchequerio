# Settlement corrections

This is the product correction approved after reviewing the Settlement Effect migration. It
supersedes the behavior in `../2026-08-29-settlements-effect` without rewriting that migration's history.

## Transaction effective time

Transactions store `effectiveAt` as a timestamp and expose it as a Luxon DateTime in the entity.
Create accepts an optional effective time, defaulting to server creation time. Pending updates may
replace it; omission preserves it. Posting makes it immutable. Entries inherit their Transaction's
effective time. Detail and list responses return it. Created and Posted Time remain server-owned.
Live balances depend on status, including when effective time is in the future; no scheduler is added.

A separate migration backfills existing Transactions from `created`. It cannot recover historical
effective dates discarded by the earlier migration.

## Settlement lifecycle

| State    | Source membership | Generated accounting                                  |
| -------- | ----------------- | ----------------------------------------------------- |
| drafting | Manually mutable  | Amount, direction and Transaction ID are null         |
| pending  | Frozen            | One Pending offset Transaction and Entry pair         |
| posted   | Frozen            | The same Transaction and Entry pair become Posted     |
| voided   | Released          | Any Pending offset Transaction and pair become Voided |

Drafting may become Pending, Posted or Voided. Pending may become Posted or Voided. Posted and
Voided are terminal. Repeating the current status is a no-op. Voiding retains derived Amount,
direction and Transaction ID for audit; a voided draft retains null values.

Both Accounts belong to the Settlement's Organization and Ledger, are distinct and use the same
Currency Code. The Asset migration is out of scope. Sources must be Posted Entries on the settled
Account with no current Settlement link. Net their mixed directions relative to the Account's
Normal Balance using exact integer accumulation. Store the absolute net and actual
`settlementEntryDirection`. Reject empty, zero and unsafe final nets. A negative net requires
`allowEitherDirection: true`, default false.

The generated Transaction has effective time equal to Settlement creation time. Generic Transaction
mutations reject it with a typed conflict directing callers to the Settlement resource; normal reads
remain available. The Transaction repository checks ownership. TransactionService does not branch
on Settlement ownership.

## Selection and HTTP

Create accepts Drafting, Pending or Posted and defaults to Pending. Drafting rejects
`effectiveAtUpperBound` and uses manual selection. Direct Pending or Posted creation selects all
eligible sources whose parent effective time is at or before the cutoff, default Settlement creation
time. There is no lower bound, so later backdated Entries remain eligible. Exclude earlier generated
offset Entries on their own settled Account; contra-side Entries remain eligible on their Account.

Limit a Settlement to 10,000 sources and each add/remove request to 500 IDs. Automatic selection
probes 10,001 and rejects overflow without truncation. A unique junction `entry_id` prevents
concurrent attachment to different Settlements; conflicts roll back the whole operation.

Replace resource PUT and status POST with `PATCH /:settlementId`. PATCH accepts description,
metadata and status. Drafting and Pending permit description and metadata edits; terminal states
permit metadata only. Omitted fields are preserved. Supplied metadata replaces the map and `{}`
clears it. Configuration is immutable. Descriptive edits do not synchronize the generated
Transaction's copied description or metadata. Remove resource DELETE; void through PATCH.

Keep PATCH and DELETE `/:settlementId/entries` for adding and removing sources, returning 204.
Add paginated GET at that path, returning Entry ID, Transaction ID, parent effective time, Account ID,
direction, Amount, Currency Code, status, metadata and creation time. Use offset 0..10,000 and limit
1..100, default 0/20, with deterministic `created DESC, id DESC` order.

Remove request `transactionId` and response `normalBalance`. Return nullable Amount, direction and
Transaction ID, plus Ledger ID, cutoff, direction policy and External Reference. Retain `created`
and `updated`. Create returns 201 with Location; resource PATCH returns the Settlement. Preserve
read/write permissions and require the existing delete permission for voiding.

## Ownership and atomicity

Entities own codecs, netting, lifecycle rules and conversion to a Transaction entity. Services own
clocks, idempotency and retries. Repositories own SQL, transactions, locks and error translation.
Public repository operations are complete create, patch and membership operations. Remove
`updateAmount`, `linkTransaction`, `calculateAmount`, `getEntryIds` and piecemeal `updateStatus`.

Processing commits source links, Settlement state, generated Transaction and Entries, and Account
projections in one PostgreSQL transaction. Posting and voiding do the same. Existing Settlement
mutations and membership edits lock its row. Shared low-level Transaction persistence functions
accept the current database transaction; there is no public bypass flag or duplicated accounting.

Add Ledger ownership and composite foreign keys to Ledger, Accounts and generated Transaction.
The generated Transaction reference is unique and immutable. `fromRow(row | undefined)` returns
an Effect of Option; repository helpers translate missing values. Reuse shared ID parsers, Metadata,
Luxon and schema-inferred row types. Settlement-local infrastructure and operation mappers reuse
database error helpers, preserve domain errors, and map conflicts to 409, availability to 503 and
unexpected failures to 500.

Each mutating service operation claims Organization/action/client-key idempotency. Store only the
Settlement ID and reload on replay. A composite Settlement operation has one claim and does not
call TransactionService. Preserve Valkey TTL and bounded waiting; retain claims on uncertain
database outcomes. The existing crash gap remains outside this correction's scope.

## Migration and exclusions

Generate a separate Settlement migration, then review its SQL. Before changing either table, require
both Settlement tables to be empty. Do not invent accounting migrations for legacy rows. Retain
applied migrations. Replace the status enum, normal balance and non-null amount with the new
lifecycle, nullable derived facts, ownership, policy, indexes and constraints.

Statements remain a separate follow-up: their domain definition promises a complete immutable
snapshot, but the current implementation is a stub. This correction does not implement Statements.

## Verification

Test domain netting, lifecycle, timestamps and codecs at the entity boundary. Use PostgreSQL tests
for rollback at each write stage, concurrent source exclusivity, membership versus processing,
Account updates, ownership scope, identity across posting, void release and generic mutation
blocking. Cover cutoff equality, backdating, generated-offset exclusion and both limits. Test HTTP
routes, permissions and replay, and migration preflight/backfill. Run focused suites, typechecking,
build, lint, formatting and full regression tests. Do not weaken unrelated Category assertions.
