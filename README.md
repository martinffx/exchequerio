# Exchequer Ledger API

Double-entry ledger API enabling Financial Operations teams at Payment Service Providers (PSPs) and Marketplaces to track money flow, calculate balances, and automate settlement processes.

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Docker & Docker Compose

### Setup

```bash
# Clone repository
git clone <repository-url>
cd exchequerio

# Install dependencies
pnpm install

# Start database services
pnpm docker

# Run database migrations
drizzle-kit migrate

# Start development server
pnpm dev
```

The API will be available at `http://localhost:3000`

## Development Commands

```bash
# Development
pnpm dev              # Start development server with hot reload
pnpm start            # Start production server

# Testing
pnpm test             # Run all tests with verbose output
pnpm test:watch       # Tests in watch mode
pnpm test src/path/to/file.test.ts  # Run single test file

# Code Quality
pnpm typecheck        # Type check without emitting
pnpm lint             # Lint with Biome
pnpm format           # Format with Biome

# Database
drizzle-kit generate  # Generate migrations from schema
drizzle-kit migrate   # Apply migrations to database
```

## Architecture

### Layered Architecture

```
Router → Service → Repository → Entity → Database
```

- **Router Layer**: Fastify routes with OpenAPI documentation
- **Service Layer**: Business logic and transaction processing
- **Repository Layer**: Data access and CRUD operations
- **Entity Layer**: Data transformation and validation
- **Database**: PostgreSQL with Drizzle ORM

### Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Fastify
- **Database**: PostgreSQL with Drizzle ORM
- **Testing**: Jest with ts-jest
- **Code Quality**: Biome for linting and formatting
- **Documentation**: OpenAPI/Swagger

## API Documentation

### Base URL

```
http://localhost:3000
```

### Key Endpoints

#### Ledgers

- `POST /ledgers` - Create new ledger
- `GET /ledgers/{id}` - Get ledger details

#### Ledger Accounts

- `POST /ledger_accounts` - Create account
- `GET /ledger_accounts/{id}` - Get account with balances
- `GET /ledger_accounts/{id}/statement` - Get account statement

#### Transactions

- `POST /ledger_transactions` - Create transaction
- `PATCH /ledger_transactions/{id}` - Update transaction status

### Interactive Documentation

Visit `http://localhost:3000/docs` for interactive Swagger UI.

## Database Schema

### Core Entities

#### Ledger

Top-level container representing your accounting system.

#### Ledger Account

Individual accounts tracking specific value types (User Wallet, Revenue, Fees, etc.).

#### Ledger Transaction

Records money movement between accounts with double-entry validation.

#### Ledger Entry

Individual debit or credit within a transaction.

### Relationships

```
Ledger (1)
├── Ledger Accounts (many)
└── Ledger Transactions (many)
      └── Ledger Entries (2+)
```

## Balance Types

The system tracks three balance types for each account:

- **Posted Balance**: Completed/settled transactions only
- **Pending Balance**: Both pending and posted transactions
- **Available Balance**: Posted balance minus pending outbound transactions

## Development Guidelines

### Code Style

- **Formatting**: Tab indentation, double quotes, no semicolons (Biome)
- **Imports**: Use `@/*` path aliases for src/ directory
- **Types**: Infer types from Drizzle schema, use `type` for type aliases
- **Naming**: PascalCase for classes/types, camelCase for variables/functions
- **Architecture**: Follow Router → Service → Repository → Entity → Database pattern
- **Testing**: Jest with ts-jest, test files follow `*.test.ts` pattern in src/

### Spec-Driven Development

This project uses spec-driven development workflow:

1. **Create Specification**: `/spec-create feature-name`
2. **Design Architecture**: `/spec-design feature-name`
3. **Plan Implementation**: `/spec-plan feature-name`
4. **Implement Feature**: `/spec-implement feature-name`
5. **Track Progress**: `/spec-progress feature-name`

See `docs/spec/` for detailed feature specifications.

## Environment Variables

Create `.env` file for local development:

```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/ledger

# JWT
JWT_SECRET=your-secret-key

# Server
PORT=3000
HOST=0.0.0.0
```

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Specific test file
pnpm test src/repo/LedgerAccountRepo.test.ts

# Watch mode
pnpm test:watch
```

### Test Structure

- Unit tests: `*.unit.test.ts`
- Integration tests: `*.test.ts`
- Test files located alongside source files

## Docker Development

### Database Services

```bash
# Start PostgreSQL and Redis
pnpm docker

# Stop services
docker-compose down
```

### Production Build

```bash
# Build Docker image
docker build -t exchequer-ledger .

# Run with Docker Compose
docker-compose -f docker-compose.prod.yml up
```

## Contributing

1. Follow the established code style and architecture patterns
2. Write tests for all new features
3. Use spec-driven development workflow for new features
4. Ensure all tests pass before submitting PRs
5. Follow conventional commit message format

## License

Private repository - All rights reserved.

## Support

For development questions or issues:

- Reference `docs/` directory for detailed specifications
- Check `AGENTS.md` for development guidelines
- Review test files for usage examples

