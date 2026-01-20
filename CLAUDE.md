# Exchequer Platform

## Product Overview

**Exchequer** is a real-time double-entry ledger platform for Payment Service Providers (PSPs) and Marketplaces, enabling Financial Operations teams to track money flow, calculate balances, and automate settlement processes.

## Project Structure

```
workos/
├── apps/
│   ├── api/          # Ledger API (Fastify, Drizzle, PostgreSQL)
│   ├── web/          # Customer Portal (React Router, Tailwind)
│   └── docs/         # Documentation site (Docusaurus)
└── docs/
    ├── product/      # Product vision and roadmap
    ├── spec/         # Feature specifications
    └── standards/    # Architecture and coding standards
        ├── api/      # API-specific standards
        └── web/      # Web-specific standards
```

For detailed app-specific information, see:
- **API Development**: `docs/standards/api/`
- **Web Development**: `docs/standards/web/`
- **Docs Development**: See `apps/docs/docs/standards/`

## Quick Start

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
cd apps/api && bun run db:migrate && cd ../..

# Start development
bun run dev
```

## Essential Commands

### Development

```bash
bun run dev          # Start all apps
bun run dev:api      # API only (http://localhost:3000)
bun run dev:web      # Web only (http://localhost:5173)
bun run dev:docs     # Docs only (http://localhost:3000)
```

### Testing

**Important:** Always use `bun run test` (NOT `bun test`). We use **Vitest** for its full mocking capabilities (`vi.mocked<T>()`, `vi.fn()`, etc.).

**Prerequisites:** Database must be running for API tests (auto-started by `bun run test`).

```bash
bun run test                           # Run all tests (Vitest)
bun --filter=@exchequerio/api test    # API tests only
bun --filter=@exchequerio/web test    # Web tests only
```

### Code Quality

```bash
bun run check        # Run all checks (format + lint + types)
bun run format       # Format all apps
bun run lint         # Lint all apps
bun run types        # Type check all apps
```

### Build & CI

```bash
bun run build        # Build all apps for production
bun run ci           # Complete CI pipeline (docker:up + build + lint + types + test)
```

### Database

```bash
bun run docker:up    # Start PostgreSQL
bun run docker:down  # Stop PostgreSQL
bun run docker:logs  # View database logs
```

## Documentation

### Product Documentation (`docs/product/`)

- **product.md** - Product definition, target users, core features
- **roadmap.md** - Feature roadmap and implementation priorities
- **erd.md** - Database schema and Entity Relationship Diagram

### Shared Standards (`docs/standards/`)

- **architecture.md** - Layered architecture, separation of concerns, design patterns
- **coding.md** - TypeScript conventions, testing standards, error handling

### App-Specific Standards

- **API**: `docs/standards/api/` - Fastify patterns, Drizzle ORM, database operations
- **Web**: `docs/standards/web/` - React Router, Tailwind, React Query, Zustand patterns
- **Docs**: `apps/docs/docs/standards/` - Docusaurus content guidelines

### Feature Specifications (`docs/spec/`)

Feature-specific specs following spec-driven development workflow.

## Architecture Principles

All apps follow consistent layered architecture:

### Backend (API)
```
Routes → Services → Repositories → Entities → Database
```

### Frontend (Web)
```
Pages → Components → Hooks/State → API Client → Services
```

### Key Principles
- **Separation of Concerns** - Each layer has a single responsibility
- **Dependency Direction** - Dependencies flow inward toward domain
- **Domain-Driven Design** - Entities manage data transformations
- **Test-Driven Development** - Stub-driven TDD for all features

See `docs/standards/architecture.md` for detailed guidelines.

## Tech Stack

### Shared
- **Language:** TypeScript with strict mode
- **Package Manager:** Bun 1.2+
- **Build System:** Turborepo
- **Testing:** Vitest
- **Code Quality:** Biome + ESLint

### API (`apps/api/`)
- **Framework:** Fastify with TypeBox validation
- **Database:** PostgreSQL with Drizzle ORM
- **Auth:** JWT tokens via @fastify/auth and @fastify/jwt
- **Documentation:** Auto-generated OpenAPI/Swagger

See `docs/standards/api/` for detailed patterns.

### Web (`apps/web/`)
- **Framework:** React Router v7 with file-based routing
- **UI:** React 19, Tailwind CSS v4, shadcn/ui
- **Data Fetching:** openapi-react-query, TanStack React Query
- **State Management:** Zustand (client), React Query (server)

See `docs/standards/web/` for detailed patterns.

### Docs (`apps/docs/`)
- **Framework:** Docusaurus
- **Content:** Markdown/MDX

## Development Workflow

### Spec-Driven Development

1. **Create Spec**: `/spec-create [feature-name]` - Define requirements
2. **Design Architecture**: `/spec-design [feature-name]` - Plan technical approach
3. **Plan Tasks**: `/spec-plan [feature-name]` - Break down implementation
4. **Implement**: `/spec-implement [feature-name]` - Build with stub-driven TDD
5. **Track Progress**: `/spec-progress [feature-name]` - Monitor completion

### Quality Gates

All checks must pass before merging:

```bash
bun run format     # Code formatting
bun run lint       # Linting
bun run types      # Type checking
bun run test       # All tests passing
```

## Support

- **Product Questions**: See `docs/product/product.md`
- **Architecture Questions**: See `docs/standards/architecture.md`
- **Coding Questions**: See `docs/standards/coding.md`
- **API Development**: See `docs/standards/api/`
- **Web Development**: See `docs/standards/web/`
- **Feature Specs**: See `docs/spec/`
