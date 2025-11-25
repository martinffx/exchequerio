# Product Overview - Exchequer Ledger API

**Product Definition:** Real-time double-entry ledger API enabling Financial Operations teams at PSPs and Marketplaces to track money flow, calculate balances, and automate settlement processes.

**Last Updated:** {DATE}

## Target Users

**Primary:** Financial Operations Teams at Payment Service Providers (PSPs) and Marketplaces
- FinOps Analysts responsible for merchant balance monitoring and settlement
- Compliance Officers requiring audit trail generation
- Operations Teams handling reconciliation processes

## Core Features

### Balance Management
- Fast balance queries (pending, posted, available)
- Simple balance calculations from transaction entries
- Multiple balance types for different business needs

### Transaction Tracking
- Transaction recording with duplicate prevention
- Clear record of money movement between accounts
- Permanent audit trail for all changes

### Settlement & Reconciliation
- Automated settlement processing
- Account categorization for organization
- Balance monitoring with alerts

## Core Entities

### 1. Ledger
- The top-level container that represents your entire accounting system
- Think of it as your "chart of accounts" or accounting universe
- Contains all accounts and transactions for a specific business context
- Guarantees balanced debits and credits at all times

### 2. Ledger Account
- Individual "buckets" that track specific types of value
- Examples: User Wallet, Revenue, Fees Collected, Bank Settlement Account
- Has a `normal_balance` type (debit or credit) based on accounting rules
- Tracks three balance types:
  - `posted_balance`: Completed/settled transactions only
  - `pending_balance`: Both pending and posted transactions
  - `available_balance`: What's actually usable (posted minus holds)

### 3. Ledger Transaction
- Records movement of money between accounts
- Must always balance (total debits = total credits)
- Has a status lifecycle: `pending` → `posted` (or `archived` if cancelled)
- Immutable once posted
- Can be linked to external payment systems

### 4. Ledger Entry
- The individual debit or credit within a transaction
- Always belongs to exactly one transaction
- Points to exactly one account
- Inherits the transaction's status and timestamp

## Entity Relationships

```
Ledger (1)
  ├── Ledger Accounts (many)
  │     ├── User Wallet Account
  │     ├── Revenue Account
  │     └── Bank Settlement Account
  │
  └── Ledger Transactions (many)
        └── Ledger Entries (2+)
              ├── Entry 1: Debit User Wallet $50
              └── Entry 2: Credit Bank Settlement $50
```

## Key Relationships

### Double-Entry Rule
Every transaction needs at least two entries (one debit, one credit) that balance to zero.

### Account Isolation
Accounts only transact within the same ledger. No cross-ledger transfers.

### Transaction Atomicity
All entries in a transaction succeed or fail together. Both debit and credit happen as one unit.

### Status Inheritance
When a transaction status changes, all its entries update together.

## Real-World Example: User Cash Out

Here's what happens when a user cashes out $100 from their wallet:

1. **Create Transaction**: Create a `Ledger Transaction` with status `pending`

2. **Add Entries**: Add two `Ledger Entries`:
   - Debit: User's Wallet Account -$100
   - Credit: Payouts Clearing Account +$100

3. **Pending State**: User's wallet shows:
   - `pending_balance`: $0 (includes the pending transaction)
   - `posted_balance`: $100 (only completed transactions)

4. **Settlement**: When the actual bank transfer completes, update transaction to `posted`

5. **Final State**: Now both balances show $0

## Core Design Principles

### Immutability
Posted transactions cannot be changed. Corrections need new transactions.

### Consistency
The ledger always balances (debits = credits).

### Auditability
Complete record of all money movements with timestamps.

### Scalability
Handles many transactions efficiently.

## API Operations

### Basic Operations
- `POST /ledgers` - Create a new ledger
- `POST /ledger_accounts` - Create accounts within a ledger
- `POST /ledger_transactions` - Record money movement
- `GET /ledger_accounts/{id}` - Check account balances
- `PATCH /ledger_transactions/{id}` - Update pending transaction status

### Advanced Features
- Link transactions to external systems
- Automatic status updates
- Bulk transaction creation
- Time-based queries
- Version tracking

## Use Cases

### Digital Wallets
Track user balances and payouts

### Marketplaces
Handle splits, fees, and payouts

### Lending Platforms
Track loans, repayments, and interest

### Payment Processors
Reconcile bank settlements

## Implementation Notes

- Start with a simple chart of accounts and expand as needed
- Use meaningful account names that reflect your business domain
- Always include descriptive metadata on transactions
- Consider using `effective_at` timestamps for accurate historical records
- Plan for reconciliation with external systems from day one

## Success Metrics

### Performance Targets
- **Fast response times** for balance queries
- **Accurate balances** in all scenarios
- **Concurrent transaction processing** without errors

### Business Impact
- **Faster reconciliation** from hours to minutes
- **Complete audit trail** for all transactions
- **Automated reporting** 
- **Overdraft prevention** through monitoring

## Core Problem Solved

PSPs and Marketplaces handle complex transactions with splits, fees, and settlements. This API replaces manual tracking with automated systems and provides clear visibility into merchant balances.

**Value Proposition:** Track money flow in payment ecosystems with accurate, real-time accounting.
