# Atomic Transactions Implementation Checklist

## Overview

**Estimated Completion**: 8.5 hours (with parallel execution)  
**Critical Path**: Phase 1 → Phase 2 → Phase 3 (Phase 4 independent)  
**Current Blocker**: Missing repository imports (AT-001)

## Phase 1: Foundation Infrastructure (2.5 hours) - PARALLEL EXECUTION

### AT-001: Fix Repository Import Issues (30 minutes) ⚠️ CRITICAL BLOCKER
**Priority**: P0 - Blocks all subsequent development  
**Dependencies**: None  
**Time Estimate**: 30 minutes

#### Tasks
- [ ] Import `TypeID` from `typeid-js`
- [ ] Import `LedgerTransactionsTable`, `LedgerTransactionEntriesTable`, `LedgerAccountsTable` from `./schema`
- [ ] Import Drizzle ORM query builders (`eq`, `and`, `sql`) from `drizzle-orm`
- [ ] Add missing type imports for SQL operations
- [ ] Verify all import statements compile without errors

#### Validation
```bash
pnpm typecheck
pnpm lint
```

---

### AT-002: Implement Missing Base Methods (2 hours) ⚠️ CRITICAL BLOCKER
**Priority**: P0 - Required for all transaction functionality  
**Dependencies**: AT-001 (imports)  
**Time Estimate**: 2 hours

#### Tasks
- [ ] `createTransaction()` - Database transaction wrapper
- [ ] `getAccountWithLock()` - SELECT FOR UPDATE with ordering
- [ ] `updateAccountBalance()` - Optimistic locking updates
- [ ] `getAccountBalance()` - Balance validation queries
- [ ] `postTransaction()` - Status update operations
- [ ] All methods use SQL-first approach with database-level atomic operations

#### SQL Operations
```sql
-- Account locking with deterministic ordering
SELECT * FROM ledger_accounts 
WHERE id = $1 
ORDER BY id ASC
FOR UPDATE;

-- Optimistic locking balance update
UPDATE ledger_accounts 
SET balance_amount = $1, lock_version = lock_version + 1, updated = NOW()
WHERE id = $2 AND lock_version = $3;
```

#### Validation
```bash
pnpm test src/repo/LedgerTransactionRepo.test.ts
pnpm typecheck
```

---

## Phase 2: Core Atomic Operations (4.5 hours) - PARALLEL EXECUTION

### AT-003: SQL-First Balance Calculation Implementation (2 hours) 🔄 PARALLEL
**Priority**: P1 - Performance critical for financial operations  
**Dependencies**: AT-001, AT-002  
**Time Estimate**: 2 hours

#### Tasks
- [ ] Database function for balance calculation
- [ ] SQL SUM operations instead of application arithmetic
- [ ] Normal balance rules in SQL logic
- [ ] Remove manual balance calculations from repository
- [ ] Add SQL CHECK constraints for balance integrity
- [ ] Create database triggers for automatic balance validation

#### SQL Balance Calculation
```sql
CREATE OR REPLACE FUNCTION calculate_account_balance(account_uuid UUID)
RETURNS DECIMAL(20,4) AS $$
BEGIN
  RETURN COALESCE((
    SELECT SUM(
      CASE 
        WHEN accounts.normal_balance = 'debit' AND entries.direction = 'debit' THEN entries.amount
        WHEN accounts.normal_balance = 'debit' AND entries.direction = 'credit' THEN -entries.amount
        WHEN accounts.normal_balance = 'credit' AND entries.direction = 'credit' THEN entries.amount
        WHEN accounts.normal_balance = 'credit' AND entries.direction = 'debit' THEN -entries.amount
        ELSE 0
      END
    )
    FROM ledger_accounts accounts
    LEFT JOIN ledger_transaction_entries entries ON entries.account_id = accounts.id
      AND entries.status = 'posted'
    WHERE accounts.id = account_uuid
  ), 0);
END;
$$ LANGUAGE plpgsql;
```

---

