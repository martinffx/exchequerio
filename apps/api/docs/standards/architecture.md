# TypeScript Architecture Standards

## Technology Stack

### Core Stack
- **Runtime:** Node.js with TypeScript
- **API Framework:** Fastify with type-provider-typebox for runtime validation
- **Database:** PostgreSQL with Drizzle ORM
- **Authentication:** JWT tokens via @fastify/auth and @fastify/jwt
- **Documentation:** Auto-generated OpenAPI/Swagger

### Supporting Technologies
- **Testing:** Jest with ts-jest transform
- **Linting/Formatting:** Biome (not Prettier/ESLint)
- **Environment:** @dotenvx/dotenvx for configuration
- **Containerization:** Docker with docker-compose for development

## Layered Architecture Pattern

### Architecture Flow
```
JWT Auth → Routes → Services → Repositories → PostgreSQL Database
```

### Layer Responsibilities

#### **Route Layer** (`src/routes/`)
- HTTP request/response handling
- Runtime type validation using TypeBox schemas
- JWT authentication and authorization
- OpenAPI documentation generation
- Error response formatting

**Standards:**
- All routes prefixed with `/api`
- Use TypeBox schemas for request/response validation
- Implement proper HTTP status codes
- Include comprehensive error handling

#### **Service Layer** (`src/services/`)
- Domain business logic implementation
- Transaction orchestration and validation
- Entity transformation and validation
- Cross-cutting concerns (logging, monitoring)

**Standards:**
- Services injected via Fastify plugins
- Available on `server.services` namespace
- No direct HTTP concerns (request/response objects)
- Implement comprehensive business rule validation

#### **Repository Layer** (`src/repo/`)
- Data access abstraction
- Database query implementation
- Transaction management
- Data mapping between entities and database records

**Standards:**
- Use Drizzle ORM for type-safe database access
- Implement atomic operations with proper locking
- Abstract database implementation details
- Handle database-specific error scenarios

#### **Entity Layer** (`src/services/entities/`)
- Domain model definitions
- Data transformation methods
- Input validation logic
- Business rule enforcement

**Standards:**
- Implement transformation methods: `fromRequest`, `toRecord`, `toResponse`, `validate`
- Encapsulate business logic within entities
- Provide type-safe data contracts
- Handle data normalization and validation

## Plugin System Architecture

### Core Plugins
- **RepoPlugin** - Registers database repositories using Drizzle ORM
- **ServicePlugin** - Registers business logic services with dependency injection
- **RouterPlugin** - Registers HTTP route handlers with JWT authentication

### Plugin Registration Pattern
```typescript
// All plugins extend Fastify instance via module declaration
declare module "fastify" {
  interface FastifyInstance {
    repositories: RepositoryContainer
    services: ServiceContainer
  }
}
```

## Database Design Standards

### PostgreSQL Configuration
- **Primary Database:** PostgreSQL for ACID compliance
- **ORM:** Drizzle ORM for type-safe database access
- **Migrations:** Schema-driven with `drizzle-kit`
- **Connection Pooling:** Configured for production load

### Schema Visualization
**See the complete [Entity Relationship Diagram](../product/erd.md) for detailed database schema visualization with all entities, relationships, and attributes.**

### Schema Principles
- **Schema-first approach** with TypeScript type inference
- **ACID compliance** required for financial operations
- **Immutable audit trails** for regulatory compliance
- **Optimistic locking** for concurrent balance updates

### Migration Strategy
- Use `drizzle-kit generate` for schema-driven migrations
- Migrations stored in `migrations/` directory
- Apply migrations via `drizzle-kit migrate`
- Include performance indexes in migration files

### Financial Data Constraints
```sql
-- Race condition prevention
SELECT ... FOR UPDATE on balance updates

-- Double-entry accounting enforcement
CHECK (SUM(debit_entries) = SUM(credit_entries)) per transaction

-- Immutable entries
No UPDATEs allowed on transaction entries

-- Idempotency support
UNIQUE constraints on idempotency keys
```

### Database Schema Design
```sql
-- Double-entry accounting enforcement
CREATE TABLE ledger_transactions (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'archived')),
  effective_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Immutable transaction entries
CREATE TABLE ledger_transaction_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
  account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL,
  description TEXT,
  effective_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Balance constraint enforcement
ALTER TABLE ledger_transaction_entries 
ADD CONSTRAINT check_transaction_balance 
CHECK (
  0 = (
    SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0)
    FROM ledger_transaction_entries 
    WHERE transaction_id = ledger_transaction_entries.transaction_id
  )
);
```

### Race Condition Prevention
```sql
-- Optimistic locking for balance updates
ALTER TABLE ledger_accounts 
ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1;

-- Balance calculation with row locking
SELECT 
  account_id,
  posted_balance,
  pending_balance,
  available_balance,
  lock_version
FROM ledger_accounts 
WHERE id = $1
FOR UPDATE;
```

