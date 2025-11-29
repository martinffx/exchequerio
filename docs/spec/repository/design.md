# Technical Design: Repository Completion

## Architecture Overview

This is a completion task to finalize the established layered architecture (Router → Service → Repository → Database) by resolving import issues, implementing repository methods, and completing service integration. The architecture follows proven patterns from LedgerRepo with entity transformations and organization tenancy throughout.

**See the complete [Entity Relationship Diagram](../../product/erd.md) for detailed database schema visualization.**

**Core Pattern:**
```
API Routes → Services → Repositories → Database Schema
     ↓           ↓           ↓            ↓
JWT Auth → Business Logic → Data Access → PostgreSQL + Drizzle
```

**Completion Status:**
- ✅ Database Schema (Complete with proper relationships)
- ✅ Entity Layer (Complete with transformations)  
- ⚠️ Repository Layer (Imports resolved, methods need completion, architecture cleanup needed)
- ❌ Service Layer (23+ placeholder methods)
- ✅ Route Layer (Complete with proper auth/validation)

## Component Design

### Repository Layer Architecture

#### 0. LedgerRepo - Architecture Cleanup Requirements

**Current State:**
- Core CRUD operations complete and working (getLedger, listLedgers, createLedger, updateLedger, deleteLedger)
- Contains 4 placeholder methods that violate single responsibility principle
- Methods should be moved to appropriate domain repositories

**Required Cleanup:**
- ❌ **REMOVE** `createTransactionWithEntries()` - belongs to LedgerTransactionRepo
- ❌ **REMOVE** `postTransaction()` - belongs to LedgerTransactionRepo  
- ❌ **REMOVE** `getAccountBalance()` - belongs to LedgerAccountRepo
- ❌ **REMOVE** `getAccountBalances()` - belongs to LedgerAccountRepo

**Architectural Rationale:**
- Maintain clean repository boundaries (single responsibility principle)
- Each repository should handle only its domain tables
- Service layer should orchestrate cross-repository operations
- ESLint boundaries will enforce these rules automatically

---

#### 1. LedgerAccountRepo - Completion Requirements

**Current State:**
- ✅ Import issues resolved (TypeID, schema, entities, errors all imported)
- Basic account operations exist but missing CRUD methods
- Balance calculation methods need consolidation and organization tenancy
- Missing entity-based CRUD methods following established LedgerRepo pattern

**Import Status:**
```typescript
// ✅ COMPLETED - All imports already resolved
import { and, desc, eq, like } from "drizzle-orm"
import { TypeID } from "typeid-js"
import { ConflictError, NotFoundError } from "@/errors"
import type {
	BalanceData,
	LedgerAccountID,
	LedgerID,
} from "@/services/entities/LedgerAccountEntity"
import { LedgerAccountEntity } from "@/services/entities/LedgerAccountEntity"
import { LedgerAccountsTable, LedgersTable, LedgerTransactionEntriesTable } from "./schema"
import type { DrizzleDB } from "./types"
```

