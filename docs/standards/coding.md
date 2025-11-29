# TypeScript Coding Standards

## Code Style & Formatting

### ESLint + Biome Configuration
- **Primary tools:** Biome for fast formatting and linting, ESLint for type-aware linting
- **Indentation:** Tab characters (not spaces)
- **Quotes:** Double quotes for strings
- **Semicolons:** Always required (enforced by Biome)
- **Line endings:** LF (Unix-style)

### Commands
- \`mise run lint\` - Run Biome + ESLint (hybrid linting approach)
- \`mise run lint_fast\` - Run Biome only (fast formatting + syntax checks)
- \`mise run lint_slow\` - Run ESLint only (type-aware + boundaries + unicorn)
- \`mise run format\` - Format code with Biome
- \`mise run check\` - Run all code quality checks (format + lint + types)
- Run \`mise run format && mise run lint\` before committing

## TypeScript Conventions

### Type Definitions
```typescript
// Use explicit types for public APIs
export interface CreateLedgerRequest {
  name: string
  description?: string
  currency: string
  currencyExponent: number
}

// Use type inference for internal variables
const ledger = await ledgerRepo.create(request) // Type inferred

// Use const assertions for literal types
const TRANSACTION_STATUSES = ["pending", "posted", "archived"] as const
type TransactionStatus = typeof TRANSACTION_STATUSES[number]
```

### Naming Conventions
```typescript
// PascalCase for types, interfaces, classes
interface LedgerAccount { }
class LedgerService { }
type TransactionStatus = string

// camelCase for variables, functions, methods
const ledgerAccount = new LedgerAccount()
function calculateBalance() { }

// SCREAMING_SNAKE_CASE for constants
const DEFAULT_CURRENCY_EXPONENT = 2
const MAX_RETRY_ATTEMPTS = 3

// kebab-case for file names
ledger-service.ts
transaction-repo.ts
```

### Import/Export Patterns
```typescript
// Use path aliases
import { LedgerRepo } from "@/repo/LedgerRepo"
import { LedgerService } from "@/services/LedgerService"

// Group imports: external → internal → relative
import { FastifyInstance } from "fastify"
import { Static, Type } from "@sinclair/typebox"

import { config } from "@/config"
import { LedgerRepo } from "@/repo/LedgerRepo"

import { validateRequest } from "./validation"

// Prefer named exports over default exports
export { LedgerService }
export type { CreateLedgerRequest }
```

## File Structure & Naming

### Directory Organization
```
src/
├── server.ts              # Fastify server setup
├── index.ts              # Application entry point
├── config.ts             # Environment configuration
├── auth.ts              # JWT authentication
├── errors.ts            # Global error handling
├── repo/                # Database layer
│   ├── schema.ts        # Database schema definitions
│   ├── LedgerRepo.ts    # Repository classes
│   └── migrations.ts    # Migration utilities
├── services/            # Business logic layer
│   ├── entities/        # Domain entities
│   │   ├── LedgerEntity.ts
│   │   └── TransactionEntity.ts
│   ├── LedgerService.ts # Service classes
│   └── TransactionService.ts
└── routes/              # HTTP API layer
    ├── ledgers/         # Feature-specific routes
    │   ├── LedgerRoutes.ts
    │   ├── schema.ts    # Request/response schemas
    │   └── fixtures.ts  # Test data
    └── schema.ts        # Global API schemas
```

### File Naming Rules
- **PascalCase** for class files: `LedgerService.ts`, `TransactionRepo.ts`
- **camelCase** for utility files: `config.ts`, `errors.ts`, `schema.ts`
- **kebab-case** for feature directories: `ledger-accounts/`, `transaction-entries/`

### Test File Conventions
```typescript
// Test files use .test.ts suffix
LedgerService.test.ts
TransactionRepo.test.ts

// Test structure mirrors source structure
src/services/LedgerService.ts
src/services/LedgerService.test.ts