### AT-004: Implement Deterministic Account Locking (1.5 hours) 🔄 PARALLEL
**Priority**: P1 - Critical for concurrency and deadlock prevention  
**Dependencies**: AT-001, AT-002  
**Time Estimate**: 1.5 hours

#### Tasks
- [ ] Consistent account ID ordering (ASC) for deadlock prevention
- [ ] 5-second timeout with exponential backoff
- [ ] `SELECT FOR UPDATE NOWAIT` implementation
- [ ] Lock contention monitoring
- [ ] Zero deadlocks in high-concurrency testing (1000+ TPS)

#### SQL Locking Strategy
```sql
-- Deterministic locking to prevent deadlocks
SELECT * FROM ledger_accounts 
WHERE id = ANY($1) 
ORDER BY id ASC 
FOR UPDATE NOWAIT;
```

---

### AT-005: Add Database-Level Double-Entry Validation (1 hour) ⏭️ SEQUENTIAL
**Priority**: P1 - Financial integrity
**Dependencies**: AT-003, AT-004  
**Time Estimate**: 1 hour

#### Tasks
- [ ] PostgreSQL trigger for double-entry validation
- [ ] Precision-aware decimal comparison (0.0001 tolerance)
- [ ] Automatic validation on entry status changes
- [ ] Remove application-level validation logic
- [ ] Add audit logging for validation failures

#### Database Validation Trigger
```sql
CREATE OR REPLACE FUNCTION validate_transaction_balance()
RETURNS TRIGGER AS $$
DECLARE
  balance_diff DECIMAL(20,4);
BEGIN
  SELECT ABS(
    COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0)
  ) INTO balance_diff
  FROM ledger_transaction_entries 
  WHERE transaction_id = NEW.transaction_id AND status = 'posted';
  
  IF balance_diff > 0.0001 THEN
    RAISE EXCEPTION 'Double-entry validation failed for transaction %. Imbalance: %', 
      NEW.transaction_id, balance_diff;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_double_entry
  AFTER INSERT OR UPDATE OF status ON ledger_transaction_entries
  FOR EACH ROW 
  WHEN (NEW.status = 'posted')
  EXECUTE FUNCTION validate_transaction_balance();
```

---

## Phase 3: Service Integration (3 hours) - SEQUENTIAL

### AT-006: Connect Service Layer to Atomic Repository (2 hours) ⏭️ SEQUENTIAL
**Priority**: P1 - Required for API functionality  
**Dependencies**: AT-001 through AT-005  
**Time Estimate**: 2 hours

#### Tasks
- [ ] Update `LedgerTransactionService` method calls
- [ ] Database exception handling and error mapping
- [ ] Transaction context passing
- [ ] Maintain API contract compatibility
- [ ] Replace service-level validation with database-level validation calls

#### Service Integration
```typescript
// Service delegates to SQL-first repository operations
public async createTransactionWithEntries(input: CreateTransactionInput) {
  try {
    // Database handles validation, locking, and balance calculations
    const result = await this.ledgerRepo.createTransactionWithEntries(
      input.ledgerId,
      input.description || null,
      input.entries,
      input.idempotencyKey,
    );
    
    return result;
  } catch (error) {
    // Map database exceptions to service-level errors
    if (error.message.includes('Double-entry validation failed')) {
      throw new DoubleEntryValidationError(error.message);
    }
    if (error.message.includes('Lock timeout')) {
      throw new ConcurrencyError('Transaction temporarily unavailable');
    }
    throw error;
  }
}
```

---

### AT-007: Update Route Layer Error Handling (1 hour) ⏭️ SEQUENTIAL
**Priority**: P2 - API usability  
**Dependencies**: AT-006  
**Time Estimate**: 1 hour

#### Tasks
- [ ] HTTP status code mapping for database errors
- [ ] Lock timeout and validation failure responses
- [ ] Request/response logging for transaction operations
- [ ] API documentation updates
- [ ] Maintain backward compatibility for existing API clients