**Required Methods (Following LedgerRepo Pattern):**
```typescript
// Core CRUD with organization tenancy
public async getLedgerAccount(
  orgId: OrgID, 
  ledgerId: LedgerID, 
  id: LedgerAccountID
): Promise<LedgerAccountEntity> {
  const result = await this.db
    .select()
    .from(LedgerAccountsTable)
    .where(and(
      eq(LedgerAccountsTable.id, id.toString()),
      eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
      eq(LedgerAccountsTable.organizationId, orgId.toString())
    ))
    .limit(1);

  if (result.length === 0) {
    throw new NotFoundError(`Account not found: ${id.toString()}`);
  }

  return LedgerAccountEntity.fromRecord(result[0]);
}

public async listLedgerAccounts(
  orgId: OrgID,
  ledgerId: LedgerID,
  offset: number = 0,
  limit: number = 50
): Promise<LedgerAccountEntity[]> {
  const results = await this.db
    .select()
    .from(LedgerAccountsTable)
    .where(and(
      eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
      eq(LedgerAccountsTable.organizationId, orgId.toString())
    ))
    .orderBy(LedgerAccountsTable.name)
    .offset(offset)
    .limit(limit);

  return results.map(record => LedgerAccountEntity.fromRecord(record));
}

public async createLedgerAccount(
  orgId: OrgID,
  entity: LedgerAccountEntity
): Promise<LedgerAccountEntity> {
  const record = entity.toRecord();
  
  const insertResult = await this.db
    .insert(LedgerAccountsTable)
    .values({
      ...record,
      organizationId: orgId.toString()
    })
    .returning();

  return LedgerAccountEntity.fromRecord(insertResult[0]);
}

public async updateLedgerAccount(
  orgId: OrgID,
  entity: LedgerAccountEntity
): Promise<LedgerAccountEntity> {
  const record = entity.toRecord();
  
  const updateResult = await this.db
    .update(LedgerAccountsTable)
    .set({
      ...record,
      updatedAt: new Date()
    })
    .where(and(
      eq(LedgerAccountsTable.id, entity.id.toString()),
      eq(LedgerAccountsTable.organizationId, orgId.toString()),
      eq(LedgerAccountsTable.lockVersion, record.lockVersion)
    ))
    .returning();

  if (updateResult.length === 0) {
    throw new ConflictError("Account was modified by another transaction");
  }

  return LedgerAccountEntity.fromRecord(updateResult[0]);
}

public async deleteLedgerAccount(
  orgId: OrgID,
  ledgerId: LedgerID,
  id: LedgerAccountID
): Promise<void> {
  // Check for existing transactions first
  const transactionCheck = await this.db
    .select({ count: count() })
    .from(LedgerTransactionEntriesTable)
    .where(and(
      eq(LedgerTransactionEntriesTable.accountId, id.toString()),
      eq(LedgerTransactionEntriesTable.organizationId, orgId.toString())
    ));

  if (transactionCheck[0].count > 0) {
    throw new ConflictError("Cannot delete account with existing transactions");
  }

  const deleteResult = await this.db
    .delete(LedgerAccountsTable)
    .where(and(
      eq(LedgerAccountsTable.id, id.toString()),
      eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
      eq(LedgerAccountsTable.organizationId, orgId.toString())
    ))
    .returning();

  if (deleteResult.length === 0) {
    throw new NotFoundError(`Account not found: ${id.toString()}`);
  }
}

// Comprehensive balance operations (consolidate redundant methods)
public async getAccountBalances(
  orgId: OrgID,
  ledgerId: LedgerID,
  accountId: LedgerAccountID
): Promise<{
  accountId: string
  postedBalance: string
  pendingBalance: string
  availableBalance: string
  normalBalance: "debit" | "credit"
  lockVersion: number
}> {
  // Single query to calculate all three balance types
  // Posted Balance: Completed/settled transactions only
  // Pending Balance: Both pending and posted transactions  
  // Available Balance: Posted balance minus pending outbound transactions
  // Return comprehensive balance information with organization tenancy
}
```

#### 2. LedgerTransactionRepo - Completion Requirements

**Current State:**
- ✅ Import issues resolved (TypeID, schema, entities, errors all imported)
- Has basic structure with `withTransaction` wrapper method
- Has `getLedgerTransaction` method but needs organization tenancy
- Missing complete CRUD methods for consistency
- Missing `createTransactionWithEntries` and `postTransaction` methods (currently in LedgerRepo)

**Import Status:**
```typescript
// ✅ COMPLETED - All imports already resolved
import { and, desc, eq } from "drizzle-orm"
import { ConflictError, NotFoundError } from "@/errors"
import { LedgerTransactionEntity, type LedgerTransactionEntryEntity } from "@/services/entities"
import {
	LedgerAccountsTable,
	LedgersTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "./schema"
import type { DrizzleDB } from "./types"
```

