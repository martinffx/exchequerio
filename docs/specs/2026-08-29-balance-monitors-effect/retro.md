# Retrospective: asynchronous Balance Monitors

Recorded on 2026-09-23 for branch `implement-balance-monitors`, through `dd0e731`.

This document sits beside the earlier [CRUD Effect migration design](./design.md) and
[plan](./plan.json) for discoverability. That migration explicitly excluded evaluation and
delivery; it was not the plan for this branch. The resulting feature contract is documented in
[Balance monitors](../../../apps/api/docs/product/balance-monitors.md).

## What happened

The branch implemented asynchronous alerts, integrated changing contracts from main, replaced its
initial durability model, then consolidated the implementation. The largest rework followed a
change in delivery guarantees rather than a demonstrated defect in the original machinery.

| Commit               | Change                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d7c78a8`            | Implemented atomic PostgreSQL outbox capture, historical monitor revisions, a leased relay, LISTEN/NOTIFY recovery, queued delivery, encrypted credentials, retries, and replay tooling. |
| `69c68d9`            | Merged main's UUID, Asset, and exact int64 amount contracts into the feature.                                                                                                            |
| `bdb977e`            | Replaced the outbox and revision storage with best-effort background publication after accounting commits. Added bounded enqueue retries and shutdown draining.                          |
| `363a685`            | Merged main's subsequent Asset lookup changes.                                                                                                                                           |
| `ca541af`            | Introduced signed webhooks, transient-only delivery retries, safe failure details, and consolidated unreleased migrations.                                                               |
| `ad0a792`            | Colocated monitor jobs with the domain and capture tests with transaction repository tests.                                                                                              |
| `1fb0c6b`            | Removed cached account monitor counts and their bookkeeping.                                                                                                                             |
| `cfdccb4`, `dd0e731` | Moved crossing evaluation onto the monitor entity and consolidated job lifecycle, transport, configuration, and tests.                                                                   |

## What went wrong

### The delivery guarantee changed after the infrastructure existed

The initial design retained committed balance changes in PostgreSQL until queue handoff. The
later design explicitly accepted losing alerts between accounting commit and enqueue, or after
enqueue retries were exhausted. Removing the outbox also removed its relay, leases, recovery
scans, and historical revision storage.

The initial implementation was overbuilt for the eventual requirement. Git does not establish
whether the original requirement was misunderstood or later reconsidered. Either way, the
acceptable loss boundary was expensive to change after implementation.

### Shared contracts were changing concurrently

Main changed resource persistence to UUIDs, replaced currency references with Assets, and adopted
exact int64 amounts. Monitor payloads, comparisons, row conversions, migrations, and tests had to
follow. The integration added coverage for adjacent values above JavaScript's safe-integer range
and signed int64 extremes.

This was legitimate integration work. The large merge diff includes incoming main changes and
must not be counted as monitor repair work. The lesson is to identify and sequence dependencies
before building deeply against contracts that are about to change.

### We added state and module boundaries that the feature did not need

The account monitor counter duplicated information already held by monitor rows. It required
create/delete bookkeeping and a schema constraint, and capture relied on its accuracy. Direct
queries removed that maintenance burden while preserving account locks. There is no evidence in
this history that counter drift actually occurred.

Monitor rules and job behavior were also spread across several single-feature modules. The later
commits brought the crossing rule onto its entity and delivery behavior into its domain job.
Their benefit was clearer ownership and fewer places to navigate, not a large net code reduction.

### Failure policy and migration scope needed correction

Delivery initially retried permanent failures and reduced errors to generic strings. The correction
retained safe categories and HTTP statuses, retried transient failures, and stopped retrying invalid
credentials, unsafe destinations, and other permanent failures. Signed payloads replaced bearer
credentials as a separate webhook contract change.

Unreleased migrations also preserved intermediate outbox and revision schemas only to remove them
later. Consolidating the final schema avoided maintaining that obsolete path. This deliberately
requires development database and old queue resets; it is not a production migration strategy.

### The tracked decision record did not keep pace

No async design or plan was added under `docs/specs` in the reviewed branch history. The existing
monitor spec describes an earlier, separate CRUD migration. The feature's product documentation
recorded its evolving behavior, but the repository lacks a separate design record explaining the
major durability reversal. This does not prove that no design discussion took place outside git.

## What the recovery preserved

- Capture before/after balances and the applicable configuration while holding account locks.
- Publish after commit without waiting for Valkey in the accounting request path.
- Keep enqueue failures from retrying or rolling back accounting.
- Reuse stable job IDs across publication retries to handle partial success and lost acknowledgements.
- Bound retries, retain sanitized failure information, and drain tracked publication before closing
  Valkey during graceful shutdown.
- Retain captured rules and credentials for already-created jobs across monitor edits or deletion.

Tests added or retained cover accounting completion while enqueue is blocked, enqueue failure,
deduplication, shutdown ordering, historical configuration, exact amounts, rollback, replay
suppression, and signed delivery. Consolidating test files did not itself mean removing coverage.

The accepted limitation remains explicit: best-effort publication can lose alerts. Graceful
shutdown draining cannot close the crash gap or recover exhausted publication attempts.

## Rules for the next feature

1. **Settle the guarantees before choosing infrastructure.** Record acceptable loss, request-path
   latency, ordering, retries, replay, and behavior after configuration changes. For alerts, answer
   “Can a committed balance change lose its alert?” before deciding whether an outbox is necessary.
2. **Justify new machinery against a current requirement.** Name the requirement served by each
   new table, cached field, background process, or abstraction. Use authoritative data directly
   unless a demonstrated need justifies maintaining another representation.
3. **Build one complete path first.** Exercise a committed balance change through captured
   configuration, queued work, and signed delivery. Test queue failure and accounting independence
   before expanding operational tooling.
4. **Treat guarantee changes as scope changes.** Update the approved plan and record the tradeoff
   before implementing durable-to-best-effort delivery or another public or operational contract
   change. Do not label these changes as behavior-preserving cleanup.
5. **Check moving dependencies early.** Identify concurrent work affecting IDs, amounts, Assets,
   and transaction handling; integrate it early or explicitly sequence the work around it.
6. **Review necessity as well as correctness.** Before completion, ask which state, modules, and
   migration stages can be removed while retaining the agreed guarantees. Do not infer improvement
   from deletion counts that include generated snapshots or relocated tests.
7. **Report validation precisely.** Separate tests added from commands actually run and their
   results. Validation recorded for an earlier migration does not verify a later feature branch.

Keep the checkpoint small: a paragraph of guarantees, explicit non-goals, and named acceptance
tests. The goal is to expose expensive assumptions before they spread through the implementation.

Suggested instruction for future implementation work:

> Before implementation, state the behavioral guarantees, acceptable failure modes, and smallest
> design that satisfies them. Justify new persistent state and background processes. If a guarantee
> changes, stop implementation and revise the approved plan. Completion reports must distinguish
> tests added from checks actually run.

## Evidence limits

This retrospective uses commit history, diffs, product documentation, and test source. It does not
establish a production incident, counter drift, or an exploitable bearer-auth vulnerability. Tests
were not executed for this retrospective, and the earlier CRUD migration's validation record is
not evidence of this branch's current CI status.
