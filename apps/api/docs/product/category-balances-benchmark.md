# Category balance benchmark

Measured on 2026-09-08 using Node 24.18.1 on macOS ARM64 and PostgreSQL 17.10 in local Docker.
The isolated database was `exchequer_category_balances_test`; PostgreSQL and Valkey were already
running. This is a local capacity sample, not a production latency guarantee.

## Workload

The [benchmark](../../test/bench/category-balances.bench.ts) seeds 10,000 Accounts across two Assets.
Four Categories form a diamond, and 1,000 Accounts also link directly to the root. Reads therefore
exercise descendant traversal and Account deduplication.

Transaction traffic uses 100 connections and 100 Account pairs, following the existing benchmark's
30-second windows. Each request posts two Entries of 10,000 Minor Units and has a fresh idempotency
key. Category reads use 50 connections with a total target of 100 requests per second. The run uses
15 seconds of write warmup, followed by a write-only baseline, simultaneous writes and Category
reads, and another write-only baseline.

## Results

Throughput counts successful responses. Latency percentiles cover all responses in each workload.

| Workload                    | Successful requests/sec | Successful responses | Non-2xx responses | p50 (ms) | p97.5 (ms) | p99 (ms) |
| --------------------------- | ----------------------: | -------------------: | ----------------: | -------: | ---------: | -------: |
| Writes before Category load |                   665.6 |               19,982 |                10 |      102 |        234 |      391 |
| Writes during Category load |                   744.3 |               22,345 |                 9 |      105 |        210 |      219 |
| Category reads              |                   100.0 |                3,000 |                 0 |       91 |        198 |      207 |
| Writes after Category load  |                   943.2 |               28,315 |                 0 |      102 |        113 |      120 |

All four workloads had zero transport errors and zero timeouts. The Category workload met its
100 reads/sec target. Transaction throughput drifted substantially between the two baselines, so
this run does not isolate a reliable percentage cost for Category reads. The write latency median
was 102 ms in both baselines and 105 ms during Category reads.

An earlier run with ten read connections reached only 82.6 reads/sec. Increasing read connections
allowed the load generator to reach the requested rate. A run interrupted by a large timer jump
was discarded; the final run used `caffeinate -i` to prevent idle sleep.

## Reproduction and checks

With PostgreSQL and Valkey available and a fresh test database:

```bash
NODE_ENV=test DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/exchequer_category_balances_test \
  caffeinate -i pnpm --filter=@exchequerio/api exec dotenvx run -f .env.test -- \
  vitest run --config vitest.bench.config.ts test/bench/category-balances.bench.ts
```

Omit `caffeinate -i` on platforms without it. The benchmark writes machine-readable results to
`exchequer-category-balances-benchmark.json` in the operating system's temporary directory and
removes its own database fixtures.

Validation passed: 614 API tests in 44 files, all 14 uncached CI tasks, and the standalone benchmark.
CI used `pnpm run ci:gh --env-mode=loose --force` with the isolated `DATABASE_URL`, since the local
services were already running under another Compose project.

## Review follow-up validation: 2026-09-24

Tested `647ca06` plus the uncommitted concurrency correction described in
[Category balance decisions](./category-balances.md). This includes main's Asset lookup and Balance
Monitor merges. The environment was Node 24.18.1, pnpm 11.18.0, macOS ARM64, and PostgreSQL 17.10,
with PostgreSQL and Valkey already running. Commands used the isolated database
`exchequer_category_review_20260924`. Dates in this section use Europe/Amsterdam time.

### Tests added

Three PostgreSQL integration cases cover concurrent reverse and longer cycles, retryable HTTP
conflicts, cycle rejection after commit, duplicate links, rollback release, independent Ledgers,
and continued accounting writes and balance reads while the guard is held. The new cases failed
before the fix; competing links returned `200` instead of a retryable `409`.

### Checks executed

- `pnpm --filter=@exchequerio/api test LedgerAccountCategoryBalances`: 15 tests passed after the fix.
- `pnpm --filter=@exchequerio/api test LedgerAccountCategory`: 191 tests passed in seven files.
- `pnpm --filter=@exchequerio/api types`: passed.
- `pnpm run ci:gh --env-mode=loose --force`: all 14 tasks passed without cache; 754 API tests passed
  in 47 files. This included builds, formatting, lint, types, and benchmark discovery. The docs
  build retained its existing Docusaurus configuration deprecation warning.
- `caffeinate -i pnpm --filter=@exchequerio/api bench test/bench/category-balances.bench.ts`: passed
  in 115.75 seconds using the same workload described above.
- `pnpm --filter=@exchequerio/docs build`: passed again after the final public wording update.
  Internal documentation links also resolved in a filesystem check.
- `git diff --check`: passed.

All database commands above used
`DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/exchequer_category_review_20260924`.

### Updated capacity sample

| Workload                    | Successful requests/sec | Successful responses | Non-2xx responses | p50 (ms) | p97.5 (ms) | p99 (ms) |
| --------------------------- | ----------------------: | -------------------: | ----------------: | -------: | ---------: | -------: |
| Writes before Category load |                   789.9 |               23,713 |                 0 |      121 |        147 |      181 |
| Writes during Category load |                   635.1 |               19,065 |                 2 |      125 |        297 |      362 |
| Category reads              |                   100.0 |                3,000 |                 0 |       77 |        168 |      177 |
| Writes after Category load  |                   771.5 |               23,159 |                 0 |      123 |        165 |      201 |

All workloads had zero transport errors and zero timeouts. Category reads met the target rate.
Mixed-load write throughput was lower, and tail latency higher, than both write-only baselines.
The two non-2xx write responses are included above; the saved summary does not identify their
statuses. The benchmark permits non-2xx writes and requires zero non-2xx Category reads.

This single local sample is not a production latency guarantee or a controlled comparison with
the September 8 run. It exercises balance reads alongside accounting writes, not contention
between parent-link additions. It does not establish the throughput limit of the new Ledger guard.
