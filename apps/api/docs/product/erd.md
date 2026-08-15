# Exchequer Ledger API entity relationships

This diagram shows the ownership and accounting columns used by Ledger Transactions. See
[`schema.ts`](../../src/repo/schema.ts) for the complete database schema.

```mermaid
erDiagram
    ORGANIZATION {
        text id PK
        text name
        text description
        timestamptz created
        timestamptz updated
    }

    LEDGER {
        text id PK
        text organization_id FK
        text name
        text description
        text metadata
        timestamptz created
        timestamptz updated
    }

    LEDGER_ACCOUNT {
        text id PK
        text organization_id FK
        text ledger_id FK
        text name
        text description
        enum normal_balance
        text currency_code
        integer minor_unit_exponent
        bigint pending_credits
        bigint pending_debits
        bigint posted_credits
        bigint posted_debits
        integer lock_version
        text metadata
        timestamptz created
        timestamptz updated
    }

    LEDGER_TRANSACTION {
        text id PK
        text organization_id FK
        text ledger_id FK
        text idempotency_key
        text description
        enum status
        timestamptz posted_at
        text metadata
        timestamptz created
        timestamptz updated
    }

    LEDGER_TRANSACTION_ENTRY {
        text id PK
        text organization_id FK
        text ledger_id FK
        text transaction_id FK
        text account_id FK
        enum direction
        bigint amount
        text metadata
        timestamptz created
    }

    LEDGER_ACCOUNT_SETTLEMENT {
        text id PK
        text organization_id FK
        text transaction_id FK
        text settled_account_id FK
        text contra_account_id FK
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
  Transactions. Transactions have no Effective Time.
- Entries inherit their Transaction's lifecycle. They store neither status nor Currency; reads
  derive `currency_code` and `minor_unit_exponent` from the Account.
- Entry Amounts are positive integer Minor Units no greater than JavaScript's maximum safe integer.
- Each Account stores four signed, safe-integer counters. Pending and available amounts are derived,
  not stored.
- `(organization_id, idempotency_key)` is unique when the legacy nullable key is present.
- Transaction lists use `(ledger_id, created DESC, id DESC)`. Ownership and lookup indexes cover
  Organization, status, Transaction, and Account access paths.

Create idempotency also uses Valkey, outside PostgreSQL. The Organization-scoped key maps to the
server-owned Transaction ID for 24 hours; PostgreSQL's unique constraint remains the durable race
recovery boundary.
