# Exchequer Ledger API entity relationships

This diagram shows the ownership and accounting columns used by Ledger Transactions. See
[`schema.ts`](../../src/db/schema.ts) for the complete database schema.

```mermaid
erDiagram
    ORGANIZATION {
        uuid id PK
        text name
        text description
        timestamptz created
        timestamptz updated
    }

    LEDGER {
        uuid id PK
        uuid organization_id FK
        text name
        text description
        text metadata
        timestamptz created
        timestamptz updated
    }

    LEDGER_ACCOUNT {
        uuid id PK
        uuid organization_id FK
        uuid ledger_id FK
        text name
        text description
        enum normal_balance
        text currency_code
        bigint pending_amount
        bigint posted_amount
        bigint available_amount
        bigint pending_credits
        bigint pending_debits
        bigint posted_credits
        bigint posted_debits
        bigint available_credits
        bigint available_debits
        integer lock_version
        text metadata
        timestamptz created
        timestamptz updated
    }

    LEDGER_TRANSACTION {
        uuid id PK
        uuid settlement_id FK
        uuid organization_id FK
        uuid ledger_id FK
        text description
        enum status
        timestamptz posted_at
        timestamptz effective_at
        integer lock_version
        text metadata
        timestamptz created
        timestamptz updated
    }

    LEDGER_ACCOUNT_SETTLEMENT {
        uuid id PK
        uuid organization_id FK
        uuid ledger_id FK
        uuid settled_account_id FK
        uuid contra_account_id FK
        enum status
        enum target_status
        boolean allow_either_direction
        timestamptz effective_at_upper_bound
    }

    LEDGER_ACCOUNT_SETTLEMENT ||--o| LEDGER_TRANSACTION : generates

    LEDGER_TRANSACTION_ENTRY {
        uuid id PK
        uuid organization_id FK
        uuid ledger_id FK
        uuid transaction_id FK
        uuid account_id FK
        enum direction
        bigint amount
        text currency
        enum status
        text metadata
        timestamptz created
    }

    LEDGER_ACCOUNT_SETTLEMENT {
        uuid id PK
        uuid organization_id FK
        uuid transaction_id FK
        uuid settled_account_id FK
        uuid contra_account_id FK
    }

    ORGANIZATION ||--o{ LEDGER : owns
    LEDGER ||--o{ LEDGER_ACCOUNT : contains
    LEDGER ||--o{ LEDGER_TRANSACTION : records
    LEDGER_TRANSACTION ||--|{ LEDGER_TRANSACTION_ENTRY : contains
    LEDGER_ACCOUNT ||--o{ LEDGER_TRANSACTION_ENTRY : receives
    LEDGER_TRANSACTION ||--o{ LEDGER_ACCOUNT_SETTLEMENT : offsets
```

## Transaction invariants

- A Transaction belongs to one Organization and Ledger. The composite foreign key
  `(organization_id, ledger_id)` references its Ledger.
- An Entry repeats `organization_id` and `ledger_id` so composite foreign keys require its
  Transaction and Account to share both owners.
- Transaction status is `pending`, `posted`, or `voided`. `posted_at` exists only for Posted
  Transactions. Entries inherit their Transaction's `effective_at`; live balances depend on status.
- Entries store the Transaction status and the request Currency Code alongside the Amount. Currency
  exponent handling is deferred until the Asset model exists.
- Entry Amounts are positive integer Minor Units no greater than JavaScript's maximum safe integer.
- Each Account stores pending, posted, and available Amounts plus credit and debit counters for each
  state. All nine projections are safe integers.
- Transaction lists use `(ledger_id, created DESC, id DESC)`. Ownership and lookup indexes cover
  Organization, status, Transaction, and Account access paths.

Settlement Transactions carry a nullable, unique `settlement_id`. Its composite foreign key requires
matching Organization and Ledger ownership. Settlement responses derive Amount and direction from
the generated Entry; Settlements store neither an Amount nor a Transaction reference. Processing
records the intended target while accounting and finalization commit in separate repository-owned
transactions. Source membership is frozen during Processing and released when voiding is finalized.

Mutation idempotency uses Valkey, scoped by Organization, action and client key. Use a fresh UUID
for each new action and reuse it only for retries. Claims store resource IDs for 15 minutes. Pending
claims receive a bounded wait followed by retryable 409; unavailable storage returns 503. Domain
services explicitly claim, execute or replay, and complete or release; the idempotency service does
not execute business operations.
