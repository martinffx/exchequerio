# Agent Development Guidelines

## Commands
- `pnpm dev` - Development server with hot reload
- `pnpm test` - Run all tests with verbose output  
- `pnpm test src/path/to/file.test.ts` - Run single test file
- `pnpm test:watch` - Tests in watch mode
- `pnpm typecheck` - Type check without emitting
- `pnpm lint` - Lint with Biome
- `pnpm format` - Format with Biome
- `drizzle-kit generate` - Generate migrations from schema
- `drizzle-kit migrate` - Apply migrations to database

## Code Style
- **Formatting**: Tab indentation, double quotes, no semicolons (Biome)
- **Imports**: Use `@/*` path aliases for src/ directory
- **Types**: Infer types from Drizzle schema, use `type` for type aliases
- **Naming**: PascalCase for classes/types, camelCase for variables/functions
- **Architecture**: Follow Router → Service → Repository → Entity → Database pattern
- **Testing**: Jest with ts-jest, test files follow `*.test.ts` pattern in src/
- **Database**: Schema-first with Drizzle ORM, PostgreSQL required for ACID compliance