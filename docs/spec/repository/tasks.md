# Repository Implementation Checklist

## Overview

**Estimated Completion**: 13.5 hours (with parallel execution)  
**Critical Path**: Phase 1 → Phase 2 → Phase 3  
**Current Blocker**: Missing repository CRUD implementations

## Phase 1: Foundation (Repository Layer) - 6.5 hours

### RC-001: Fix LedgerAccountRepo Import Issues (0.5 hours) ⚠️ CRITICAL BLOCKER
**Priority**: Critical Blocker  
**Dependencies**: None  
**Time Estimate**: 0.5 hours

#### Tasks
- [ ] Import `TypeID` from `typeid-js`
- [ ] Import schema tables (`LedgerAccountsTable`, `LedgersTable`, `LedgerTransactionEntriesTable`)
- [ ] Import Drizzle ORM operators (`eq`, `and`, `desc`, `sum`)
- [ ] Import entities (`LedgerAccountEntity`, `LedgerAccountID`, `LedgerID`, `OrgID`)
- [ ] Import error types (`NotFoundError`, `ConflictError`)
- [ ] Verify TypeScript compilation succeeds

#### File: `src/repo/LedgerAccountRepo.ts`

---

### RC-002: Fix LedgerTransactionRepo Import Issues (0.5 hours) ⚠️ CRITICAL BLOCKER
**Priority**: Critical Blocker  
**Dependencies**: None  
**Time Estimate**: 0.5 hours

#### Tasks
- [ ] Import `TypeID` from `typeid-js`
- [ ] Import schema tables (`LedgerTransactionsTable`, `LedgerTransactionEntriesTable`, `LedgerAccountsTable`)
- [ ] Import Drizzle ORM operators (`eq`, `and`, `desc`, `sum`)
- [ ] Import entities (`LedgerTransactionEntity`, `LedgerTransactionID`, `LedgerAccountID`, `OrgID`)
- [ ] Import error types (`NotFoundError`, `ConflictError`)
- [ ] Verify TypeScript compilation succeeds

#### File: `src/repo/LedgerTransactionRepo.ts`

---

### RC-003: Implement LedgerAccountRepo CRUD Operations (1.5 hours) 🔄 PARALLEL
**Priority**: Core Foundation  
**Dependencies**: RC-001  
**Time Estimate**: 1.5 hours

#### Tasks
- [ ] `getLedgerAccount(ledgerId, accountId)` - Single account retrieval
- [ ] `listLedgerAccounts(ledgerId)` - List accounts with organization tenancy
- [ ] `createLedgerAccount(ledgerId, accountData)` - Create with validation
- [ ] `updateLedgerAccount(ledgerId, accountId, updateData)` - Update with optimistic locking
- [ ] `deleteLedgerAccount(ledgerId, accountId)` - Delete with entry validation
- [ ] Organization-scoped queries in all methods
- [ ] SELECT...FOR UPDATE locking for balance operations
- [ ] Entity.fromRecord/toRecord transformations
- [ ] Proper error handling (NotFoundError, ValidationError)

#### File: `src/repo/LedgerAccountRepo.ts`

---

### RC-004: Implement LedgerTransactionRepo CRUD Operations (1.5 hours) 🔄 PARALLEL
**Priority**: Core Foundation  
**Dependencies**: RC-002  
**Time Estimate**: 1.5 hours

#### Tasks
- [ ] `withTransaction(callback)` - Database transaction wrapper
- [ ] `getLedgerTransaction(ledgerId, transactionId)` - Single transaction retrieval
- [ ] `listLedgerTransactions(ledgerId)` - List with organization tenancy
- [ ] `createTransactionWithEntries(ledgerId, transactionData)` - Atomic transaction creation
- [ ] Database transaction wrapper for atomicity
- [ ] Double-entry balance validation (debits = credits)
- [ ] Organization tenancy enforcement
- [ ] Atomic transaction + entries creation
- [ ] Proper error handling for financial operations