**Required Methods:**
```typescript
// Transaction wrapper (referenced in existing code)
private async withTransaction<T>(
  fn: (tx: typeof this.db) => Promise<T>
): Promise<T> {
  return this.db.transaction(fn);
}

// Entity-based CRUD with organization tenancy
public async getLedgerTransaction(
  orgId: OrgID,
  ledgerId: LedgerID, 
  id: LedgerTransactionID
): Promise<LedgerTransactionEntity> {
  const result = await this.db
    .select()
    .from(LedgerTransactionsTable)
    .where(and(
      eq(LedgerTransactionsTable.id, id.toString()),
      eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
      eq(LedgerTransactionsTable.organizationId, orgId.toString())
    ))
    .limit(1);

  if (result.length === 0) {
    throw new NotFoundError(`Transaction not found: ${id.toString()}`);
  }

  return LedgerTransactionEntity.fromRecord(result[0]);
}

public async listLedgerTransactions(
  orgId: OrgID,
  ledgerId: LedgerID,
  offset: number = 0,
  limit: number = 50
): Promise<LedgerTransactionEntity[]> {
  const results = await this.db
    .select()
    .from(LedgerTransactionsTable)
    .where(and(
      eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
      eq(LedgerTransactionsTable.organizationId, orgId.toString())
    ))
    .orderBy(desc(LedgerTransactionsTable.createdAt))
    .offset(offset)
    .limit(limit);

  return results.map(record => LedgerTransactionEntity.fromRecord(record));
}

// Update existing method to add org tenancy
public async createTransactionWithEntries(
  orgId: OrgID,
  ledgerId: LedgerID,
  description: string | null,
  entries: Array<{
    accountId: string; 
    direction: "debit" | "credit"; 
    amount: string;
  }>,
  idempotencyKey?: string
): Promise<LedgerTransactionEntity> {
  // Validate double-entry accounting
  const debits = entries.filter(e => e.direction === "debit")
    .reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const credits = entries.filter(e => e.direction === "credit")
    .reduce((sum, e) => sum + parseFloat(e.amount), 0);
    
  if (Math.abs(debits - credits) > 0.001) {
    throw new BadRequestError("Transaction entries must balance (debits = credits)");
  }

  return this.withTransaction(async (tx) => {
    // Create transaction with org tenancy
    const transactionId = TypeID.generate("txn");
    
    const transactionResult = await tx
      .insert(LedgerTransactionsTable)
      .values({
        id: transactionId.toString(),
        organizationId: orgId.toString(),
        ledgerId: ledgerId.toString(),
        description,
        status: "posted",
        idempotencyKey,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();

    // Create entries with validation
    const entryInserts = entries.map(entry => ({
      id: TypeID.generate("entry").toString(),
      organizationId: orgId.toString(),
      transactionId: transactionId.toString(),
      accountId: entry.accountId,
      direction: entry.direction,
      amount: entry.amount,
      status: "posted" as const,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    await tx
      .insert(LedgerTransactionEntriesTable)
      .values(entryInserts);

    return LedgerTransactionEntity.fromRecord(transactionResult[0]);
  });
}
```

### Service Layer Integration

#### 1. LedgerAccountService - Integration Strategy

**Current State:** 23 methods throwing "Not implemented" errors
**Repository Dependency:** Currently only has `LedgerRepo` - needs `LedgerAccountRepo`

**Required Constructor Update:**
```typescript
constructor(
  private readonly ledgerAccountRepo: LedgerAccountRepo,
  private readonly ledgerRepo: LedgerRepo
) {}
```

**Method Implementation Breakdown:**

