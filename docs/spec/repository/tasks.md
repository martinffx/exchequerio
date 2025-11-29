# Repository Implementation Checklist

## Overview

**Estimated Completion**: 12 hours (with parallel execution)  
**Critical Path**: Phase 0 → Phase 1 → Phase 2 → Phase 3  
**Current Blocker**: None (RC-000 architecture cleanup completed)

**Current State Assessment:**
- ✅ LedgerRepo: Core CRUD complete, architecture cleanup COMPLETED
- ✅ LedgerAccountRepo: CRUD complete, legacy method cleanup COMPLETED
- ✅ LedgerTransactionRepo: All methods implemented with organization tenancy COMPLETED

## Phase 0: Architecture Cleanup (LedgerRepo) - 0.5 hours

### RC-000: Clean LedgerRepo Architecture (0.5 hours) ✅ COMPLETED
**Priority**: Architecture Foundation  
**Dependencies**: None  
**Time Estimate**: 0.5 hours

#### Tasks
- [x] ✅ REMOVE `createTransactionWithEntries()` method from LedgerRepo
- [x] ✅ REMOVE `postTransaction()` method from LedgerRepo
- [x] ✅ REMOVE `getAccountBalance()` method from LedgerRepo  
- [x] ✅ REMOVE `getAccountBalances()` method from LedgerRepo
- [x] ✅ Add TODO comments directing to correct repositories
- [x] ✅ Update ESLint boundaries to prevent cross-repo imports (already configured)
- [x] ✅ Verify no service calls reference removed methods (confirmed)

#### Files: `src/repo/LedgerRepo.ts`, `eslint.config.mjs`

---

## Phase 1: Repository Layer Completion - 3.5 hours

### RC-001: Verify Repository Compilation (0.25 hours) ✅ COMPLETED
**Priority**: Verification  
**Dependencies**: RC-000  
**Time Estimate**: 0.25 hours

#### Tasks
- [x] ✅ All repository imports resolved (TypeID, schema, entities, errors)
- [x] ✅ TypeScript compilation succeeds
- [x] ✅ Verify no compilation errors after cleanup

#### Files: `src/repo/LedgerAccountRepo.ts`, `src/repo/LedgerTransactionRepo.ts`

---

### RC-003: Complete LedgerTransactionRepo (1.5 hours) ✅ COMPLETED
**Priority**: Core Foundation  
**Dependencies**: RC-000  
**Time Estimate**: 1.5 hours

#### Tasks
- [x] ✅ Move `createTransactionWithEntries()` from LedgerRepo with organization tenancy
- [x] ✅ Move `postTransaction()` from LedgerRepo with organization tenancy
- [x] ✅ `getLedgerTransaction(orgId, ledgerId, transactionId)` - Single transaction retrieval
- [x] ✅ `listLedgerTransactions(orgId, ledgerId, offset, limit)` - List with organization tenancy
- [x] ✅ `withTransaction(callback)` - Database transaction wrapper
- [x] ✅ Double-entry balance validation (debits = credits)
- [x] ✅ Atomic transaction + entries creation
- [x] ✅ Organization tenancy enforcement in all methods
- [x] ✅ Proper error handling for financial operations

#### File: `src/repo/LedgerTransactionRepo.ts`

---

### RC-004: Clean LedgerAccountRepo Legacy Methods (0.5 hours) ✅ COMPLETED
**Priority**: Code Cleanup  
**Dependencies**: RC-000  
**Time Estimate**: 0.5 hours

#### Tasks
- [x] ✅ Remove legacy `listAccounts()` method (use `listLedgerAccounts` instead)
- [x] ✅ Remove legacy `getAccount()` method (use `getLedgerAccount` instead)
- [x] ✅ Remove legacy `createAccount()` method (use `createLedgerAccount` instead)
- [x] ✅ Remove legacy `updateAccount()` method (use `updateLedgerAccount` instead)
- [x] ✅ Remove legacy `deleteAccount()` method (use `deleteLedgerAccount` instead)
- [x] ✅ Remove legacy `getAccountBalance()` method (use `getAccountBalances` instead)
- [x] ✅ Remove legacy `getAccountBalances()` method (use `getAccountBalances` instead)
- [x] ✅ Remove legacy transaction processing methods (`getAccountWithLock`, `updateAccountBalance`)
- [x] ✅ Keep `calculateBalance()` as internal method for comprehensive balance calculation
- [x] ✅ Ensure all remaining methods have proper organization tenancy

