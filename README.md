# Exchequer Platform

Real-time double-entry ledger platform for Payment Service Providers (PSPs) and Marketplaces, enabling Financial Operations teams to track money flow, calculate balances, and automate settlement processes.

## Monorepo Structure

This is a Turborepo monorepo containing three applications:

### 📦 Applications

#### `apps/api/` - Ledger API
Real-time double-entry ledger API with PostgreSQL persistence.

**Tech Stack:** Fastify, Drizzle ORM, PostgreSQL, Vitest

[View API Documentation →](apps/api/AGENTS.md)

#### `apps/web/` - Customer Portal
Customer-facing dashboard for ledger data visualization and management.

**Tech Stack:** React Router v7, React 19, Tailwind CSS v4, shadcn/ui, TanStack React Query, Zustand

[View Web Documentation →](apps/web/AGENTS.md)

#### `apps/docs/` - Documentation Site
Public documentation site built with Docusaurus.

**Tech Stack:** Docusaurus, Markdown/MDX

[View Docs Documentation →](apps/docs/AGENTS.md)

## Quick Start

### Prerequisites

- **Node.js** 18+ (managed via mise: `mise install`)
- **Bun** 1.2+ (package manager)
- **Docker** (for PostgreSQL database)

### Initial Setup

```bash
# Install dependencies
bun install

# Start PostgreSQL database
bun run docker:up

# Run database migrations (API)
cd apps/api
bun run db:migrate
cd ../..

# Start all applications
bun run dev
```

The applications will be available at:
- **API**: `http://localhost:3000`
- **Web**: `http://localhost:5173`
- **Docs**: `http://localhost:3000` (if running)

## Development Commands

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

## Documentation

### Product Documentation

High-level product vision and roadmap:

- [Product Overview](docs/product/product.md) - What we're building and why
- [Roadmap](docs/product/roadmap.md) - Feature priorities and implementation plan

### Architecture & Standards

Shared architecture and coding standards:

- [Architecture Standards](docs/standards/architecture.md) - Layered architecture, design patterns
- [Coding Standards](docs/standards/coding.md) - TypeScript conventions, testing, best practices

### App-Specific Documentation

Each app has its own detailed documentation:

- [API Development Guide](apps/api/AGENTS.md) - Fastify, Drizzle, PostgreSQL patterns
- [Web Development Guide](apps/web/AGENTS.md) - React Router, Tailwind, React Query patterns
- [Docs Guide](apps/docs/AGENTS.md) - Docusaurus content and structure

### Getting Started

New to the project? Start here:

1. Read [AGENTS.md](AGENTS.md) for a complete overview
2. Review [Architecture Standards](docs/standards/architecture.md)
3. Check [Coding Standards](docs/standards/coding.md)
4. Explore app-specific guides for your area of focus

## Development Workflow

This project uses **spec-driven development**. To build a new feature:

1. `/spec-create [feature-name]` - Create feature specification
2. `/spec-design [feature-name]` - Design technical architecture
3. `/spec-plan [feature-name]` - Plan implementation tasks
4. `/spec-implement [feature-name]` - Implement with stub-driven TDD
5. `/spec-progress [feature-name]` - Track feature progress

See [AGENTS.md](AGENTS.md) for complete workflow details.

## Architecture

All applications follow consistent layered architecture:

### Backend (API)
```
Routes → Services → Repositories → Entities → Database
```

### Frontend (Web)
```
Pages → Components → Hooks/State → API Client → Services
```

Key principles:
- **Separation of Concerns** - Each layer has a single responsibility
- **Dependency Direction** - Dependencies flow inward toward domain
- **Test-Driven Development** - Stub-driven TDD for all features
- **Type Safety** - Strict TypeScript across all apps

## Tech Stack

### Shared Technologies
- **Language:** TypeScript
- **Package Manager:** Bun
- **Build System:** Turborepo
- **Testing:** Vitest
- **Code Quality:** Biome + ESLint

### API
- **Framework:** Fastify with TypeBox
- **Database:** PostgreSQL with Drizzle ORM
- **Auth:** JWT tokens

### Web
- **Framework:** React Router v7
- **UI:** React 19, Tailwind CSS v4, shadcn/ui
- **Data:** openapi-react-query, TanStack React Query
- **State:** Zustand

### Docs
- **Framework:** Docusaurus
- **Content:** Markdown/MDX

## Contributing

### Code Review Checklist

- ✅ Follows layered architecture patterns
- ✅ Includes comprehensive tests (unit + integration)
- ✅ Passes all code quality checks (`bun run check`)
- ✅ Updates documentation if needed
- ✅ Follows spec-driven development workflow

### Quality Gates

All checks must pass before merging:

```bash
bun run format     # Code formatting
bun run lint       # Linting
bun run types      # Type checking
bun run test       # All tests passing
```

## Project Structure

```
/
├── AGENTS.md                    # Monorepo development guide
├── README.md                    # This file
├── docs/
│   ├── product/                 # Product vision and roadmap
│   └── standards/               # Shared architecture and coding standards
├── apps/
│   ├── api/                     # Ledger API (Fastify, Drizzle, PostgreSQL)
│   ├── web/                     # Customer Portal (React Router, Tailwind)
│   └── docs/                    # Documentation site (Docusaurus)
└── packages/                    # Shared packages
    ├── biome-config/            # Shared Biome configuration
    ├── eslint-config/           # Shared ESLint configuration
    └── typescript-config/       # Shared TypeScript configuration
```

## Support

- **Product Questions:** See [docs/product/product.md](docs/product/product.md)
- **Architecture Questions:** See [docs/standards/architecture.md](docs/standards/architecture.md)
- **Coding Questions:** See [docs/standards/coding.md](docs/standards/coding.md)
- **App-Specific Questions:** See `apps/*/AGENTS.md`

## License

Private repository - All rights reserved.
