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
