# Exchequer Platform

Real-time double-entry ledger systems for PSPs, Marketplaces, and anyone who needs to move and manage money at scale.

## Why Exchequer?

- **Kick-start your ledger** — Get a production-ready ledger system running in minutes, not months
- **Simple by design** — Clean APIs, predictable patterns, no magic
- **Real-time balances** — Know exactly where your money is, right now
- **By devs, for devs** — Built with the developer experience you wish every financial tool had

## Quick Start

```bash
# Prerequisites: Node.js 18+, Bun 1.2+, Docker

bun install
bun run docker:up
bun run dev
```

API runs at `http://localhost:3000` • Web dashboard at `http://localhost:5173`

## What's Inside

<<<<<<< HEAD
### Running Applications

```bash
# Start all apps
bun run dev

# Start specific app
bun run dev:api      # API only
bun run dev:web      # Web only
bun run dev:docs     # Docs only
```

### Testing

**Important:** Always use `bun run test` (NOT `bun test`). We use **Vitest** as our test runner for its full mocking capabilities (`vi.mocked<T>()`, `vi.fn()`, etc.). The `bun test` command uses Bun's built-in test runner which lacks these features.

**Prerequisites:** Database must be running for API tests (integration tests use real PostgreSQL).

```bash
# Run all tests across all apps (auto-starts database, uses Vitest)
bun run test

# Test specific app (uses Vitest)
bun --filter=@exchequerio/api test    # Requires database
bun --filter=@exchequerio/web test

# Start database manually first (optional)
bun run docker:up

# Watch mode (from specific app directory)
cd apps/api && bun run test:watch
```

### Performance Benchmarks

The API includes comprehensive benchmarks for transaction creation under various contention scenarios. Run benchmarks with:

```bash
cd apps/api
bun run bench
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
bun run check

# Individual checks
bun run format       # Format all apps
bun run lint         # Lint all apps
bun run types        # Type check all apps
```

### Build

```bash
# Build all apps for production
bun run build

# Build specific app
bun --filter=@exchequerio/api build
bun --filter=@exchequerio/web build
```

### Database

```bash
# Start PostgreSQL database
bun run docker:up

# Stop database
bun run docker:down

# View database logs
bun run docker:logs
```

### CI/CD

```bash
# Run complete CI pipeline
bun run ci
# Equivalent to: docker:up + build + lint + types + test
```
=======
| App | Description | Stack |
|-----|-------------|-------|
| `apps/api` | Ledger API | Fastify, Drizzle, PostgreSQL |
| `apps/web` | Dashboard | React Router v7, Tailwind |
| `apps/docs` | Documentation | Docusaurus |
>>>>>>> main

## Documentation

- [Getting Started](AGENTS.md) — Full development guide
- [Architecture](docs/standards/architecture.md) — Design patterns and principles
- [API Guide](apps/api/AGENTS.md) — Backend development
- [Web Guide](apps/web/AGENTS.md) — Frontend development

## Contributing

```bash
bun run check   # Format, lint, type check
bun run test    # Run all tests (requires Docker)
```

See [AGENTS.md](AGENTS.md) for the full development workflow.

## License

MIT License - see [LICENSE](LICENSE) for details.
