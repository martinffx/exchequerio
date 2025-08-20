# PRD: Ledgers API

**Status:** ✅ Requirements Complete | 🔍 Gap Analysis Complete | ⚠️ Implementation Required  
**Timeline:** 6-week Shape Up cycle  
**Last Updated:** 2025-08-20  

## Executive Summary

The Ledgers API enables Financial Operations teams at Payment Service Providers (PSPs) and Marketplaces to accurately track money flow across complex multi-party transaction ecosystems. This API-first product delivers real-time balance tracking, comprehensive audit trails, and automated reconciliation capabilities to solve critical operational inefficiencies in payment processing.

## Target Users

**Primary:** Financial Operations Teams at Payment Service Providers (PSPs) and Marketplaces
- FinOps Analysts responsible for merchant balance monitoring and settlement
- Compliance Officers requiring audit trail generation
- Operations Teams handling reconciliation processes

## Problem Statement

PSPs and Marketplaces handle complex multi-party transactions involving splits, fees, and settlements across multiple stakeholders. Current solutions force FinOps teams to:
- Manually track money flow across fragmented systems
- Spend excessive time on reconciliation processes
- Lack real-time visibility into merchant balances
- Struggle to generate comprehensive audit trails for compliance

**Core Problem:** Keeping track of the flow of money in complex payment ecosystems.

## Success Metrics

### Primary KPIs
- **Efficient Reconciliation** - Reduce reconciliation processing time
- **Full Audit Trail** - 100% transaction traceability for compliance
- **Real-time Balances** - Accurate, up-to-the-moment account balances
- **Automated Reporting** - Streamlined compliance and operational reporting

### Measurable Outcomes
- Reconciliation time reduction from hours to minutes
- Complete audit trail coverage across all transactions
- Balance accuracy >99.9% in real-time scenarios
- Automated report generation eliminating manual processes

## User Stories

### Core User Stories

**US1:** As a FinOps analyst I want to see real-time merchant balances so I can prevent overdrafts

**US2:** As a FinOps analyst I want accurate balances so I can settle merchants quickly

**US3:** As a FinOps analyst I need to be able to accurately track the flow of funds

### Additional Context
- Focus on balance accuracy and fund flow transparency
- Enable proactive financial risk management
- Support rapid settlement processes
- Provide comprehensive transaction visibility

## Scope Definition

### In Scope (v1)
- **Core Ledger Operations**
  - Account creation and management
  - Transaction recording with double-entry accounting
  - Real-time balance calculation and retrieval
  - Transaction history and audit trail access

- **API Functionality**
  - RESTful API endpoints for all core operations
  - Authentication and authorization
  - Comprehensive API documentation
  - Error handling and validation

- **Data Integrity**
  - Double-entry bookkeeping enforcement
  - Transaction atomicity and consistency
  - Audit trail immutability
  - Balance reconciliation capabilities

### Out of Scope (v1)
- **Real-time Notifications** - Push notifications for balance changes or events
- **Third-party ERP Integrations** - Direct integrations with external accounting systems
- **User Interface** - Any web-based UI (API-only product)
- **Advanced Analytics** - Reporting dashboards or business intelligence features
- **Mobile Access** - Mobile applications or mobile-optimized interfaces

## Timeline

**6-Week Shape Up Cycle**

### Sprint Breakdown
- **Weeks 1-2:** Core ledger schema design and basic CRUD operations
- **Weeks 3-4:** Transaction processing and balance calculation logic
- **Weeks 5-6:** API hardening, documentation, and testing

### Key Milestones
- Week 2: Basic account and transaction models functional
- Week 4: Real-time balance calculations working
- Week 6: Production-ready API with comprehensive test coverage

## Technical Considerations

### API Design Principles
- RESTful architecture following established patterns
- Comprehensive OpenAPI/Swagger documentation
- Robust error handling and validation
- Authentication via JWT tokens

### Performance Requirements
- Sub-second response times for balance queries
- Support for high-volume transaction processing
- Concurrent transaction handling without data corruption
- Scalable architecture for PSP/Marketplace transaction volumes

### Compliance & Audit
- Immutable transaction logs
- Complete audit trail for all operations
- Data retention policies for regulatory compliance
- Transaction integrity verification capabilities

## Implementation Gap Analysis

### Current Status: 5% Complete
**Gap Analysis Date:** 2025-08-20

#### ✅ Strengths (Exceeds Requirements)
- **API Architecture**: Sophisticated Fastify-based design with proper layered architecture
- **Schema Design**: Comprehensive TypeScript schemas in `src/routes/ledgers/schema.ts` with:
  - Multi-balance tracking (pending, posted, available) - ideal for PSP operations
  - Settlement workflows designed for marketplace payouts  
  - Account categorization supporting merchant hierarchies
  - Double-entry accounting with audit trail design
