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
pnpm run docker:up
pnpm run dev
```

API runs at `http://localhost:3000` • Web dashboard at `http://localhost:5173`

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

**Prerequisites:** Database must be running for API tests (integration tests use real PostgreSQL).

```bash
# Run all tests across all apps (auto-starts database, uses Vitest)
pnpm run test

# Test specific app (uses Vitest)
pnpm --filter=@exchequerio/api test    # Requires database
pnpm --filter=@exchequerio/web test

# Start database manually first (optional)
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
- Optimistic locking with exponential backoff retry (5 attempts, 50ms-1s jitter)
- Zero errors across all contention scenarios
- Hot account patterns demonstrate realistic production workloads

**Test Configuration:**
- Duration: 10 seconds per scenario
- Connections: 10 concurrent
- Pipelining: 1 request per connection
- Database: PostgreSQL 17 (local Docker)

### Code Quality

```bash
# Run all quality checks (format + lint + types)
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

### Database

```bash
# Start PostgreSQL database
pnpm run docker:up

# Stop database
pnpm run docker:down

# View database logs
pnpm run docker:logs
```

### CI/CD

```bash
# Run complete CI pipeline
pnpm run ci
# Equivalent to: docker:up + build + lint + types + test
```

| App | Description | Stack |
|-----|-------------|-------|
| `apps/api` | Ledger API | Fastify, Drizzle, PostgreSQL |
| `apps/web` | Dashboard | React Router v7, Tailwind |
| `apps/docs` | Documentation | Docusaurus |

## Documentation

- [Getting Started](AGENTS.md) — Full development guide
- [Architecture](docs/standards/architecture.md) — Design patterns and principles
- [API Guide](apps/api/AGENTS.md) — Backend development
- [Web Guide](apps/web/AGENTS.md) — Frontend development

## Contributing

```bash
pnpm run check   # Check formatting, lint, and types
pnpm run test    # Run all tests (requires Docker)
```

See [AGENTS.md](AGENTS.md) for the full development workflow.

## License

MIT License - see [LICENSE](LICENSE) for details.