#### Error Mapping
```typescript
// Route error handling for SQL-first operations
try {
  const result = await this.services.ledgerTransactionService
    .createTransactionWithEntries(request.body);
  return reply.status(201).send(result);
} catch (error) {
  if (error instanceof DoubleEntryValidationError) {
    return reply.status(400).send({
      error: 'INVALID_TRANSACTION',
      message: 'Transaction entries must balance (debits = credits)',
      details: error.message
    });
  }
  if (error instanceof ConcurrencyError) {
    return reply.status(409).send({
      error: 'CONCURRENCY_CONFLICT', 
      message: 'Transaction temporarily unavailable due to locking',
      retryAfter: 1000
    });
  }
  if (error.message.includes('idempotency key')) {
    return reply.status(409).send({
      error: 'DUPLICATE_TRANSACTION',
      message: error.message
    });
  }
  throw error; // Unhandled errors
}
```

---

## Phase 4: Performance & Monitoring (2 hours) - INDEPENDENT

### AT-008: Database Performance Optimization (2 hours) 🔄 INDEPENDENT
**Priority**: P2 - Performance targets  
**Dependencies**: None (can run in parallel with Phase 1-3)  
**Time Estimate**: 2 hours

#### Tasks
- [ ] Database indexes for transaction query patterns
- [ ] Connection pooling optimization for concurrent transactions
- [ ] Query performance monitoring and slow query logging
- [ ] Database performance benchmarks for 1000+ TPS target
- [ ] Optimize SQL queries for <100ms p95 latency

#### Database Optimizations
```sql
-- Performance indexes for atomic operations
CREATE INDEX CONCURRENTLY idx_transaction_entries_account_posted 
  ON ledger_transaction_entries (account_id, status, created DESC)
  WHERE status = 'posted';

CREATE INDEX CONCURRENTLY idx_accounts_lock_version 
  ON ledger_accounts (id, lock_version);

CREATE INDEX CONCURRENTLY idx_transactions_idempotency_active
  ON ledger_transactions (idempotency_key, created)
  WHERE idempotency_key IS NOT NULL;

-- Partial index for active transactions
CREATE INDEX CONCURRENTLY idx_transactions_pending
  ON ledger_transactions (ledger_id, status, created DESC)
  WHERE status IN ('pending', 'posted');
```

---

## Cross-Cutting Concerns

### SQL-First Patterns
All tasks must follow SQL-first principles:
- **Database Transaction Boundaries**: Single SQL transaction for atomic operations
- **SQL-Level Validation**: Move business rules to database constraints and triggers  
- **Query Optimization**: Use appropriate indexes and query patterns for performance
- **Connection Management**: Proper transaction scoping and connection pooling

### TDD Implementation Approach
1. **Red**: Write failing test that demonstrates SQL-first requirement
2. **Green**: Implement minimal SQL-first solution to pass test
3. **Refactor**: Optimize SQL queries and database operations

### AI Agent Coordination
- **Phase 1**: Agent A (imports), Agent B (base methods)
- **Phase 2**: Agent A (balance calculations), Agent B (locking), then sequential validation
- **Phase 3**: Sequential service → route integration
- **Phase 4**: Independent performance agent

### Validation Commands
```bash
# After each task completion
pnpm typecheck        # Type safety
pnpm lint             # Code standards  
pnpm test             # Unit tests
pnpm test:integration # Database tests
pnpm docker && sleep 5 && pnpm test:db # Full database validation
```

---

## Success Criteria

- [ ] All repository methods implemented with SQL-first approach
- [ ] Database-level transaction atomicity with proper rollback
- [ ] Account locking prevents race conditions and deadlocks
- [ ] Balance calculations use SQL SUM operations, not application logic
- [ ] Double-entry validation enforced by database triggers
- [ ] Service layer properly integrated with atomic repository operations
- [ ] API routes handle database-level errors appropriately
- [ ] Performance targets met: <100ms p95, 1000+ TPS, <5% retry rate