- **Authentication**: JWT-based structure supports multi-tenancy requirements
- **Route Structure**: All REST endpoints implemented with OpenAPI documentation

#### ❌ Critical Implementation Gaps

**1. Zero Data Persistence (CRITICAL BLOCKER)**
- Current database contains only Organizations table
- No ledger entities exist in schema (accounts, transactions, entries)
- Cannot store or retrieve any ledger data

**2. Zero Business Logic (CRITICAL BLOCKER)**  
- All repository methods in `LedgerRepo.ts` throw "Not implemented"
- All service methods in `LedgerTransactionService.ts` throw "Not implemented"
- No balance calculations, transaction atomicity, or double-entry enforcement

**3. Performance Requirements Unmet**
- Cannot execute real-time balance queries (no implementation exists)
- No optimization infrastructure for sub-second response times
- Missing caching and indexing strategies

#### PRD Requirements vs Current State

| Requirement | Current Status | Severity |
|-------------|---------------|----------|
| Real-time merchant balances | ❌ Cannot query balances | CRITICAL |
| Accurate settlement processing | ❌ No settlement logic | CRITICAL |
| Fund flow tracking | ❌ No transaction recording | CRITICAL |
| Sub-second response times | ❌ No queries possible | HIGH |
| >99.9% balance accuracy | ❌ No calculations exist | HIGH |
| Automated reconciliation | ❌ Not implemented | MEDIUM |

### Implementation Roadmap (6-Week Timeline)

#### **Weeks 1-2: Foundation (Database + Core Models)**
**Priority**: CRITICAL - Enables all other work

**Database Schema Requirements:**
- `accounts` table with ACID-compliant balance tracking
- `transactions` table with idempotency keys for safe retries
- `entries` table for immutable double-entry records

**Core Implementation:**
- Atomic `createTransaction` function using `SELECT...FOR UPDATE` for race condition prevention
- Complete `LedgerRepo.ts` CRUD operations
- PostgreSQL required for ACID compliance (financial ledgers cannot use eventual consistency)

#### **Weeks 3-4: Business Logic (Transaction Processing)**  
**Priority**: CRITICAL - Core value delivery

**Transaction Processing:**
- Double-entry validation and enforcement
- Real-time balance calculations (pending/posted/available)
- Complete `LedgerTransactionService.ts` implementation
- Transaction atomicity with proper rollback handling

#### **Weeks 5-6: PSP Features (Settlement & Performance)**
**Priority**: HIGH - PSP/Marketplace differentiation

**Settlement & Optimization:**
- Merchant settlement workflow automation
- Performance optimization: indexing and caching for sub-second queries  
- Balance monitoring and alert capabilities
- Production hardening and comprehensive testing

### Risk Assessment

**HIGH RISK**: 6-week timeline with 95% implementation gap
- **Mitigation**: Use existing API schema as implementation specification
- **Focus**: Core user stories first (balance queries, transaction recording)

**MEDIUM RISK**: Complex financial transaction logic requires expertise
- **Mitigation**: PostgreSQL with proper locking mechanisms (`SELECT...FOR UPDATE`)
- **Critical**: Implement comprehensive concurrency testing

**Recommendation**: Timeline is achievable with disciplined focus on foundational elements first, leveraging the excellent existing API design as the implementation guide.

## Next Steps

### Immediate Actions (Week 1)
1. **Database Technology Decision**: Confirm PostgreSQL for ACID compliance
2. **Schema Implementation**: Create `accounts`, `transactions`, and `entries` tables  
3. **Atomic Operations**: Implement core `createTransaction` function with proper locking
4. **Concurrency Testing**: Build tests to validate race condition handling

### Development Planning
1. **Database Schema Design** - Implement missing ledger tables using existing API schema as specification
2. **Repository Layer** - Complete unimplemented methods in `LedgerRepo.ts`
3. **Service Layer** - Implement business logic in `LedgerTransactionService.ts`  
4. **Performance Optimization** - Add indexing and caching for sub-second response requirements
5. **Testing Strategy** - Focus on financial accuracy, atomicity, and concurrency validation

## Technical Design

### System Architecture

**Core Architecture Pattern**: Leveraging existing Fastify layered architecture
```
JWT Auth → Routes → Services → Repositories → PostgreSQL Database
```

**Tech Stack Alignment**:
- **API Layer**: Fastify + TypeBox for runtime validation + OpenAPI docs
- **Business Logic**: Service layer with dependency injection via Fastify plugins
- **Data Layer**: Drizzle ORM + PostgreSQL for ACID compliance
- **Authentication**: JWT tokens via `@fastify/auth` (already implemented)