// Test naming patterns
describe("LedgerService", () => {
  describe("createTransaction", () => {
    it("should create valid double-entry transaction", () => {
      // Test implementation
    })
    
    it("should reject unbalanced entries", () => {
      // Test implementation
    })
  })
})
```

## Code Organization Patterns

### Entity Transformation Methods
```typescript
export class LedgerTransactionEntity {
  // Standard transformation methods
  static fromRequest(req: CreateTransactionRequest): LedgerTransactionEntity
  static fromRecord(record: LedgerTransactionRecord): LedgerTransactionEntity
  toRecord(): LedgerTransactionRecord
  toResponse(): TransactionResponse
  validate(): ValidationResult
}
```

### Service Method Patterns
```typescript
export class LedgerService {
  // Use dependency injection via constructor
  constructor(
    private readonly ledgerRepo: LedgerRepo,
    private readonly logger: Logger
  ) {}

  // Public methods use async/await
  async createTransaction(request: CreateTransactionRequest): Promise<Transaction> {
    // Validate input
    const validation = TransactionEntity.validate(request)
    if (!validation.isValid) {
      throw new ValidationError(validation.errors)
    }

    // Business logic
    const transaction = TransactionEntity.fromRequest(request)
    const result = await this.ledgerRepo.createTransaction(transaction.toRecord())
    
    // Return domain entity
    return TransactionEntity.fromRecord(result)
  }
}
```

### Repository Method Patterns
```typescript
export class LedgerRepo {
  constructor(private readonly db: Database) {}

  // Use atomic transactions for financial operations
  async createTransaction(transaction: TransactionRecord): Promise<TransactionRecord> {
    return await this.db.transaction(async (trx) => {
      // Use SELECT ... FOR UPDATE for balance updates
      const accounts = await trx
        .select()
        .from(ledgerAccountsTable)
        .where(inArray(ledgerAccountsTable.id, accountIds))
        .for("update")

      // Atomic operations within transaction
      const result = await trx.insert(ledgerTransactionsTable)
        .values(transaction)
        .returning()

      return result[0]
    })
  }
}
```

### Route Handler Patterns
```typescript
// Use TypeBox for request/response validation
const CreateTransactionSchema = Type.Object({
  description: Type.String(),
  entries: Type.Array(Type.Object({
    accountId: Type.String(),
    direction: Type.Union([Type.Literal("debit"), Type.Literal("credit")]),
    amount: Type.Number({ minimum: 0 })
  }))
})

export async function registerLedgerRoutes(server: FastifyInstance) {
  server.post<{
    Body: Static<typeof CreateTransactionSchema>
    Reply: TransactionResponse
  }>("/transactions", {
    schema: {
      body: CreateTransactionSchema,
      response: {
        201: TransactionResponseSchema
      }
    }
  }, async (request, reply) => {
    const transaction = await server.services.ledger.createTransaction(request.body)
    return reply.code(201).send(transaction)
  })
}
```

## Testing Standards

### Test-Driven Development (TDD)

#### TDD Cycle
1. **Write Test** - Create failing test for new functionality
2. **Write Code** - Implement minimal code to make test pass
3. **Refactor** - Improve code quality while maintaining test coverage

#### Unit Tests
```typescript
// Test business logic in isolation
describe("LedgerTransactionService", () => {
  let service: LedgerTransactionService
  let mockRepo: jest.Mocked<LedgerRepo>

  beforeEach(() => {
    mockRepo = createMockRepo()
    service = new LedgerTransactionService(mockRepo)
  })

  it("should enforce double-entry accounting rules", async () => {
    const request = {
      entries: [
        { accountId: "acc1", direction: "debit", amount: 100 },
        { accountId: "acc2", direction: "credit", amount: 50 } // Unbalanced
      ]
    }

    await expect(service.createTransaction(request))
      .rejects.toThrow("Transaction entries must balance")
  })
})
```

#### Integration Tests
```typescript
// Test full request/response cycle
describe("POST /api/ledgers/:id/transactions", () => {
  let server: FastifyInstance

  beforeEach(async () => {
    server = await createTestServer()
  })

  it("should create balanced transaction", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/ledgers/ledger-123/transactions",
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        description: "Test transaction",
        entries: [
          { accountId: "acc1", direction: "debit", amount: 100 },
          { accountId: "acc2", direction: "credit", amount: 100 }
        ]
      }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      id: expect.any(String),
      status: "posted"
    })
  })
})
```

#### Financial Accuracy Tests
```typescript
// Critical: Test concurrent operations and race conditions
describe("Concurrent Balance Updates", () => {
  it("should maintain balance accuracy under concurrent transactions", async () => {
    const initialBalance = 1000
    const transactionCount = 50
    const transactionAmount = 10

    // Create multiple concurrent transactions
    const promises = Array(transactionCount).fill(null).map(() => 
      service.createTransaction({
        entries: [
          { accountId: "test-account", direction: "debit", amount: transactionAmount },
          { accountId: "contra-account", direction: "credit", amount: transactionAmount }
        ]
      })
    )

    await Promise.all(promises)

    const finalBalance = await service.getAccountBalance("test-account")
    expect(finalBalance.amount).toBe(initialBalance - (transactionCount * transactionAmount))
  })
})
```

## Development Workflow

### Command Sequence
```bash
# 1. Start development environment
pnpm docker              # Start PostgreSQL and Redis containers
pnpm dev                # Start development server with hot reload

