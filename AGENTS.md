# Agent Development Guidelines

## Commands

### **Development Workflow**
- `mise run dev` - Start development server (auto-starts database)
- `mise run test` - Run all tests (auto-starts database)

### **Code Quality**
- `mise run format` - Format code with Prettier + oxc plugin
- `mise run lint` - Type-aware linting with ESLint + architectural boundaries
- `mise run types` - Type check without emitting
- `mise run check` - **Run all code quality checks** (format + lint + types)

### **Database Operations**
- `mise run docker_up` - Start PostgreSQL database
- `mise run docker_down` - Stop PostgreSQL database
- `mise run docker_logs` - View database logs

### **CI/CD Pipeline**
- `mise run ci` - **Complete CI pipeline** (docker_up + format + lint + types + test)

### **Drizzle ORM**
- `drizzle-kit generate` - Generate migrations from schema
- `drizzle-kit migrate` - Apply migrations to database

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