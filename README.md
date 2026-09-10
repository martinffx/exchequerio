# Exchequer Platform

Real-time double-entry ledger systems for PSPs, Marketplaces, and anyone who needs to move and manage money at scale.

## Why Exchequer?

- **Kick-start your ledger** — Get a production-ready ledger system running in minutes, not months
- **Simple by design** — Clean APIs, predictable patterns, no magic
- **Real-time balances** — Know exactly where your money is, right now
- **By devs, for devs** — Built with the developer experience you wish every financial tool had

## Quick Start

```bash
# Prerequisites: Node.js 24, pnpm 11.18+, Docker

pnpm install
cp apps/api/.env.example apps/api/.env
pnpm run docker:up
pnpm run dev
```

API runs at `http://localhost:3000` • Web dashboard at `http://localhost:5173`

The API reads PostgreSQL from `DATABASE_URL` and Valkey from `VALKEY_URL`. The example environment
uses `postgresql://postgres:password@localhost:5432/ledger?schema=public` and
`redis://localhost:6379`.

## What's Inside

### Running Applications

```bash
# Start all apps
pnpm run dev

# Start specific app
pnpm run dev:api      # API only
pnpm run dev:web      # Web only
pnpm run dev:docs     # Docs only
```

### Testing

Tests run through the repository's Vitest scripts.

**Prerequisites:** PostgreSQL and Valkey must be running for API tests.

```bash
# Run all tests across all apps (auto-starts PostgreSQL and Valkey, uses Vitest)
pnpm run test

# Test the API (uses Vitest)
pnpm --filter=@exchequerio/api test    # Requires PostgreSQL and Valkey

# Start PostgreSQL and Valkey manually first (optional)
pnpm run docker:up

# Watch mode (from specific app directory)
pnpm --filter=@exchequerio/api test:watch
```

### Performance Benchmarks

The API includes comprehensive benchmarks for transaction creation under various contention scenarios. Run benchmarks with:

```bash
cd apps/api
pnpm run bench
```

#### Benchmark Results (M1 Max, 32GB RAM)

Transaction creation throughput and latency across different contention levels:

| Scenario | Accounts | Req/sec | p50 | p97.5 | p99 | Errors |
|----------|----------|---------|-----|-------|-----|--------|
| **High Contention** | 2 | 183.50 | 456ms | 1453ms | 1537ms | 0 |
| **Medium Contention** | 20 | 383.84 | 106ms | 1303ms | 1442ms | 0 |
| **Low Contention** | 200 | 538.64 | 79ms | 1191ms | 1475ms | 0 |
| **Hot Account (2/2002)** | 2,002 | 249.54 | 162ms | 1392ms | 1486ms | 0 |
| **Hot Account (20/2020)** | 2,020 | 384.27 | 106ms | 1310ms | 1448ms | 0 |

**Key Insights:**
- **Throughput degradation** (high vs low contention): 52.25%
- **P97.5 latency increase** (high vs low contention): 10.92%
- Bounded mutation retry: at most 3 total attempts for retryable concurrency conflicts
- Zero errors across all contention scenarios
- Hot account patterns demonstrate realistic production workloads

**Test Configuration:**
- Duration: 10 seconds per scenario
- Connections: 10 concurrent
- Pipelining: 1 request per connection
- Database: PostgreSQL 17 (local Docker)

### Code Quality

```bash
# Run all quality checks (format + lint + types + benchmark collection)
pnpm run check

# Individual checks
pnpm run format         # Format all apps with Oxfmt
pnpm run format:check   # Check formatting without writing
pnpm run lint           # Lint all apps with Oxlint
pnpm run types          # Type check all apps with TypeScript 7
```

### Build

```bash
# Build all apps for production
pnpm run build

# Build specific app
pnpm --filter=@exchequerio/web build
pnpm --filter=@exchequerio/docs build
```

### Local Infrastructure

```bash
# Start PostgreSQL and Valkey
pnpm run docker:up

# Build and start PostgreSQL, Valkey, and the API
pnpm run docker:up:api

# Stop every profile, preserving database data
pnpm run docker:down

# Stop every profile and delete database data
pnpm run docker:clean

# View PostgreSQL logs
pnpm run docker:logs
```

Compose uses the stable project name `exchequerio` across branches and worktrees, with
containers named `exchequerio-db-1`, `exchequerio-valkey-1`, and `exchequerio-api-1`.
Database data lives in `exchequerio_pg-data`.

For a fresh database when switching branches, run `pnpm run docker:clean`, switch
branches, then run `pnpm run dev:api` or `pnpm run test`. PostgreSQL initializes fresh
storage on startup. Existing worktree-specific containers and volumes remain separate;
these commands do not migrate or remove them.

### CI/CD

```bash
# Run complete CI pipeline
pnpm run ci
# Equivalent to: docker:up + build + format check + lint + types + benchmark collection + test
```

| App | Description | Stack |
|-----|-------------|-------|
| `apps/api` | Ledger API | Fastify, Drizzle, PostgreSQL |
| `apps/web` | Dashboard | React Router v7, Tailwind |
| `apps/docs` | Documentation | Docusaurus |

## Documentation

- [Getting Started](AGENTS.md) — Full development guide
- [Engineering Standards](docs/standards/README.md) — Shared standards and app addenda
- [Ledger API Standards](docs/standards/api.md) — Backend architecture and development
- [Customer Portal Standards](docs/standards/web.md) — Frontend architecture and development
- [Documentation Standards](docs/standards/documentation.md) — Public content guidance

## Contributing

```bash
pnpm run check   # Check formatting, lint, and types
pnpm run test    # Run all tests (requires Docker)
```

See [AGENTS.md](AGENTS.md) for the full development workflow.

## License

MIT License - see [LICENSE](LICENSE) for details.
