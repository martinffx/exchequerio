# Exchequer Platform - Agent Development Guide

## Product Overview

**Exchequer** is a real-time double-entry ledger platform for Payment Service Providers (PSPs) and Marketplaces, enabling Financial Operations teams to track money flow, calculate balances, and automate settlement processes.

## Monorepo Structure

This monorepo contains three applications:

### 📦 Apps

#### `apps/api/` - Ledger API
Real-time double-entry ledger API with PostgreSQL persistence.

**Tech Stack:**
- **Runtime:** Node.js with TypeScript
- **Framework:** Fastify with TypeBox validation
- **Database:** PostgreSQL with Drizzle ORM
- **Testing:** Vitest
- **Code Quality:** Biome + ESLint

**Documentation:**
- `apps/api/AGENTS.md` - API development guide
- `apps/api/docs/product/erd.md` - Database schema and ERD
- `apps/api/docs/spec/` - Feature specifications
- `apps/api/docs/standards/` - API-specific standards

#### `apps/web/` - Customer Portal
Customer-facing dashboard for ledger data visualization and management.

**Tech Stack:**
- **Framework:** React Router v7
- **UI:** React 19, Tailwind CSS v4, shadcn/ui
- **Data Fetching:** openapi-react-query, TanStack React Query
- **State Management:** Zustand
- **Testing:** Vitest, Testing Library, MSW
- **Build:** Vite

**Documentation:**
- `apps/web/AGENTS.md` - Web development guide
- `apps/web/docs/standards/` - React/Tailwind standards

#### `apps/docs/` - Documentation Site
Public documentation site built with Docusaurus.

**Tech Stack:**
- **Framework:** Docusaurus
- **Content:** Markdown

**Documentation:**
- `apps/docs/AGENTS.md` - Docusaurus guide

## Monorepo Commands

### Development

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

## Documentation Structure

### Product Documentation (`/docs/product/`)

High-level product vision, roadmap, and business context shared across all apps.

- **product.md** - Product definition, target users, core features
- **roadmap.md** - Feature roadmap and implementation priorities

### Shared Standards (`/docs/standards/`)

Architecture and coding standards applicable to all applications.

- **architecture.md** - Layered architecture, separation of concerns, design patterns
- **coding.md** - TypeScript conventions, testing standards, error handling

### App-Specific Documentation (`apps/*/docs/`)

Each app has its own documentation for:
- **standards/** - Technology-specific coding and architecture standards
- **spec/** - Feature specifications (can also be at root level for cross-app features)
- **product/** - App-specific product documentation (e.g., API ERD)

## Spec-Driven Development Workflow

This project uses spec-driven development for feature creation:

### Available Commands

1. **`/product-init`** - Initialize project documentation (already done)
2. **`/product-roadmap`** - Update product roadmap with priorities
3. **`/spec-create [feature-name]`** - Create new feature specification
4. **`/spec-design [feature-name]`** - Design technical architecture
5. **`/spec-plan [feature-name]`** - Plan implementation tasks
6. **`/spec-implement [feature-name]`** - Implement with stub-driven TDD
7. **`/spec-progress [feature-name]`** - Track feature progress
8. **`/product-progress`** - Track overall product progress

### Workflow Example

```bash
# Create feature spec
/spec-create user-authentication

# Design architecture
/spec-design user-authentication

# Plan implementation tasks
/spec-plan user-authentication

# Implement feature with TDD
/spec-implement user-authentication

# Track progress
/spec-progress user-authentication
```

## Architecture Principles

All apps follow consistent architectural patterns:

### Layered Architecture
- **Backend (API):** Routes → Services → Repositories → Entities → Database
- **Frontend (Web):** Pages → Components → Hooks/State → API Client → Services

### Key Principles
- **Separation of Concerns:** Each layer has a single responsibility
- **Dependency Direction:** Dependencies flow inward toward domain
- **Domain-Driven Design:** Entities manage data transformations
- **Test-Driven Development:** Stub-driven TDD for all features

See `/docs/standards/architecture.md` for detailed architecture guidelines.

## Coding Standards

### TypeScript Conventions
- Strict type checking enabled
- Explicit types for public APIs
- Type inference for internal variables
- Named exports over default exports

### Testing Strategy
- **TDD Workflow:** Red → Green → Refactor
- **Unit Tests:** Isolated with mocked dependencies
- **Integration Tests:** Real dependencies, test databases
- **E2E Tests:** Critical user flows

### Code Quality
- Use Biome/Prettier for consistent formatting
- ESLint for type-aware linting
- Pre-commit hooks enforce standards
- 100% test coverage for critical business logic

See `/docs/standards/coding.md` for detailed coding guidelines.

## Getting Started

### Prerequisites

- **Node.js** 18+ (via mise: `mise install`)
- **Bun** 1.2+ (package manager)
- **Docker** (for PostgreSQL database)

### Initial Setup

```bash
# Install dependencies
bun install

# Start database
bun run docker:up

# Run migrations (API)
cd apps/api
bun run db:migrate

# Start development
bun run dev
```

### Development Workflow

1. **Pick a feature** from `/docs/product/roadmap.md`
2. **Create spec** using `/spec-create [feature-name]`
3. **Design architecture** using `/spec-design [feature-name]`
4. **Plan tasks** using `/spec-plan [feature-name]`
5. **Implement with TDD** using `/spec-implement [feature-name]`
6. **Track progress** using `/spec-progress [feature-name]`

## App-Specific Guides

For detailed development instructions specific to each app:

- **API Development:** See `apps/api/AGENTS.md`
  - Fastify routes and plugins
  - Drizzle ORM and migrations
  - Repository and service patterns
  - Database schema (ERD)

- **Web Development:** See `apps/web/AGENTS.md`
  - React Router v7 patterns
  - React Query and Zustand
  - Tailwind and shadcn/ui
  - Testing with Vitest and MSW

- **Docs Development:** See `apps/docs/AGENTS.md`
  - Docusaurus configuration
  - Content structure
  - Markdown conventions

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

## Support

- **Product Questions:** See `/docs/product/product.md`
- **Architecture Questions:** See `/docs/standards/architecture.md`
- **Coding Questions:** See `/docs/standards/coding.md`
- **App-Specific Questions:** See `apps/*/AGENTS.md`
- **Feature Specs:** See `/docs/spec/` or `apps/*/docs/spec/`
