# Repository Implementation Checklist

## Overview

**Estimated Completion**: 12 hours (with parallel execution)  
**Critical Path**: Phase 0 → Phase 1 → Phase 2 → Phase 3  
**Current Blocker**: LedgerRepo architecture cleanup (cross-repository method violations)

**Current State Assessment:**
- ✅ LedgerRepo: Core CRUD complete, needs cleanup of 4 placeholder methods
- ✅ LedgerAccountRepo: CRUD complete, needs legacy method cleanup
- ❌ LedgerTransactionRepo: Needs to receive methods from LedgerRepo + completion

## Phase 0: Architecture Cleanup (LedgerRepo) - 0.5 hours

### RC-000: Clean LedgerRepo Architecture (0.5 hours) ⚠️ CRITICAL BLOCKER
**Priority**: Architecture Foundation  
**Dependencies**: None  
**Time Estimate**: 0.5 hours

#### Tasks
- [ ] REMOVE `createTransactionWithEntries()` method from LedgerRepo
- [ ] REMOVE `postTransaction()` method from LedgerRepo
- [ ] REMOVE `getAccountBalance()` method from LedgerRepo  
- [ ] REMOVE `getAccountBalances()` method from LedgerRepo
- [ ] Add TODO comments directing to correct repositories
- [ ] Update ESLint boundaries to prevent cross-repo imports
- [ ] Verify no service calls reference removed methods

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
- [ ] Verify no compilation errors after cleanup

#### Files: `src/repo/LedgerAccountRepo.ts`, `src/repo/LedgerTransactionRepo.ts`

---

### RC-003: Complete LedgerTransactionRepo (1.5 hours) 🔄 PARALLEL
**Priority**: Core Foundation  
**Dependencies**: RC-000  
**Time Estimate**: 1.5 hours

#### Tasks
- [ ] Move `createTransactionWithEntries()` from LedgerRepo with organization tenancy
- [ ] Move `postTransaction()` from LedgerRepo with organization tenancy
- [ ] `getLedgerTransaction(orgId, ledgerId, transactionId)` - Single transaction retrieval
- [ ] `listLedgerTransactions(orgId, ledgerId, offset, limit)` - List with organization tenancy
- [ ] `withTransaction(callback)` - Database transaction wrapper
- [ ] Double-entry balance validation (debits = credits)
- [ ] Atomic transaction + entries creation
- [ ] Organization tenancy enforcement in all methods
- [ ] Proper error handling for financial operations

#### File: `src/repo/LedgerTransactionRepo.ts`

---

### RC-004: Clean LedgerAccountRepo Legacy Methods (0.5 hours) 🔄 PARALLEL
**Priority**: Code Cleanup  
**Dependencies**: RC-000  
**Time Estimate**: 0.5 hours

#### Tasks
- [ ] Remove legacy `listAccounts()` method (use `listLedgerAccounts` instead)
- [ ] Remove legacy `getAccount()` method (use `getLedgerAccount` instead)
- [ ] Remove legacy `createAccount()` method (use `createLedgerAccount` instead)
- [ ] Remove legacy `updateAccount()` method (use `updateLedgerAccount` instead)
- [ ] Remove legacy `deleteAccount()` method (use `deleteLedgerAccount` instead)
- [ ] Remove legacy `getAccountBalance()` method (use `getAccountBalances` instead)
- [ ] Remove legacy `getAccountBalances()` method (use `getAccountBalances` instead)
- [ ] Remove legacy transaction processing methods (`getAccountWithLock`, `updateAccountBalance`)
- [ ] Keep `calculateBalance()` as internal method for comprehensive balance calculation
- [ ] Ensure all remaining methods have proper organization tenancy

#### File: `src/repo/LedgerAccountRepo.ts`

---

### RC-005: Test LedgerTransactionRepo Methods (2 hours) ⏭️ SEQUENTIAL
**Priority**: Quality Assurance  
**Dependencies**: RC-003  
**Time Estimate**: 2 hours

#### Tasks
- [ ] Test transaction creation with entries
- [ ] Test double-entry balance validation
- [ ] Test transaction status updates (postTransaction)
- [ ] Test concurrent transaction handling
- [ ] Test rollback scenarios
- [ ] Test organization tenancy enforcement
- [ ] Achieve >90% code coverage
- [ ] Verify financial integrity

#### File: `src/repo/LedgerTransactionRepo.test.ts`

---

### RC-006: Test LedgerAccountRepo Methods (2 hours) ⏭️ SEQUENTIAL
**Priority**: Quality Assurance  
**Dependencies**: RC-004  
**Time Estimate**: 2 hours

#### Tasks
- [ ] Test all CRUD operations (create, read, update, delete)
- [ ] Test organization boundary enforcement
- [ ] Test constraint violation handling
- [ ] Test concurrent access scenarios with optimistic locking
- [ ] Test balance calculation accuracy
- [ ] Test legacy method removal (ensure no regressions)
- [ ] Achieve >90% code coverage
- [ ] Use LedgerRepo.test.ts as template

#### File: `src/repo/LedgerAccountRepo.test.ts`

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