**Core Account Operations (5 methods - HIGH PRIORITY):**
```typescript
// Replace placeholder implementations with repository calls
public async listLedgerAccounts(
  orgId: OrgID,
  ledgerId: LedgerID,
  offset: number = 0,
  limit: number = 50
): Promise<LedgerAccountEntity[]> {
  await this.ledgerRepo.getLedger(orgId, ledgerId); // Verify ledger exists
  return this.ledgerAccountRepo.listLedgerAccounts(orgId, ledgerId, offset, limit);
}

public async getLedgerAccount(
  orgId: OrgID,
  ledgerId: LedgerID,
  id: LedgerAccountID
): Promise<LedgerAccountEntity> {
  return this.ledgerAccountRepo.getLedgerAccount(orgId, ledgerId, id);
}

public async createLedgerAccount(
  orgId: OrgID,
  entity: LedgerAccountEntity
): Promise<LedgerAccountEntity> {
  await this.ledgerRepo.getLedger(orgId, entity.ledgerId); // Verify ledger exists
  return this.ledgerAccountRepo.createLedgerAccount(orgId, entity);
}

public async updateLedgerAccount(
  orgId: OrgID,
  entity: LedgerAccountEntity
): Promise<LedgerAccountEntity> {
  return this.ledgerAccountRepo.updateLedgerAccount(orgId, entity);
}

public async deleteLedgerAccount(
  orgId: OrgID,
  ledgerId: LedgerID,
  id: LedgerAccountID
): Promise<void> {
  return this.ledgerAccountRepo.deleteLedgerAccount(orgId, ledgerId, id);
}
```

**Future Feature Placeholders (18 methods - LOW PRIORITY):**
```typescript
// Category Operations (8 methods)
public async listLedgerAccountCategories(...): Promise<LedgerAccountCategoryEntity[]> {
  throw new NotImplementedError(
    "Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
  );
}

// Settlement Operations (5 methods)  
public async listLedgerAccountSettlements(...): Promise<LedgerAccountSettlementEntity[]> {
  throw new NotImplementedError(
    "Account settlements require LedgerAccountSettlementsTable and LedgerAccountSettlementEntity implementation"
  );
}

// Statement Operations (2 methods)
public async listLedgerAccountStatements(...): Promise<LedgerAccountStatementEntity[]> {
  throw new NotImplementedError(
    "Account statements require LedgerAccountStatementsTable and LedgerAccountStatementEntity implementation"
  );
}

// Balance Monitor Operations (3 methods)
public async listLedgerAccountBalanceMonitors(...): Promise<LedgerAccountBalanceMonitorEntity[]> {
  throw new NotImplementedError(
    "Balance monitors require LedgerAccountBalanceMonitorsTable and LedgerAccountBalanceMonitorEntity implementation"
  );
}
```

#### 2. LedgerTransactionService - Integration Strategy

**Current State:** Service has advanced transaction logic but calls non-existent repo methods
**Repository Dependency:** Currently has `LedgerRepo` - needs `LedgerTransactionRepo` and `LedgerAccountRepo`

**Required Constructor Update:**
```typescript
constructor(
  private readonly ledgerTransactionRepo: LedgerTransactionRepo,
  private readonly ledgerAccountRepo: LedgerAccountRepo,
  private readonly ledgerRepo: LedgerRepo
) {}
```

**Method Call Fixes:**
```typescript
// Fix existing method calls to use correct repositories
- this.ledgerRepo.createTransactionWithEntries → this.ledgerTransactionRepo.createTransactionWithEntries
- this.ledgerRepo.postTransaction → this.ledgerTransactionRepo.postTransaction
- this.ledgerRepo.getAccountBalance → this.ledgerAccountRepo.getAccountBalances  
- this.ledgerRepo.getAccountBalances → this.ledgerAccountRepo.getAccountBalances
```

## Implementation Strategy

### Phase 0: Architecture Cleanup (CRITICAL - 30 minutes)
**Acceptance Criteria:**
- [ ] LedgerRepo contains only ledger-specific CRUD operations
- [ ] All placeholder methods removed from LedgerRepo
- [ ] ESLint boundaries rule updated to prevent cross-repo imports
- [ ] No service layer calls reference removed LedgerRepo methods

**Implementation Steps:**
1. Remove 4 placeholder methods from LedgerRepo.ts
2. Update ESLint boundaries configuration to enforce repository isolation
3. Update service layer method calls to use correct repositories
4. Run `pnpm lint` to verify architectural compliance