#### File: `src/repo/LedgerTransactionRepo.ts`

---

### RC-005: Test LedgerAccountRepo Methods (2 hours) ⏭️ SEQUENTIAL
**Priority**: Quality Assurance  
**Dependencies**: RC-003  
**Time Estimate**: 2 hours

#### Tasks
- [ ] Test all CRUD operations (create, read, update, delete)
- [ ] Test organization boundary enforcement
- [ ] Test constraint violation handling
- [ ] Test concurrent access scenarios with optimistic locking
- [ ] Test balance calculation accuracy
- [ ] Achieve >90% code coverage
- [ ] Use LedgerRepo.test.ts as template

#### File: `src/repo/LedgerAccountRepo.test.ts`

---

### RC-006: Test LedgerTransactionRepo Methods (2 hours) ⏭️ SEQUENTIAL
**Priority**: Quality Assurance  
**Dependencies**: RC-004  
**Time Estimate**: 2 hours

#### Tasks
- [ ] Test transaction creation with entries
- [ ] Test double-entry balance validation
- [ ] Test concurrent transaction handling
- [ ] Test rollback scenarios
- [ ] Test organization tenancy enforcement
- [ ] Achieve >90% code coverage
- [ ] Verify financial integrity

#### File: `src/repo/LedgerTransactionRepo.test.ts`

---

## Phase 2: Business Logic (Service Layer) - 5 hours

### RC-007: Update LedgerAccountService Constructor (0.5 hours) ⏭️ SEQUENTIAL
**Priority**: Integration Foundation  
**Dependencies**: RC-003  
**Time Estimate**: 0.5 hours

#### Tasks
- [ ] Add `private ledgerAccountRepo: LedgerAccountRepo` to constructor
- [ ] Update service method signatures to use repository
- [ ] Follow dependency injection pattern from existing services

#### File: `src/services/LedgerAccountService.ts`

---

### RC-008: Implement LedgerAccountService Methods (1.5 hours) ⏭️ SEQUENTIAL
**Priority**: Business Logic  
**Dependencies**: RC-007  
**Time Estimate**: 1.5 hours

#### Tasks
- [ ] `getLedgerAccount(ledgerId, accountId)` - Delegate to repository
- [ ] `listLedgerAccounts(ledgerId)` - Delegate with business logic
- [ ] `createLedgerAccount(ledgerId, accountData)` - Validate then create
- [ ] `updateLedgerAccount(ledgerId, accountId, updateData)` - Business rules then update
- [ ] `deleteLedgerAccount(ledgerId, accountId)` - Business validation then delete
- [ ] Add business rule validation
- [ ] Handle repository errors appropriately
- [ ] Maintain API contract compatibility

#### File: `src/services/LedgerAccountService.ts`

---

### RC-009: Update LedgerTransactionService Constructor (0.5 hours) ⏭️ SEQUENTIAL
**Priority**: Integration Foundation  
**Dependencies**: RC-003, RC-004  
**Time Estimate**: 0.5 hours

#### Tasks
- [ ] Add `private ledgerTransactionRepo: LedgerTransactionRepo` to constructor
- [ ] Update service method signatures to use repository
- [ ] Follow dependency injection pattern

#### File: `src/services/LedgerTransactionService.ts`

---

### RC-010: Fix LedgerTransactionService Method Calls (1 hour) ⏭️ SEQUENTIAL
**Priority**: Integration  
**Dependencies**: RC-009  
**Time Estimate**: 1 hour

#### Tasks
- [ ] Update all method calls to use repository instead of placeholders
- [ ] Fix method signatures and return types
- [ ] Handle repository error responses
- [ ] Maintain existing API contracts

#### File: `src/services/LedgerTransactionService.ts`

---

