# Settlement corrections

This approved correction follows the Settlement Effect migration. The review decisions below
supersede the earlier proposal to share a database transaction between repositories.

## Ownership and processing

SettlementService orchestrates SettlementRepo and TransactionRepo directly. Each repository owns
its database transactions. No database transaction crosses a service or repository boundary.

Processing has three commits:

1. SettlementRepo validates and freezes source membership, checks netting, and records Processing
   with the intended target status. Creation may create and prepare together.
2. TransactionRepo atomically creates or transitions the accounting Transaction, Entries and Account
   projections. The Transaction carries a unique, immutable Settlement ID.
3. SettlementRepo finalizes its separately stored status and clears the target. Voiding releases
   source membership in this same finalization transaction.

A failure after preparation leaves Processing and frozen sources. Retries reuse existing accounting
and resume the intended transition. Competing transitions and membership edits are rejected during
Processing. A replay must not resume a later transition belonging to another action.

SettlementRepo locks existing Settlement rows for preparation, membership changes and finalization.
TransactionRepo locks the associated Settlement within its own accounting transaction. It verifies
the Processing target and uses the unique Settlement reference to prevent duplicate accounting.

## Lifecycle and derived accounting

Drafting uses manual source selection. Drafting can become Pending, Posted or Voided. Pending can
become Posted or Voided. Processing is the intermediate state for accounting operations; it records
Pending, Posted or Voided as its target. Posted and Voided are terminal. Repeating a completed state
is a no-op. A draft can be voided directly without creating accounting.

Pending has one Pending offset Transaction. Posting preserves its Transaction and Entry identities.
Voiding retains the accounting and removes its balance effects before releasing source membership.
Generic Transaction mutations reject Settlement-generated accounting; callers use the Settlement API.

Transactions carry nullable `settlementId`, unique and constrained to the same Organization and Ledger.
Settlements do not store Transaction ID, Amount or direction. Responses resolve the Transaction through
that relationship and derive Amount and direction from its Entry on the settled Account. Accounting
fields are null until accounting exists; they remain readable after voiding.

Entities own codecs, netting and construction of accounting entities. Services own clocks, use-case
orchestration, idempotency and recovery. Repositories own persistence, locks and error translation.
There are no separate amount-update or Transaction-link operations.

## Source selection

Both Accounts belong to the Settlement's Organization and Ledger, are distinct and have the same
Currency Code. Eligible sources are Posted Entries on the settled Account without current Settlement
membership. Exclude generated offset Entries on their own settled Account; their contra-side Entries
remain eligible on the contra Account.

Net mixed directions relative to the settled Account's Normal Balance with exact integer accumulation.
Reject empty, zero and unsafe final nets. A negative net requires `allowEitherDirection: true`, default
false. The offset uses the absolute net and opposite direction. Its effective time is Settlement creation
time. Live balances remain status-based.

Direct Pending or Posted creation selects all eligible sources at or before `effectiveAtUpperBound`,
defaulting to Settlement creation time. There is no lower bound. Drafting rejects a cutoff and permits
manual membership edits. Limit membership to 10,000 sources and each mutation to 500 distinct IDs.
Automatic selection probes 10,001 and rejects overflow. A unique source Entry constraint prevents
concurrent attachment to different Settlements.

## HTTP

Create accepts Drafting, Pending or Posted and defaults to Pending. Return 201 with Location.
PATCH the resource to edit description, metadata or status. Drafting and Pending permit description
and metadata edits; terminal states permit metadata only. Omitted fields are preserved; supplied
metadata replaces the map and `{}` clears it. Configuration is immutable. Description and metadata
edits do not rewrite copied accounting fields.

Remove resource PUT, DELETE and status POST. Keep PATCH and DELETE `/:settlementId/entries` for
membership changes with 204 responses. Add paginated GET there returning Entry ID, Transaction ID,
effective time, Account ID, direction, Amount, Currency Code, status, metadata and creation time.
Use shared offset 0..10,000 and limit 1..100 (default 0/20), ordered by creation and ID descending.

Remove request Transaction ID and response Normal Balance. Return Ledger ID, nullable derived Amount,
direction and Transaction ID, cutoff, direction policy and External Reference, plus Created and Updated.
All reads and writes filter Organization and Ledger. Lists query directly without a Ledger existence
lookup. Preserve read/write permissions; voiding additionally requires delete permission.

## Explicit idempotency

IdempotencyService exposes claim, complete and release. A claim returns permission to continue,
a stored resource ID to reload, or an Effect error for pending/unavailable state. The service owns
Valkey claims, expiry and bounded waiting; it never receives business Effects or replay callbacks.
SettlementService and TransactionService own execution, replay and failure handling explicitly.

Each new client action uses a fresh UUID; retries reuse its key. Claims remain scoped to Organization
and service action with a 15-minute TTL. Store resource IDs only. Settlement preparation records its ID
before accounting so retries can resume. Release only known rejected writes; retain uncertain outcomes.
The existing gap between PostgreSQL commit and Valkey completion remains outside this correction.

## Migration and verification

Add a separate migration that refuses nonempty Settlement or membership tables before changing them.
Keep applied migrations. Existing ordinary Transactions receive a null Settlement reference. Add scoped
ownership constraints, the new lifecycle and processing target, and unique source/accounting references.
Do not invent a historical accounting migration.

Use direct service construction and focused typed dependency mocks, without override factories or
call-order bookkeeping. Test through routes, services and repositories; do not restore standalone
entity/runtime suites. Database fixtures use the configured test database. Fixture creation and mutations use repositories.
Teardown calls LedgerRepo.deleteLedgerFixtures for each owned Ledger, then OrganizationRepo.deleteOrganization.
Fixture cleanup deletes dependent accounting and Settlement rows in one scoped database transaction;
ordinary Ledger deletion behavior is unchanged. No disposable databases are created.
Test preparation/accounting/finalization failure recovery, concurrent retries and source exclusivity,
netting, cutoff boundaries, ownership, metadata, limits, permissions, migration preflight and balances.
Run focused and full API tests, types, build, lint and formatting checks.

Statements and Asset migration remain separate work. Statements promise immutable snapshots in the
domain glossary, but their current implementation remains a stub.