### Phase 1: Repository Method Implementation (HIGH - 2 hours)
**Acceptance Criteria:**
- [ ] LedgerAccountRepo implements all CRUD methods with organization tenancy
- [ ] LedgerTransactionRepo implements transaction wrapper and CRUD methods
- [ ] All methods follow LedgerRepo entity transformation patterns
- [ ] Error handling uses consistent LedgerError types
- [ ] Methods pass unit tests with proper fixtures

**Implementation Steps:**
1. **LedgerAccountRepo CRUD Methods (60 min)**
   - Implement `getLedgerAccount` with org tenancy
   - Implement `listLedgerAccounts` with pagination
   - Implement `createLedgerAccount` with entity transformation
   - Implement `updateLedgerAccount` with optimistic locking
   - Implement `deleteLedgerAccount` with constraint checking
   - Implement `getAccountBalances` comprehensive balance calculation

2. **LedgerTransactionRepo Methods (60 min)**
   - Implement `withTransaction` wrapper method
   - Implement `getLedgerTransaction` with org tenancy
   - Implement `listLedgerTransactions` with pagination
   - Implement `createTransactionWithEntries` with double-entry validation
   - Implement `postTransaction` status update method
   - Add organization tenancy enforcement to all methods

### Phase 2: Repository Method Implementation (HIGH - 2 hours)
**Acceptance Criteria:**
- [ ] LedgerAccountRepo implements all CRUD methods with organization tenancy
- [ ] LedgerTransactionRepo implements transaction wrapper and CRUD methods
- [ ] All methods follow LedgerRepo entity transformation patterns
- [ ] Error handling uses consistent LedgerError types
- [ ] Methods pass unit tests with proper fixtures

**Implementation Steps:**
1. **LedgerAccountRepo CRUD Methods (60 min)**
   - Implement `getLedgerAccount` with org tenancy
   - Implement `listLedgerAccounts` with pagination
   - Implement `createLedgerAccount` with entity transformation
   - Implement `updateLedgerAccount` with optimistic locking
   - Implement `deleteLedgerAccount` with constraint checking

2. **LedgerTransactionRepo Methods (60 min)**
   - Implement `withTransaction` wrapper method
   - Implement `getLedgerTransaction` with org tenancy
   - Implement `listLedgerTransactions` with pagination
   - Update `createTransactionWithEntries` to add org tenancy
   - Add double-entry validation logic

**TDD Test Structure:**
```typescript
// Test file: src/repo/LedgerAccountRepo.test.ts
describe("LedgerAccountRepo", () => {
  let db: DrizzleDB;
  let repo: LedgerAccountRepo;
  let fixtures: TestFixtures;
  
  beforeEach(async () => {
    db = await setupTestDatabase();
    repo = new LedgerAccountRepo(db);
    fixtures = await createTestFixtures(db);
  });

  describe("getLedgerAccount", () => {
    it("should return account with correct organization tenancy", async () => {
      const account = await repo.getLedgerAccount(
        fixtures.orgId, 
        fixtures.ledgerId, 
        fixtures.accountId
      );
      
      expect(account).toBeInstanceOf(LedgerAccountEntity);
      expect(account.organizationId).toEqual(fixtures.orgId);
    });
    
    it("should throw NotFoundError for wrong organization", async () => {
      const wrongOrgId = TypeID.generate("org");
      
      await expect(
        repo.getLedgerAccount(wrongOrgId, fixtures.ledgerId, fixtures.accountId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("createLedgerAccount", () => {
    it("should create account with entity transformation", async () => {
      const entity = LedgerAccountEntity.fromRequest({
        name: "Test Account",
        type: "asset",
        ledgerId: fixtures.ledgerId.toString()
      });
      
      const created = await repo.createLedgerAccount(fixtures.orgId, entity);
      
      expect(created).toBeInstanceOf(LedgerAccountEntity);
      expect(created.name).toBe("Test Account");
    });
  });

  describe("updateLedgerAccount", () => {
    it("should handle optimistic locking", async () => {
      const account = await repo.getLedgerAccount(
        fixtures.orgId, 
        fixtures.ledgerId, 
        fixtures.accountId
      );
      
      // Simulate concurrent update
      await db.update(LedgerAccountsTable)
        .set({ lockVersion: account.lockVersion + 1 })
        .where(eq(LedgerAccountsTable.id, account.id.toString()));
      
      await expect(
        repo.updateLedgerAccount(fixtures.orgId, account)
      ).rejects.toThrow(ConflictError);
    });
  });
});
```