### RC-011: Test LedgerAccountService Integration (1.5 hours) ⏭️ SEQUENTIAL
**Priority**: Quality Assurance  
**Dependencies**: RC-008  
**Time Estimate**: 1.5 hours

#### Tasks
- [ ] Test service-repository integration
- [ ] Test business rule validation
- [ ] Test error handling and mapping
- [ ] Test API contract maintenance
- [ ] Mock repository for isolated testing

#### File: `src/services/LedgerAccountService.test.ts`

---

### RC-012: Test LedgerTransactionService Integration (1.5 hours) ⏭️ SEQUENTIAL
**Priority**: Quality Assurance  
**Dependencies**: RC-010  
**Time Estimate**: 1.5 hours

#### Tasks
- [ ] Test service-repository integration
- [ ] Test transaction business logic
- [ ] Test error handling for financial operations
- [ ] Test double-entry validation delegation
- [ ] Mock repository for isolated testing

#### File: `src/services/LedgerTransactionService.test.ts`

---

## Phase 3: API Layer (System Integration) - 2 hours

### RC-013: Update Repo Plugin Registration (0.5 hours) ⏭️ SEQUENTIAL
**Priority**: System Integration  
**Dependencies**: RC-003, RC-004  
**Time Estimate**: 0.5 hours

#### Tasks
- [ ] Register LedgerAccountRepo in RepoPlugin
- [ ] Register LedgerTransactionRepo in RepoPlugin
- [ ] Update dependency injection configuration
- [ ] Test plugin registration

#### File: `src/repo/index.ts` (or plugin file)

---

### RC-014: Update Service Plugin Registration (0.5 hours) ⏭️ SEQUENTIAL
**Priority**: System Integration  
**Dependencies**: RC-007, RC-009  
**Time Estimate**: 0.5 hours

#### Tasks
- [ ] Register updated services in ServicePlugin
- [ ] Update dependency injection wiring
- [ ] Test service plugin registration

#### File: `src/services/index.ts` (or plugin file)

---

### RC-015: Clean Placeholder Implementations (0.5 hours) ⏭️ SEQUENTIAL
**Priority**: Code Cleanup  
**Dependencies**: RC-008  
**Time Estimate**: 0.5 hours

#### Tasks
- [ ] Remove placeholder method implementations
- [ ] Clean up unused imports
- [ ] Remove TODO comments
- [ ] Ensure consistent code style

#### Files: Various service files

---

### RC-016: Test End-to-End Integration (1 hour) ⏭️ SEQUENTIAL
**Priority**: System Validation  
**Dependencies**: RC-013, RC-014  
**Time Estimate**: 1 hour

#### Tasks
- [ ] Test complete request flow (Route → Service → Repository → Database)
- [ ] Test organization tenancy enforcement
- [ ] Test error propagation through layers
- [ ] Validate system integration

#### File: Integration test file

---

## Cross-Cutting Concerns

### Architecture Patterns
- **Layered Architecture**: Router → Service → Repository → Database
- **Dependency Injection**: Plugin-based registration
- **Entity Transformations**: fromRecord/toRecord patterns
- **Organization Tenancy**: Cross-org access prevention

### Quality Standards
- **TypeScript Compilation**: Must pass without errors
- **Code Coverage**: Target >90% for all layers
- **Error Handling**: Proper exception types and propagation
- **Business Logic**: Separated from data access concerns

### Validation Commands
```bash
# After each phase completion
pnpm typecheck        # Type safety
pnpm lint             # Code standards  
pnpm test             # Unit tests
pnpm test:integration # Integration tests
```

---

## Success Criteria

- [ ] All repository CRUD operations implemented with organization tenancy
- [ ] All service methods delegate to repositories with business logic
- [ ] TypeScript compilation succeeds without errors
- [ ] >90% test coverage achieved across all layers
- [ ] End-to-end integration validates complete request flow
- [ ] Organization boundary enforcement verified
- [ ] Error handling works correctly across all layers