### Performance Optimization
```sql
-- Strategic indexing
CREATE INDEX idx_ledger_accounts_ledger_id ON ledger_accounts(ledger_id);
CREATE INDEX idx_ledger_transactions_ledger_id ON ledger_transactions(ledger_id);
CREATE INDEX idx_ledger_transaction_entries_transaction_id ON ledger_transaction_entries(transaction_id);
CREATE INDEX idx_ledger_transaction_entries_account_id ON ledger_transaction_entries(account_id);

-- Time-based queries
CREATE INDEX idx_ledger_transactions_effective_at ON ledger_transactions(effective_at DESC);
CREATE INDEX idx_ledger_transaction_entries_effective_at ON ledger_transaction_entries(effective_at DESC);

-- Status-based queries
CREATE INDEX idx_ledger_transactions_status ON ledger_transactions(status) WHERE status IN ('pending', 'posted');
CREATE INDEX idx_ledger_transaction_entries_status ON ledger_transaction_entries(status) WHERE status IN ('pending', 'posted');
```

### Data Consistency Standards
```sql
-- Atomic transaction creation
BEGIN;

-- Lock accounts for balance updates
SELECT lock_version FROM ledger_accounts WHERE id = $1 FOR UPDATE;
SELECT lock_version FROM ledger_accounts WHERE id = $2 FOR UPDATE;

-- Create transaction
INSERT INTO ledger_transactions (id, ledger_id, description, status, effective_at)
VALUES ($3, $4, $5, 'pending', $6);

-- Create entries
INSERT INTO ledger_transaction_entries (id, transaction_id, account_id, direction, amount, currency, effective_at)
VALUES 
  ($7, $3, $1, 'debit', $8, $9, $6),
  ($10, $3, $2, 'credit', $8, $9, $6);

-- Update account balances
UPDATE ledger_accounts 
SET 
  posted_balance = posted_balance + CASE WHEN direction = 'credit' THEN amount ELSE -amount END,
  pending_balance = pending_balance + CASE WHEN direction = 'credit' THEN amount ELSE -amount END,
  lock_version = lock_version + 1
FROM ledger_transaction_entries
WHERE ledger_transaction_entries.account_id = ledger_accounts.id
  AND ledger_transaction_entries.transaction_id = $3;

COMMIT;
```

### Idempotency Support
```sql
-- Idempotency key constraints
ALTER TABLE ledger_transactions 
ADD CONSTRAINT unique_idempotency_key 
UNIQUE (idempotency_key);

-- Safe retry handling
INSERT INTO ledger_transactions (id, ledger_id, description, status, effective_at, idempotency_key)
VALUES ($1, $2, $3, 'pending', $4, $5)
ON CONFLICT (idempotency_key) 
DO NOTHING
RETURNING id;
```

### Security Standards
```sql
-- Role-based access
CREATE ROLE finops_read;
CREATE ROLE finops_write;
CREATE ROLE admin;

-- Grant permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO finops_read;
GRANT SELECT, INSERT ON ledger_transactions TO finops_write;
GRANT SELECT, INSERT ON ledger_transaction_entries TO finops_write;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO admin;
```

## Authentication & Security

### JWT Implementation
- **Token-based authentication** via @fastify/auth
- **Multi-tenant isolation** at organization level
- **Bearer token format** in Authorization header
- **Configurable token expiration** via environment variables

### Security Standards
- **Input validation** using TypeBox runtime validation
- **SQL injection prevention** via Drizzle ORM parameterized queries
- **Rate limiting** using @fastify/under-pressure
- **Audit trail logging** for all financial operations

## Performance Requirements

### Response Time Targets
- **Sub-second response times** for balance queries
- **High-volume concurrent** transaction processing
- **Optimized indexing** for PSP-specific query patterns
- **Connection pooling** for database efficiency

### Optimization Strategies
- **Pre-calculated balances** on account records with lock_version
- **Strategic database indexes** for common query patterns
- **Query optimization** using Drizzle ORM query builder
- **Caching strategies** for frequently accessed data

## Error Handling Standards

### Error Categories
- **Validation Errors** - 400 Bad Request with detailed field errors
- **Authentication Errors** - 401 Unauthorized with clear messaging
- **Authorization Errors** - 403 Forbidden for resource access
- **Business Logic Errors** - 422 Unprocessable Entity for domain violations
- **System Errors** - 500 Internal Server Error with logging

### Error Response Format
```typescript
{
  error: {
    code: "VALIDATION_ERROR",
    message: "Request validation failed",
    details: [
      {
        field: "amount",
        message: "Amount must be greater than 0"
      }
    ]
  }
}
```

## Development Environment

### Configuration Management
- **Environment variables** loaded via @dotenvx/dotenvx
- **Separate environments** (.env, .env.test, .env.production)
- **Centralized config class** for environment variable access
- **Type-safe configuration** with validation

### Development Tools
- **Hot reload** via tsx watch in development mode
- **Database exploration** via Drizzle Studio
- **API testing** via auto-generated Swagger UI
- **Container orchestration** via docker-compose