# 2. Make changes following TDD
# - Write failing test
# - Implement feature
# - Refactor code

# 3. Validate changes
pnpm test               # Run all tests
pnpm typecheck          # Type check without emitting files
mise run lint          # Type-aware linting with ESLint + architectural boundaries
mise run format         # Format code with Prettier + oxc plugin

# 4. Database changes (if needed)
drizzle-kit generate   # Generate migration from schema changes
drizzle-kit migrate    # Apply migrations to database
```

### Feature Development Process

#### 1. Schema-First Development
```bash
# Update database schema first
vim src/repo/schema.ts

# Generate migration
drizzle-kit generate

# Apply migration
drizzle-kit migrate

# Verify schema in database
drizzle-kit studio
```

#### 2. Repository Layer (Data Access)
```typescript
// Implement repository methods with proper error handling
export class LedgerRepo {
  async createTransaction(transaction: TransactionRecord): Promise<TransactionRecord> {
    try {
      return await this.db.transaction(async (trx) => {
        // Atomic database operations
        const result = await trx.insert(ledgerTransactionsTable)
          .values(transaction)
          .returning()
        
        return result[0]
      })
    } catch (error) {
      if (error.code === "23505") { // Unique constraint violation
        throw new DuplicateTransactionError(transaction.idempotencyKey)
      }
      throw error
    }
  }
}
```

#### 3. Service Layer (Business Logic)
```typescript
// Implement business rules and validation
export class LedgerService {
  async createTransaction(request: CreateTransactionRequest): Promise<Transaction> {
    // Input validation
    const validation = this.validateTransactionRequest(request)
    if (!validation.isValid) {
      throw new ValidationError(validation.errors)
    }

    // Business logic
    const transaction = TransactionEntity.fromRequest(request)
    const record = await this.ledgerRepo.createTransaction(transaction.toRecord())
    
    return TransactionEntity.fromRecord(record)
  }

  private validateTransactionRequest(request: CreateTransactionRequest): ValidationResult {
    const errors: string[] = []

    // Validate double-entry accounting
    const debits = request.entries
      .filter(e => e.direction === "debit")
      .reduce((sum, e) => sum + e.amount, 0)
    
    const credits = request.entries
      .filter(e => e.direction === "credit")
      .reduce((sum, e) => sum + e.amount, 0)

    if (debits !== credits) {
      errors.push("Transaction entries must balance (debits must equal credits)")
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }
}
```

#### 4. Route Layer (HTTP API)
```typescript
// Connect service layer to HTTP endpoints
export async function registerTransactionRoutes(server: FastifyInstance) {
  server.post<{
    Params: { ledgerId: string }
    Body: Static<typeof CreateTransactionSchema>
    Reply: TransactionResponse
  }>("/ledgers/:ledgerId/transactions", {
    schema: {
      params: { ledgerId: Type.String() },
      body: CreateTransactionSchema,
      response: { 201: TransactionResponseSchema }
    },
    preHandler: server.auth([server.verifyJWT])
  }, async (request, reply) => {
    try {
      const transaction = await server.services.ledger.createTransaction(request.body)
      return reply.code(201).send(transaction.toResponse())
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(422).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            details: error.errors
          }
        })
      }
      throw error
    }
  })
}
```

## Database Migration Strategy

### Migration Best Practices
```bash
# 1. Generate migration from schema changes
drizzle-kit generate

# 2. Review generated migration file
vim migrations/0002_add_transaction_tables.sql

# 3. Add custom constraints or indexes if needed
# 4. Apply migration to development database
drizzle-kit migrate