### Database Schema Design

Based on existing API schema in `src/routes/ledgers/schema.ts`, implementing core ledger tables:

#### Core Financial Tables

```sql
-- Ledgers: Chart of accounts container
CREATE TABLE ledgers (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations_table(id),
    name TEXT NOT NULL,
    description TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    currency_exponent INTEGER NOT NULL DEFAULT 2,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Ledger Accounts: Individual accounts (merchant wallets, fee accounts, etc.)
CREATE TABLE ledger_accounts (
    id UUID PRIMARY KEY,
    ledger_id UUID NOT NULL REFERENCES ledgers(id),
    name TEXT NOT NULL,
    description TEXT,
    normal_balance ledger_normal_balance NOT NULL, -- 'debit' | 'credit'
    balance_amount NUMERIC(20,4) NOT NULL DEFAULT 0,
    lock_version INTEGER NOT NULL DEFAULT 0, -- For optimistic locking
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Ledger Transactions: Double-entry transaction containers  
CREATE TABLE ledger_transactions (
    id UUID PRIMARY KEY,
    ledger_id UUID NOT NULL REFERENCES ledgers(id),
    idempotency_key TEXT UNIQUE, -- Critical for safe retries
    description TEXT,
    status ledger_transaction_status NOT NULL DEFAULT 'pending', -- 'pending' | 'posted' | 'archived'
    posted_at TIMESTAMP WITH TIME ZONE,
    effective_at TIMESTAMP WITH TIME ZONE,
    reverses_transaction_id UUID REFERENCES ledger_transactions(id),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Ledger Transaction Entries: Individual debit/credit entries
CREATE TABLE ledger_transaction_entries (
    id UUID PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    direction ledger_entry_direction NOT NULL, -- 'debit' | 'credit'
    amount NUMERIC(20,4) NOT NULL CHECK (amount > 0),
    status ledger_transaction_status NOT NULL DEFAULT 'pending',
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### PSP-Specific Enhancement Tables

```sql  
-- Account Categories: For merchant organization (assets, liabilities, revenue)
CREATE TABLE ledger_account_categories (
    id UUID PRIMARY KEY,
    ledger_id UUID NOT NULL REFERENCES ledgers(id),
    name TEXT NOT NULL,
    normal_balance ledger_normal_balance NOT NULL,
    parent_category_id UUID REFERENCES ledger_account_categories(id),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Account Settlements: PSP settlement workflows
CREATE TABLE ledger_account_settlements (
    id UUID PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    settled_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    contra_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    amount NUMERIC(20,4) NOT NULL,
    status ledger_settlement_status NOT NULL DEFAULT 'drafting',
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Balance Monitors: Real-time balance alerts for overdraft prevention
CREATE TABLE ledger_account_balance_monitors (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    alert_conditions JSONB NOT NULL, -- Array of AlertCondition objects
    lock_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

### Critical Database Constraints

**ACID Compliance Requirements**:
- `SELECT ... FOR UPDATE` on account balance updates to prevent race conditions
- Transaction-level atomicity for all double-entry operations
- Immutable entries (no UPDATEs allowed on `ledger_transaction_entries`)
- Check constraint: `SUM(debit_entries) = SUM(credit_entries)` per transaction

**Performance Indexes**:
```sql
-- Balance query optimization
CREATE INDEX idx_ledger_accounts_balance ON ledger_accounts(ledger_id, balance_amount);
CREATE INDEX idx_transaction_entries_account ON ledger_transaction_entries(account_id, created_at);

-- PSP-specific queries
CREATE INDEX idx_settlements_status ON ledger_account_settlements(status, created_at);
CREATE INDEX idx_transactions_idempotency ON ledger_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
```

### API Specification

**Endpoint Structure** (leveraging existing route design):

#### Core User Story Endpoints

**US1: Real-time merchant balances to prevent overdrafts**
```typescript
GET /api/ledgers/{ledgerId}/accounts/{accountId}
Response: {
  balances: [
    { balanceType: "pending", amount: 1250.50, currency: "USD" },
    { balanceType: "posted", amount: 1000.00, currency: "USD" },
    { balanceType: "available", amount: 750.50, currency: "USD" }
  ]
}
```

**US2: Accurate balances for quick settlement**  
```typescript
POST /api/ledgers/{ledgerId}/settlements
Request: {
  settledAccountId: "lat_merchant_123",
  contraAccountId: "lat_settlement_pool", 
  amount: 1000.00
}
```

**US3: Track flow of funds**
```typescript
POST /api/ledgers/{ledgerId}/transactions
Request: {
  description: "Merchant payment processing",
  idempotencyKey: "payment_abc123",
  entries: [
    { accountId: "lat_merchant_123", direction: "credit", amount: 95.00 },
    { accountId: "lat_fee_revenue", direction: "credit", amount: 5.00 },
    { accountId: "lat_settlement_clearing", direction: "debit", amount: 100.00 }
  ]
}
```

### Implementation Components

#### Backend Changes (Core Implementation)

**Repository Layer** (`src/repo/`):
- Complete `LedgerRepo.ts` with atomic transaction methods
- Implement balance calculation with `SELECT ... FOR UPDATE`
- Add settlement and monitoring repository methods

**Service Layer** (`src/services/`):
- Implement `LedgerTransactionService.ts` with double-entry validation
- Add real-time balance calculation logic
- Create settlement workflow automation
- Implement balance monitoring with alert conditions

**Route Layer** (`src/routes/ledgers/`):
- Routes already implemented - just need to remove placeholder responses
- Add comprehensive error handling for financial operations
- Implement request validation using existing TypeBox schemas

#### Database Migration Strategy

**Migration Files** (using existing Drizzle setup):
1. `migrations/0002_add_ledger_core_tables.sql` - Core ledger tables
2. `migrations/0003_add_psp_enhancement_tables.sql` - PSP-specific tables  
3. `migrations/0004_add_performance_indexes.sql` - Optimization indexes
4. `migrations/0005_add_constraints_and_triggers.sql` - Data integrity constraints

### Security & Performance

#### Security Measures
- **JWT Authentication**: Already implemented, ensure proper org-level isolation
- **Input Validation**: TypeBox runtime validation prevents injection attacks  
- **Audit Trail**: All transactions immutable with complete audit trail
- **Rate Limiting**: Fastify under-pressure plugin already configured

#### Performance Optimizations  
- **Balance Caching**: Pre-calculated balances on account records with lock_version
- **Query Optimization**: Strategic indexes for PSP-specific queries
- **Connection Pooling**: PostgreSQL connection pooling via Drizzle
- **Monitoring**: Built-in Fastify logging with pino-pretty

**Target Performance** (from PRD requirements):
- Sub-second response times for balance queries
- Support high-volume concurrent transaction processing  
- >99.9% balance accuracy in real-time scenarios

### Implementation Phases

#### **Phase 1 - Foundation** (Weeks 1-2, 10 days)
**Priority**: CRITICAL - Enables all subsequent development

**Database Foundation**:
- Implement core ledger table schema with proper constraints
- Create atomic `createTransaction` repository method
- Add comprehensive database migration with indexes

**Core Repository Logic**:
- Complete `LedgerRepo.ts` CRUD operations
- Implement account balance calculations with race condition prevention
- Add transaction validation (debits = credits)

**Testing Foundation**:
- Unit tests for atomic transaction creation
- Concurrency tests for balance calculations
- Database constraint validation tests

#### **Phase 2 - Business Logic** (Weeks 3-4, 10 days)  
**Priority**: CRITICAL - Core value delivery

**Transaction Processing**:
- Complete `LedgerTransactionService.ts` with double-entry enforcement
- Implement real-time balance calculations (pending/posted/available)
- Add idempotency key handling for safe retries

**PSP Features**:
- Settlement workflow implementation
- Account categorization for merchant hierarchies
- Balance monitoring with alert conditions

**API Integration**:
- Connect service layer to existing route handlers
- Remove "Not implemented" placeholders
- Add comprehensive error handling

#### **Phase 3 - Optimization & Polish** (Weeks 5-6, 10 days)
**Priority**: HIGH - Production readiness

**Performance Optimization**:
- Query optimization for sub-second response times
- Balance calculation performance tuning
- Stress testing under high concurrency

**PSP Enhancements**:
- Advanced settlement workflows
- Automated reconciliation foundations  
- Monitoring and alerting capabilities

**Production Hardening**:
- Comprehensive integration testing
- Load testing and performance validation
- Documentation and API specification finalization

### Risk Mitigation

**Critical Success Factors**:
1. **Database Design**: Use existing API schema as specification - it's exceptionally well designed
2. **Atomic Operations**: Implement proper `SELECT...FOR UPDATE` locking from day 1
3. **Testing Strategy**: Focus heavily on concurrency and race condition testing
4. **Incremental Delivery**: Each phase delivers working, testable functionality

**Timeline Risk**: 6 weeks is achievable because:
- API design and route structure already excellent
- Database schema can be derived directly from existing TypeBox schemas  
- Architecture patterns are established and proven
- Focus on core ledger mechanics first, PSP features second

---

*This PRD with Technical Design serves as the complete specification for Ledgers API implementation. **Status: ✅ Requirements Complete | ✅ Technical Design Complete | 🚀 Ready for Development***