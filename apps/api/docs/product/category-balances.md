# Category balance decisions

Recorded on 2026-09-24 for `feat/category-balances`, following the
[Balance Monitor retrospective](../../../../docs/specs/2026-08-29-balance-monitors-effect/retro.md).
The earlier Category Effect migration did not cover balance aggregation.
The [public API guide](../../../docs/docs/category-balances.md) describes requests and responses.

## Guarantees

A balance read uses one PostgreSQL statement snapshot for Category orientation, descendant
membership, Account counters, and Asset metadata. It includes each reachable Account once,
including balances recorded before membership. Assets retain separate totals keyed by immutable
Asset ID. All three balance views use the queried Category's Normal Balance.

Amounts and debit/credit counters remain exact signed int64 values, serialized as decimal strings.
If any aggregate exceeds that range, the entire read fails with a non-retryable `409`, even when
the net balance fits. Empty Categories return an empty Asset vector; zero-balance Assets remain.

## Smallest design

Read existing Account projection counters through a recursive query. Ledger Entries remain the
accounting source of truth. No Category balance table, membership counter, cache, or background
refresh process is needed. SQL owns traversal and aggregation; the Category entity owns balance
formulas and response conversion. Historical queries and larger-than-int64 totals are outside
this feature.

## Concurrent parent links

API parent-link additions cannot introduce a cycle. Each addition starts a `READ COMMITTED`
transaction and locks its Organization-scoped Ledger row with `FOR NO KEY UPDATE NOWAIT` before
reading Categories, checking reachability, and inserting the link. All operations use the
transaction connection. The lock lasts until commit or rollback.

Lock contention returns `409` with `retryable: true`; callers may retry. Cycle rejection returns
`409` with `retryable: false`. The server does not retry automatically. Duplicate links remain
successful when the guard is available. `NOWAIT` governs row-lock acquisition, not all possible
database waits or total request duration.

This deliberately limits parent-link additions to one active transaction per Ledger. Balance
reads and accounting writes do not acquire this guard; other Ledgers remain independent.
Ledger updates or deletion can contend with it. Removals cannot introduce cycles and need no
additional guard. More granular locking requires evidence that this limit is a problem.

Existing cycles are preserved, and balance reads still terminate and deduplicate their Accounts.
There is no automatic cleanup or rollout audit. Direct SQL inserts can bypass the API guarantee.

## Acceptance and evidence

PostgreSQL integration tests hold a real parent-link transaction open and verify retryable
contention, reverse and longer-cycle rejection after retry, duplicate links, rollback release,
independent Ledgers, and continued balance reads and accounting writes. Existing tests cover
snapshots, Transaction lifecycle, ownership, Asset identity, exact amounts, and overflow.

The [benchmark and validation record](./category-balances-benchmark.md) identifies the tested
revision and commands actually run. Local measurements are capacity samples, not latency promises.