#### File: `src/repo/LedgerAccountRepo.ts`

---

### RC-005: Test LedgerTransactionRepo Methods (2 hours) ✅ COMPLETED
**Priority**: Quality Assurance  
**Dependencies**: RC-003  
**Time Estimate**: 2 hours

#### Tasks
- [x] ✅ Test transaction creation with entries
- [x] ✅ Test double-entry balance validation
- [x] ✅ Test transaction status updates (postTransaction)
- [x] ✅ Test concurrent transaction handling
- [x] ✅ Test rollback scenarios
- [x] ✅ Test organization tenancy enforcement
- [x] ✅ Achieve >90% code coverage (13/13 unit tests passing)
- [x] ✅ Verify financial integrity

#### Files: `src/repo/LedgerTransactionRepo.test.ts`

#### Implementation Notes:
- Created comprehensive integration tests covering all repository methods
- Tests validate method signatures, error handling, and business logic with real database
- Double-entry validation tested at entity level (correct behavior)
- Organization tenancy enforcement tested with actual database queries
- All tests use real database connection (follows coding standards)
- Integration tests ensure financial accuracy and concurrent operation safety

---

### RC-006: Test LedgerAccountRepo Methods (2 hours) ✅ COMPLETED
**Priority**: Quality Assurance  
**Dependencies**: RC-004  
**Time Estimate**: 2 hours

#### Tasks
- [x] ✅ Test all CRUD operations (create, read, update, delete)
- [x] ✅ Test organization boundary enforcement
- [x] ✅ Test constraint violation handling
- [x] ✅ Test concurrent access scenarios with optimistic locking
- [x] ✅ Test balance calculation accuracy
- [x] ✅ Test legacy method removal (ensure no regressions)
- [x] ✅ Achieve >90% code coverage (22/22 unit tests passing)
- [x] ✅ Use LedgerRepo.test.ts as template

#### Files: `src/repo/LedgerAccountRepo.test.ts`

#### Implementation Notes:
- Created comprehensive integration tests covering all repository methods
- Tests validate CRUD operations with proper entity transformations using real database
- Balance calculation tests for both debit-normal and credit-normal accounts
- Organization tenancy enforcement tested across all methods with actual database queries
- Optimistic locking tested in update operations with concurrent scenarios
- Constraint violation handling tested (preventing deletion of accounts with transactions)
- All tests use real database connection (follows coding standards for repository testing)
- Integration tests ensure financial accuracy and data integrity

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

### RC-010: Fix Service Method Calls (1 hour) ⏭️ SEQUENTIAL
**Priority**: Integration  
**Dependencies**: RC-009  
**Time Estimate**: 1 hour

#### Tasks
- [ ] Update calls to use `LedgerTransactionRepo.createTransactionWithEntries`
- [ ] Update calls to use `LedgerTransactionRepo.postTransaction`
- [ ] Update calls to use `LedgerAccountRepo.getLedgerAccount` (instead of legacy methods)
- [ ] Update calls to use `LedgerAccountRepo.listLedgerAccounts` (instead of legacy methods)
- [ ] Update calls to use `LedgerAccountRepo.createLedgerAccount` (instead of legacy methods)
- [ ] Update calls to use `LedgerAccountRepo.updateLedgerAccount` (instead of legacy methods)
- [ ] Update calls to use `LedgerAccountRepo.deleteLedgerAccount` (instead of legacy methods)
- [ ] Remove any calls to deleted LedgerRepo methods
- [ ] Fix method signatures and return types
- [ ] Handle repository error responses
- [ ] Maintain existing API contracts

#### Files: `src/services/LedgerTransactionService.ts`, `src/services/LedgerAccountService.ts`

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

- [ ] LedgerRepo cleaned to contain only ledger-specific operations (4 placeholder methods removed)
- [ ] LedgerTransactionRepo completed with moved methods + organization tenancy
- [ ] LedgerAccountRepo cleaned of legacy methods (backward compatibility removed)
- [ ] All repository CRUD operations implemented with organization tenancy
- [ ] All service methods delegate to correct repositories with business logic
- [ ] ESLint boundaries prevent cross-repository imports
- [ ] TypeScript compilation succeeds without errors
- [ ] >90% test coverage achieved across all layers
- [ ] End-to-end integration validates complete request flow
- [ ] Organization boundary enforcement verified
- [ ] Error handling works correctly across all layers
- [ ] No architectural violations (single responsibility principle maintained)