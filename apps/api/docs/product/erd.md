# Exchequer Ledger API - Entity Relationship Diagram

```mermaid
erDiagram
    %% Core Entities
    LEDGER {
        text id PK
        text organization_id FK
        text name
        text description
        text currency
        integer currency_exponent
        jsonb metadata
        timestamp created
        timestamp updated
    }

    LEDGER_ACCOUNT {
        text id PK
        text ledger_id FK
        text name
        text description
        enum normal_balance
        numeric balance_amount
        integer lock_version
        jsonb metadata
        timestamp created
        timestamp updated
    }

    LEDGER_TRANSACTION {
        text id PK
        text ledger_id FK
        text idempotency_key
        text description
        enum status
        jsonb metadata
        timestamp created
        timestamp updated
    }

    LEDGER_TRANSACTION_ENTRY {
        text id PK
        text transaction_id FK
        text account_id FK
        enum direction
        numeric amount
        enum status
        jsonb metadata
        timestamp created
        timestamp updated
    }

    %% Supporting Entities
    LEDGER_ACCOUNT_CATEGORY {
        text id PK
        text ledger_id FK
        text name
        text description
        enum normal_balance
        text parent_category_id
        jsonb metadata
        timestamp created
        timestamp updated
    }

    LEDGER_ACCOUNT_BALANCE_MONITOR {
        text id PK
        text account_id FK
        text name
        text description
        numeric alert_threshold
        integer is_active
        jsonb metadata
        timestamp created
        timestamp updated
    }

    LEDGER_ACCOUNT_STATEMENT {
        text id PK
        text account_id FK
        timestamp statement_date
        numeric opening_balance
        numeric closing_balance
        numeric total_credits
        numeric total_debits
        integer transaction_count
        jsonb metadata
        timestamp created
        timestamp updated
    }

    LEDGER_ACCOUNT_SETTLEMENT {
        text id PK
        text account_id FK
        text batch_id
        timestamp settlement_date
        numeric settlement_amount
        enum status
        text external_reference
        jsonb metadata
        timestamp created
        timestamp updated
    }

    ORGANIZATION {
        text id PK
        text name
        text description
        timestamp created
        timestamp updated
    }

    %% Relationships
    ORGANIZATION ||--o{ LEDGER : "contains"
    LEDGER ||--o{ LEDGER_ACCOUNT : "contains"
    LEDGER ||--o{ LEDGER_TRANSACTION : "records"
    LEDGER ||--o{ LEDGER_ACCOUNT_CATEGORY : "categorizes"
    
    LEDGER_TRANSACTION ||--o{ LEDGER_TRANSACTION_ENTRY : "contains"
    LEDGER_ACCOUNT ||--o{ LEDGER_TRANSACTION_ENTRY : "affected_by"
    
    LEDGER_ACCOUNT ||--o{ LEDGER_ACCOUNT_BALANCE_MONITOR : "monitored_by"
    LEDGER_ACCOUNT ||--o{ LEDGER_ACCOUNT_STATEMENT : "generates"
    LEDGER_ACCOUNT ||--o{ LEDGER_ACCOUNT_SETTLEMENT : "settles"
    
    LEDGER_ACCOUNT_CATEGORY }o--|| LEDGER_ACCOUNT_CATEGORY : "parent_child"

    %% Enum Definitions
    enum normal_balance {
        debit
        credit
    }

    enum status {
        pending
        posted
        archived
    }

    enum direction {
        debit
        credit
    }
```

## Key Relationships Explained

### Core Double-Entry Structure
- **Ledger (1) → Ledger Accounts (many)**: Each ledger contains multiple accounts
- **Ledger (1) → Ledger Transactions (many)**: Each ledger records multiple transactions  
- **Ledger Transaction (1) → Ledger Transaction Entries (2+)**: Each transaction must have at least 2 entries (debit + credit)
- **Ledger Account (1) → Ledger Transaction Entries (many)**: Each account can have many transaction entries

### Business Rules Enforced
1. **Double-Entry Accounting**: Every transaction must balance (total debits = total credits)
2. **Account Isolation**: Accounts only transact within the same ledger
3. **Transaction Atomicity**: All entries in a transaction succeed or fail together
4. **Status Inheritance**: Transaction status changes affect all entries

### Supporting Features
- **Account Categories**: Hierarchical chart of accounts structure
- **Balance Monitors**: Real-time balance tracking with alerts
- **Account Statements**: Periodic balance snapshots and reporting
- **Settlement Batches**: Automated settlement processing

## Data Types
- **text**: String identifiers and names
- **numeric**: Decimal amounts with precision (20,4)
- **enum**: Predefined values for status/direction
- **timestamp**: Date/time with timezone
- **jsonb**: Flexible metadata storage
- **integer**: Numeric flags and counters

## Indexes for Performance
- Account balance queries: `idx_ledger_accounts_balance`
- Transaction status lookups: `idx_ledger_transactions_status`
- Entry filtering: `idx_ledger_transaction_entries_account/status`
- Settlement processing: `idx_ledger_account_settlements_batch/status`