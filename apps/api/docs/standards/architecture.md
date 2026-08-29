# TypeScript Architecture Standards

## Technology Stack

### Core Stack
- **Runtime:** Node.js with TypeScript
- **API Framework:** Fastify with type-provider-typebox for runtime validation
- **Database:** PostgreSQL with Drizzle ORM
- **Authentication:** JWT tokens via @fastify/auth and @fastify/jwt
- **Documentation:** Auto-generated OpenAPI/Swagger

### Supporting Technologies
- **Testing:** Vitest
- **Linting/Formatting:** Oxlint and Oxfmt
- **Environment:** @dotenvx/dotenvx for configuration
- **Containerization:** Docker with docker-compose for development

## Layered Architecture Pattern

### Architecture Flow
```
JWT Auth → Routes → Services → Repositories → PostgreSQL Database
```

The API is migrating by resource. Effect-based slices and remaining plugin-based resources coexist.
Migrated slices live under `src/domains/`; Transactions live under
`src/domains/ledgers/transactions/` and run through the shared managed Effect runtime. Legacy
resources retain their `src/routes/`, `src/services/`, and `src/repo/` layout until they migrate.

### Layer Responsibilities

#### **Route Layer**
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
- Keep migrated routes with their resource slice; keep remaining routes under `src/routes/`

#### **Service Layer**
- Domain business logic implementation
- Transaction orchestration and validation
- Entity transformation and validation
- Cross-cutting concerns (logging, monitoring)

**Standards:**
- Migrated slices expose Effect services through the shared managed runtime
- Remaining services use Fastify plugins and the existing `server.services` namespace
- No direct HTTP concerns (request/response objects)
- Implement comprehensive business rule validation

#### **Repository Layer**
- Data access abstraction
- Database query implementation
- Transaction management
- Data mapping between entities and database records

**Standards:**
- Use Drizzle ORM for type-safe database access
- Implement atomic operations with proper locking
- Abstract database implementation details
- Apply pure database-to-domain error translations owned by each resource's error module
- Keep migrated repositories with their resource slice; keep remaining repositories under
  `src/repo/`

#### **Entity Layer**
- Domain model definitions
- Data transformation methods
- Input validation logic
- Business rule enforcement

**Standards:**
- Encapsulate business logic within entities
- Provide type-safe data contracts
- Handle data normalization and validation
- Keep migrated domain types with their resource slice; legacy entities retain their existing
  location until migration

## Runtime and Plugin Composition

Fastify owns one managed Effect runtime for migrated services and disposes it when the server closes.
Routes run Effect programs through `server.runtime`. The existing repository and service plugins
continue to compose resources that have not migrated.

### Coexistence Pattern
```typescript
declare module "fastify" {
  interface FastifyInstance {
    runtime: ServerRuntime<ServerRuntimeServices, never>
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
SELECT ... FROM ledger_accounts ORDER BY id FOR UPDATE;

-- Domain validation before persistence
Debit totals = Credit totals for each currency_code

-- Immutable entries
Posted Transactions and their Entries cannot change

-- Create idempotency is coordinated only through Valkey.
```

### Database Schema Design
```sql
-- Nine authoritative Account projections
CREATE TABLE ledger_accounts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
	ledger_id TEXT NOT NULL,
	currency_code TEXT NOT NULL,
  pending_amount BIGINT NOT NULL DEFAULT 0,
  posted_amount BIGINT NOT NULL DEFAULT 0,
  available_amount BIGINT NOT NULL DEFAULT 0,
  pending_credits BIGINT NOT NULL DEFAULT 0,
  pending_debits BIGINT NOT NULL DEFAULT 0,
  posted_credits BIGINT NOT NULL DEFAULT 0,
  posted_debits BIGINT NOT NULL DEFAULT 0,
  available_credits BIGINT NOT NULL DEFAULT 0,
  available_debits BIGINT NOT NULL DEFAULT 0,
  lock_version INTEGER NOT NULL DEFAULT 1,
  created TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, ledger_id, id)
);

CREATE TABLE ledger_transactions (
	id TEXT PRIMARY KEY,
	organization_id TEXT NOT NULL,
	ledger_id TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'voided')),
  posted_at TIMESTAMP WITH TIME ZONE,
  lock_version INTEGER NOT NULL DEFAULT 1,
  created TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
	updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
	UNIQUE (organization_id, ledger_id, id)
);

CREATE TABLE ledger_transaction_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  ledger_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount BIGINT NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'voided')),
  created TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_id, ledger_id, transaction_id)
    REFERENCES ledger_transactions (organization_id, ledger_id, id),
  FOREIGN KEY (organization_id, ledger_id, account_id)
    REFERENCES ledger_accounts (organization_id, ledger_id, id)
);
```

### Race Condition Prevention
```sql
-- Lock every affected Account in one deterministic order
SELECT
  id,
  pending_credits,
  pending_debits,
  posted_credits,
  posted_debits,
  lock_version
FROM ledger_accounts
WHERE organization_id = $1
  AND ledger_id = $2
  AND id = ANY($3)
ORDER BY id
FOR UPDATE;
```

### Performance Optimization
```sql
CREATE INDEX idx_ledger_transactions_ledger_created_id
  ON ledger_transactions (ledger_id, created DESC, id DESC);
CREATE INDEX idx_ledger_transactions_organization
  ON ledger_transactions (organization_id);
CREATE INDEX idx_ledger_transactions_status
  ON ledger_transactions (status);
CREATE INDEX idx_ledger_transaction_entries_transaction
  ON ledger_transaction_entries (transaction_id);
CREATE INDEX idx_ledger_transaction_entries_account
  ON ledger_transaction_entries (account_id);
```

### Data Consistency Standards
```sql
BEGIN;

-- Lock the tenant-scoped Accounts in ascending ID order.
SELECT id, lock_version
FROM ledger_accounts
WHERE organization_id = $1 AND ledger_id = $2 AND id = ANY($3)
ORDER BY id
FOR UPDATE;

INSERT INTO ledger_transactions
	(id, organization_id, ledger_id, description, status, created, updated)
VALUES ($4, $1, $2, $5, 'pending', $6, $6);

INSERT INTO ledger_transaction_entries
  (id, organization_id, ledger_id, transaction_id, account_id, direction, amount, currency, status, created)
VALUES
  ($7, $1, $2, $4, $8, 'debit', $9, $10, 'pending', $6),
  ($11, $1, $2, $4, $12, 'credit', $9, $10, 'pending', $6);

-- Apply one domain-derived aggregate delta per Account.
UPDATE ledger_accounts
SET pending_debits = pending_debits + $13,
    pending_credits = pending_credits + $14,
    posted_debits = posted_debits + $15,
    posted_credits = posted_credits + $16,
    available_debits = available_debits + $17,
    available_credits = available_credits + $18,
    pending_amount = pending_amount + $19,
    posted_amount = posted_amount + $20,
    available_amount = available_amount + $21,
    lock_version = lock_version + 1,
    updated = $6
WHERE organization_id = $1 AND ledger_id = $2 AND id = $8 AND lock_version = $22;

COMMIT;
```

### Idempotency support

Transaction creation uses one Organization-scoped Valkey lock with a 15-minute expiry. The winner
stores a pending marker, commits PostgreSQL, then replaces the marker with the Transaction ID.
PostgreSQL stores no idempotency key. A losing caller checks Valkey once and retries at most three
times within 500 milliseconds. It returns a retryable `409` with `Retry-After: 1` while the marker
remains pending.

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
