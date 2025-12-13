# API Agent Development Guide

## Product Documentation

- **Product Overview**: See `/docs/product/product.md` for overall platform vision
- **Roadmap**: See `/docs/product/roadmap.md` for feature priorities
- **Database ERD**: See `apps/api/docs/product/erd.md` for complete database schema
- **Architecture Standards**: See `/docs/standards/architecture.md` for layered architecture principles
- **Coding Standards**: See `/docs/standards/coding.md` for TypeScript and TDD patterns

## Commands

### **Development Workflow**
- `bun run dev` - Start development server (auto-starts database)
- `bun run test` - Run all tests with Vitest (auto-starts database)

**Important:** Always use `bun run test` (NOT `bun test`). We use **Vitest** for its full mocking capabilities (`vi.mocked<T>()`, `vi.fn()`, etc.). The `bun test` command uses Bun's built-in test runner which lacks these features.

**Testing Prerequisites:**
- PostgreSQL database must be running (auto-started by `bun run test`)
- Integration tests use real database with test schema

### **Testing**
- `bun run test` - Run all tests (Vitest)
- `bun run test:watch` - Run tests in watch mode (Vitest)
- `bun run test:ci` - Run tests with coverage (Vitest)

### **Code Quality**
- `bun run format` - Format code with Biome
- `bun run lint` - Type-aware linting with Biome + ESLint
- `bun run types` - Type check without emitting
- `bun run check` - **Run all code quality checks** (format + lint + types)

### **Database Operations**
- `bun run docker:up` - Start PostgreSQL database
- `bun run docker:down` - Stop PostgreSQL database
- `bun run docker:logs` - View database logs

### **CI/CD Pipeline**
- `bun run ci` - **Complete CI pipeline** (docker:up + build + lint + types + test)

### **Database Migrations**
- `bun run db:gen` - Generate migrations from schema (drizzle-kit generate)
- `bun run db:migrate` - Apply migrations to database (with environment config)

### **Database Schema**
- **ERD Reference**: See `docs/product/erd.md` for complete Entity Relationship Diagram
- **Schema Source**: `src/repo/schema.ts` for Drizzle ORM definitions
- **Architecture**: Follow Router → Service → Repository → Entity → Database pattern

## Code Style

### **Recommended Workflow**
```bash
mise run fix          # Format + auto-fix all issues (recommended)
mise run lint          # Check for remaining issues
mise run types         # Type check
mise run test         # Run tests
```

### **Individual Commands**
- **Formatting**: Prettier with oxc plugin (fast parsing) - tab indentation, double quotes, no semicolons
- **Linting**: Hybrid approach - oxlint (fast) + ESLint (type-aware + boundaries)
- **Architecture**: Enforced with jsboundaries plugin
  - `routes` → `services` (API calls to business logic)
  - `services` → `repo` + `entities` (business logic to data)
  - `entities` → `entities` only (pure data models)
  - `repo` → `repo` only (data access layer)
- **Type-Aware**: TypeScript-eslint with full type information
- **Imports**: Use `@/*` path aliases for src/ directory
- **Types**: Infer types from Drizzle schema, use `type` for type aliases
- **Naming**: PascalCase for classes/types, camelCase for variables/functions
- **Testing**: Jest with ts-jest, test files follow `*.test.ts` pattern in src/
- **Database**: Schema-first with Drizzle ORM, PostgreSQL required for ACID compliance
  - **Schema Visualization**: Reference `docs/product/erd.md` for complete ERD
  - **Schema Definitions**: Use `src/repo/schema.ts` for table structures
  - **Relationship Patterns**: Follow double-entry accounting principles