### Phase 3: Service Integration (MEDIUM - 1.5 hours)
**Acceptance Criteria:**
- [ ] LedgerAccountService constructor updated with proper dependencies
- [ ] 5 core account operation methods implemented (not throwing errors)
- [ ] LedgerTransactionService constructor updated with proper dependencies  
- [ ] Existing method calls fixed to use correct repositories
- [ ] Service integration tests pass

**Implementation Steps:**
1. **LedgerAccountService Integration (45 min)**
   - Update constructor to inject LedgerAccountRepo
   - Implement 5 core CRUD methods calling repository layer
   - Update plugin registration for new dependency

2. **LedgerTransactionService Integration (45 min)**
   - Update constructor to inject LedgerTransactionRepo and LedgerAccountRepo
   - Fix existing method calls to use correct repositories
   - Update plugin registration for new dependencies

### Phase 4: Clean Placeholders (LOW - 30 minutes)
**Acceptance Criteria:**
- [ ] All "Not implemented" errors replaced with structured NotImplementedError
- [ ] Future feature requirements documented in error messages
- [ ] API responses provide clear guidance for unsupported features

**Implementation Steps:**
1. Replace generic placeholder errors with NotImplementedError class
2. Add clear messages indicating required entities/tables for future features
3. Document implementation requirements in error messages

## Technical Specifications

### Entity Integration Requirements

**Entity Transformation Pattern (MUST FOLLOW):**
```typescript
// All repositories must use this pattern consistently
// Read operations
const result = await this.db
  .select()
  .from(Table)  
  .where(and(
    eq(Table.id, id.toString()),
    eq(Table.organizationId, orgId.toString()) // REQUIRED: Organization tenancy
  ))
  .limit(1);

if (result.length === 0) {
  throw new NotFoundError(`Resource not found: ${id.toString()}`);
}

return Entity.fromRecord(result[0]); // REQUIRED: Entity transformation

// Write operations  
const record = entity.toRecord(); // REQUIRED: Entity transformation
const insertResult = await this.db
  .insert(Table)
  .values({
    ...record,
    organizationId: orgId.toString() // REQUIRED: Organization tenancy
  })
  .returning();

return Entity.fromRecord(insertResult[0]); // REQUIRED: Entity transformation
```

**Required Entity Methods (Verify Existence):**
- `LedgerAccountEntity.fromRecord()` ✅
- `LedgerAccountEntity.toRecord()` ✅
- `LedgerTransactionEntity.fromRecord()` ⚠️ (Verify)
- `LedgerTransactionEntity.toRecord()` ⚠️ (Verify)

### Database Schema Integration

**Organization Tenancy (CRITICAL REQUIREMENT):**
All repository queries MUST include organization filtering:
```sql
WHERE table.organization_id = $1 AND table.other_conditions = $2
```

**Optimistic Locking (REQUIRED FOR UPDATES):**
```sql
UPDATE table SET 
  column = $1, 
  lock_version = lock_version + 1,
  updated_at = NOW()
WHERE id = $2 AND organization_id = $3 AND lock_version = $4
```

**Transaction Integrity (REQUIRED FOR FINANCIAL DATA):**
```typescript
// All multi-table operations must use database transactions
return this.db.transaction(async (tx) => {
  // Multiple related operations
  const result1 = await tx.insert(Table1).values(...);
  const result2 = await tx.insert(Table2).values(...);
  return { result1, result2 };
});
```

### Plugin System Integration