# 5. Test migration rollback strategy (if needed)
# 6. Apply to staging/production environments
```

### Migration File Organization
```
migrations/
├── 0001_initial_schema.sql         # Organizations table
├── 0002_add_ledger_core_tables.sql # Core ledger tables
├── 0003_add_psp_extensions.sql     # PSP-specific tables
├── 0004_add_performance_indexes.sql # Optimization indexes
└── meta/
    ├── _journal.json               # Migration history
    ├── 0001_snapshot.json          # Schema snapshots
    └── 0002_snapshot.json
```

## Quality Standards

### Code Quality Gates
```bash
# All checks must pass before committing
pnpm typecheck  # No TypeScript errors
pnpm lint       # No linting errors  
pnpm test       # All tests passing
pnpm test:ci    # Coverage thresholds met
```

### Performance Standards
- **Sub-second response times** for balance queries
- **Database query optimization** using EXPLAIN ANALYZE
- **Connection pooling** configuration for production load
- **Memory leak prevention** through proper resource cleanup

### Financial Accuracy Requirements
- **100% test coverage** for financial calculation logic
- **Atomic operations** for all balance updates
- **Race condition testing** for concurrent scenarios
- **Idempotency validation** for safe retry operations

### Error Handling Standards
```typescript
// Comprehensive error handling with proper logging
async createTransaction(request: CreateTransactionRequest): Promise<Transaction> {
  const startTime = Date.now()
  
  try {
    this.logger.info("Creating transaction", { 
      description: request.description,
      entryCount: request.entries.length 
    })

    const result = await this.performTransaction(request)
    
    this.logger.info("Transaction created successfully", {
      transactionId: result.id,
      duration: Date.now() - startTime
    })

    return result
  } catch (error) {
    this.logger.error("Transaction creation failed", {
      error: error.message,
      request: request,
      duration: Date.now() - startTime
    })

    // Re-throw with additional context
    if (error instanceof ValidationError) {
      throw error // Pass through validation errors
    } else if (error.code === "23505") {
      throw new DuplicateTransactionError("Transaction with this idempotency key already exists")
    } else {
      throw new TransactionProcessingError("Failed to process transaction", error)
    }
  }
}
```

## Monitoring & Observability

### Logging Standards
```typescript
// Structured logging with correlation IDs
this.logger.info("Balance calculation started", {
  accountId: account.id,
  correlationId: request.correlationId,
  operation: "calculateBalance"
})

// Performance logging for financial operations
const startTime = performance.now()
const balance = await this.calculateBalance(accountId)
const duration = performance.now() - startTime

this.logger.info("Balance calculation completed", {
  accountId,
  balance: balance.amount,
  duration: `${duration}ms`,
  correlationId: request.correlationId
})
```

### Health Checks
```typescript
// Database connectivity and performance health checks
server.get("/health", async (request, reply) => {
  const checks = await Promise.allSettled([
    this.checkDatabaseConnection(),
    this.checkBalanceCalculationPerformance(),
    this.checkMemoryUsage()
  ])

  const isHealthy = checks.every(check => check.status === "fulfilled")
  
  return reply.code(isHealthy ? 200 : 503).send({
    status: isHealthy ? "healthy" : "unhealthy",
    checks: checks.map(check => ({
      name: check.name,
      status: check.status,
      message: check.status === "fulfilled" ? "OK" : check.reason
    }))
  })
})
```

## Documentation Standards

### Code Comments
```typescript
/**
 * Creates a new double-entry transaction with atomic balance updates.
 * Uses SELECT...FOR UPDATE to prevent race conditions on balance calculations.
 * 
 * @param request - Transaction creation request with entries
 * @returns Created transaction with generated ID and timestamps
 * @throws ValidationError when entries don't balance or accounts don't exist
 * @throws ConcurrencyError when optimistic locking fails
 */
async createTransaction(request: CreateTransactionRequest): Promise<Transaction>
```

### README Patterns
- Keep implementation-focused (not marketing-focused)
- Include quick start commands and development workflow
- Document environment setup and testing procedures
- Reference architecture decisions and standards

### API Documentation
- Use TypeBox schemas for automatic OpenAPI generation
- Include comprehensive examples in schema definitions
- Document authentication requirements clearly
- Provide error response examples for each endpoint