**Repository Plugin Registration:**
```typescript
// Update src/repo/index.ts to export new repositories
export { LedgerAccountRepo } from "./LedgerAccountRepo";
export { LedgerTransactionRepo } from "./LedgerTransactionRepo";

// Update RepoPlugin to register new repositories
async function RepoPlugin(fastify: FastifyInstance) {
  const db = fastify.db;
  
  const repos = {
    ledgerRepo: new LedgerRepo(db),
    ledgerAccountRepo: new LedgerAccountRepo(db), // NEW
    ledgerTransactionRepo: new LedgerTransactionRepo(db), // NEW
  };
  
  fastify.decorate("repos", repos);
}
```

**Service Plugin Registration:**
```typescript
// Update ServicePlugin to inject new repository dependencies
async function ServicePlugin(fastify: FastifyInstance) {
  const { ledgerRepo, ledgerAccountRepo, ledgerTransactionRepo } = fastify.repos;
  
  const services = {
    ledgerService: new LedgerService(ledgerRepo),
    ledgerAccountService: new LedgerAccountService(
      ledgerAccountRepo, // NEW DEPENDENCY
      ledgerRepo
    ),
    ledgerTransactionService: new LedgerTransactionService(
      ledgerTransactionRepo, // NEW DEPENDENCY
      ledgerAccountRepo, // NEW DEPENDENCY
      ledgerRepo
    ),
  };
  
  fastify.decorate("services", services);
}
```

## Validation Approach

### Phase 1 Validation: Import Resolution
```bash
# Verify TypeScript compilation
pnpm typecheck

# Should pass without errors
# If errors exist, they indicate missing imports or incorrect paths
```

### Phase 2 Validation: Repository Methods  
```bash
# Run repository tests
pnpm test src/repo/LedgerAccountRepo.test.ts
pnpm test src/repo/LedgerTransactionRepo.test.ts

# Verify database operations
pnpm docker # Start test database
pnpm test # Run all tests

# Check test coverage
pnpm test:ci # Generates coverage report
```

### Phase 3 Validation: Service Integration
```bash
# Run service tests
pnpm test src/services/LedgerAccountService.test.ts
pnpm test src/services/LedgerTransactionService.test.ts

# Verify API endpoints
pnpm dev # Start development server
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/ledgers/$LEDGER_ID/accounts

# Should return accounts instead of "Not implemented" error
```

### Phase 4 Validation: Complete System
```bash
# Full test suite
pnpm test

# Integration test - create ledger account via API
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Account","type":"asset"}' \
  http://localhost:3000/api/ledgers/$LEDGER_ID/accounts

# Should create account and return proper response
```

### Acceptance Criteria Summary

**Phase 1 - Import Resolution (CRITICAL):**
- [ ] All TypeScript compilation errors resolved
- [ ] Import statements correctly reference schema tables and entities
- [ ] No missing dependency errors in IDE

**Phase 2 - Repository Implementation (HIGH):**
- [ ] All repository methods implemented following LedgerRepo patterns
- [ ] Organization tenancy enforced in all queries  
- [ ] Entity transformations used consistently (fromRecord/toRecord)
- [ ] Error handling uses structured LedgerError types
- [ ] Unit tests pass with proper fixtures

**Phase 3 - Service Integration (MEDIUM):**
- [ ] Service constructors updated with repository dependencies
- [ ] 5 core LedgerAccountService methods no longer throw "Not implemented"
- [ ] LedgerTransactionService method calls use correct repositories
- [ ] Plugin system properly registers new dependencies
- [ ] Integration tests pass end-to-end

**Phase 4 - Clean Placeholders (LOW):**
- [ ] Future feature methods use NotImplementedError with clear messages
- [ ] Error messages document required entities/tables for implementation
- [ ] API provides helpful guidance for unsupported features

**Overall System Validation:**
- [ ] Full test suite passes (`pnpm test`)
- [ ] API endpoints return proper responses (not "Not implemented")
- [ ] Double-entry ledger operations work correctly
- [ ] Organization tenancy prevents cross-tenant data access
- [ ] Performance remains acceptable with new repository layer

This comprehensive design provides clear implementation guidance for completing the repository layer while maintaining architectural consistency and enabling full feature functionality through the established layered architecture pattern.