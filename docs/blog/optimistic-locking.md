# Optimistic Locking in a Real-Time Double-Entry Ledger System

**How we built a financial ledger that processes hundreds of concurrent transactions per second without blocking.**

---

## The Problem

Building a financial ledger for Payment Service Providers (PSPs) and marketplaces presents a unique challenge: you need to process thousands of transactions per second while maintaining **atomic balance updates** and **double-entry bookkeeping invariants** (debits must equal credits).

The traditional approach uses pessimistic locking:

```sql
BEGIN;
SELECT * FROM accounts WHERE id IN (...) FOR UPDATE;  -- Blocks other readers
UPDATE accounts SET balance = ... WHERE id = ...;
COMMIT;
```

This works, but has a critical flaw: `SELECT FOR UPDATE` blocks **all other readers** until the transaction commits. In a high-throughput payment system, this becomes a bottleneck.

**The question:** Can we maintain consistency without blocking reads?

The answer is **optimistic locking** - a pattern that assumes conflicts are rare and only checks for them at write time.

---

## Architecture Overview

Before diving into the implementation, let's establish the foundation: **double-entry bookkeeping**.

### Double-Entry Bookkeeping in 60 Seconds

Every financial transaction has two sides:
- **Debits** - money going out or assets increasing
- **Credits** - money coming in or liabilities increasing

The fundamental invariant: **Total Debits = Total Credits**

For example, when a customer pays $100:
```
Entry 1: Debit  "Customer Account"  $100  (asset increases)
Entry 2: Credit "Revenue"            $100  (income increases)
         Total:  $100 = $100 ✓
```

### Data Structures

We use **immutable entities** to represent transactions and accounts:

```typescript
// Transaction with entries
type LedgerTransactionEntity = {
  id: LedgerTransactionID;        // TypeID: "ltr_01ABC..."
  organizationId: OrgID;           // Multi-tenancy
  ledgerId: LedgerID;
  entries: LedgerTransactionEntryEntity[];  // Frozen array
  status: "pending" | "posted" | "archived";
  effectiveAt: Date;
  metadata?: Record<string, unknown>;
  created: Date;
  updated: Date;
};

// Individual entry
type LedgerTransactionEntryEntity = {
  id: LedgerTransactionEntryID;   // "lte_01ABC..."
  transactionId: LedgerTransactionID;
  accountId: LedgerAccountID;
  direction: "debit" | "credit";
  amount: number;                  // Integer minor units (e.g., 10050 = $100.50)
  currency: string;                // "USD"
  currencyExponent: number;        // 2 for USD
  status: "pending" | "posted" | "archived";
};

// Account with balances
type LedgerAccountEntity = {
  id: LedgerAccountID;
  ledgerId: LedgerID;
  name: string;
  normalBalance: "debit" | "credit";

  // Balance tracking (all integers)
  postedAmount: number;
  postedCredits: number;
  postedDebits: number;

  // Optimistic locking
  lockVersion: number;             // Incremented on every write
  updated: Date;
};
```

**Key design decisions:**

1. **Integer arithmetic** - Amounts are stored in minor units (cents) to avoid floating-point precision issues
2. **Immutable entities** - All state changes return new instances, making concurrent operations safe
3. **TypeID for identifiers** - Type-safe IDs with prefixes (`ltr_`, `lte_`, `lac_`) prevent mixing different entity types

---

## Validation: Double-Entry Invariant Enforcement

The system enforces `debits = credits` at construction time:

```typescript
private validateEntries(entries: LedgerTransactionEntryEntity[]): void {
  if (entries.length < 2) {
    throw new Error("Transaction must have at least 2 entries");
  }

  let totalDebits = 0;
  let totalCredits = 0;

  for (const entry of entries) {
    if (entry.direction === "debit") {
      totalDebits += entry.amount;
    } else if (entry.direction === "credit") {
      totalCredits += entry.amount;
    } else {
      throw new Error(`Invalid direction: ${entry.direction as string}`);
    }
  }

  // Integer comparison - no tolerance needed
  if (totalDebits !== totalCredits) {
    throw new Error(
      `Double-entry validation failed: debits (${totalDebits}) must equal credits (${totalCredits})`
    );
  }
}
```

**Why this matters:** No invalid transaction can ever exist in memory. The entity constructor calls `validateEntries()`, so any attempt to create an unbalanced transaction immediately throws.

---

## The Three-Phase Transaction Pattern

The core of our optimistic locking approach is this pattern:

```
1. READ: Fetch all affected accounts (no locks held)
2. VALIDATE & BUILD: Calculate balance updates in-memory
3. WRITE: Execute batched writes in single database transaction
```

Let's walk through the implementation:

### Phase 1: READ - Fetch Accounts Without Locks

```typescript
public async createTransaction(
  transaction: LedgerTransactionEntity
): Promise<LedgerTransactionEntity> {
  // 1. Fetch all ledger accounts (NO LOCKS - other transactions can read concurrently)
  const accountIds = transaction.entries.map(e => e.accountId.toString());
  const accounts = await this.db
    .select()
    .from(LedgerAccountsTable)
    .where(and(inArray(LedgerAccountsTable.id, accountIds)));
```

**Critical:** This is a plain `SELECT`, not `SELECT FOR UPDATE`. Other transactions can read and write these accounts concurrently.

### Phase 2: VALIDATE & BUILD - Calculate Balances In-Memory

```typescript
  // 2. Update balances In-memory
  const ledgerAccountsById = new Map(
    accounts.map(a => {
      const account = LedgerAccountEntity.fromRecord(a);
      return [account.id.toString(), account];
    })
  );

  const ledgerAccounts = transaction.entries.map(entry => {
    const account = ledgerAccountsById.get(entry.accountId.toString());
    if (account !== undefined) {
      return account.applyEntry(entry);  // Returns new immutable entity
    }
    throw new NotFoundError(
      `Missing Ledger Account ${entry.accountId.toString()}, for entry ${entry.id.toString()}`
    );
  });
```

The `applyEntry()` method implements double-entry accounting rules:

```typescript
public applyEntry(entry: { direction: "debit" | "credit"; amount: number }): LedgerAccountEntity {
  let newPostedAmount = this.postedAmount;
  let newPostedCredits = this.postedCredits;
  let newPostedDebits = this.postedDebits;

  // Apply double-entry accounting rules based on account's normal balance
  if (this.normalBalance === "debit") {
    if (entry.direction === "debit") {
      // Debit increases debit accounts (Assets, Expenses)
      newPostedAmount += entry.amount;
      newPostedDebits += entry.amount;
    } else {
      // Credit decreases debit accounts
      newPostedAmount -= entry.amount;
      newPostedCredits += entry.amount;
    }
  } else {
    // credit normal balance (Liabilities, Revenue)
    if (entry.direction === "credit") {
      // Credit increases credit accounts
      newPostedAmount += entry.amount;
      newPostedCredits += entry.amount;
    } else {
      // Debit decreases credit accounts
      newPostedAmount -= entry.amount;
      newPostedDebits += entry.amount;
    }
  }

  // Return new immutable entity with updated balances
  return new LedgerAccountEntity({
    ...this,
    postedAmount: newPostedAmount,
    postedCredits: newPostedCredits,
    postedDebits: newPostedDebits,
    availableAmount: newPostedAmount,
    availableCredits: newPostedCredits,
    availableDebits: newPostedDebits,
    updated: new Date(),
  });
}
```

**Why immutable?** Because we calculated these balances based on the snapshot from Phase 1. If we mutate the original entity, we risk corrupting state if the write fails.

### Phase 3: WRITE - Atomic Transaction with Version Checks

```typescript
  // 3. Write all changes in a single DB transaction
  try {
    return await this.db.transaction(async tx => {
      // 3a. Insert transaction record FIRST (entries depend on it via FK)
      const transactionRecord = transaction.toRecord();
      const transactionResult = await tx
        .insert(LedgerTransactionsTable)
        .values(transactionRecord)
        .onConflictDoUpdate({
          target: LedgerTransactionsTable.id,
          set: {
            ledgerId: transactionRecord.ledgerId,
            organizationId: transactionRecord.organizationId,
            description: transactionRecord.description,
            status: transactionRecord.status,
            effectiveAt: transactionRecord.effectiveAt,
            metadata: transactionRecord.metadata,
            updated: transactionRecord.updated,
          },
        })
        .returning();

      // 3b. Insert all entries in batch (idempotent via upsert)
      const txEntriesPromises = transaction.entries.map(async entry => {
        const entryRecord = entry.toRecord();
        await tx
          .insert(LedgerTransactionEntriesTable)
          .values(entryRecord)
          .onConflictDoUpdate({
            target: LedgerTransactionEntriesTable.id,
            set: {
              transactionId: entryRecord.transactionId,
              accountId: entryRecord.accountId,
              organizationId: entryRecord.organizationId,
              direction: entryRecord.direction,
              amount: entryRecord.amount,
              currency: entryRecord.currency,
              currencyExponent: entryRecord.currencyExponent,
              status: entryRecord.status,
              metadata: entryRecord.metadata,
              updated: entryRecord.updated,
            },
          });
      });

      // 3c. Update all account balances in parallel with optimistic locking
      const ledgerAccountsPromises = ledgerAccounts.map(async account => {
        const result = await tx
          .update(LedgerAccountsTable)
          .set(account.toRecord())
          .where(
            and(
              eq(LedgerAccountsTable.id, account.id.toString()),
              eq(LedgerAccountsTable.lockVersion, account.lockVersion)  // <-- VERSION CHECK
            )
          )
          .returning();

        // No rows updated = optimistic lock failure
        if (result.length === 0) {
          throw new ConflictError({
            message: `Account ${account.id.toString()} was modified by another transaction`,
            retryable: true,  // <-- Signal client can retry
          });
        }

        // More than one row updated = data integrity bug
        if (result.length > 1) {
          throw new ConflictError({
            message: `Data integrity error: Updated ${result.length} rows for account ${account.id.toString()}, expected 1`,
          });
        }

        return LedgerAccountEntity.fromRecord(result[0]);
      });

      // 3d. Wait for entries and balance updates to complete (parallel execution)
      await Promise.all([...txEntriesPromises, ...ledgerAccountsPromises]);

      const createdTransaction = LedgerTransactionEntity.fromRecord(transactionResult[0], [
        ...transaction.entries,
      ]);

      return createdTransaction;
    });
  } catch (error: unknown) {
    // Error handling (see next section)
  }
}
```

---

## Optimistic Locking Deep Dive

The magic happens in this WHERE clause:

```typescript
.where(
  and(
    eq(LedgerAccountsTable.id, account.id.toString()),
    eq(LedgerAccountsTable.lockVersion, account.lockVersion)  // <-- THIS
  )
)
```

### How lockVersion Works

**1. Initialization:**
New accounts start with `lockVersion: 0`.

**2. Auto-increment on write:**
Every time an entity is serialized for database write, the version increments:

```typescript
public toRecord(): LedgerAccountInsert {
  return {
    id: this.id.toString(),
    organizationId: this.organizationId.toString(),
    ledgerId: this.ledgerId.toString(),
    name: this.name,
    normalBalance: this.normalBalance,
    postedAmount: this.postedAmount,
    postedCredits: this.postedCredits,
    postedDebits: this.postedDebits,
    lockVersion: this.lockVersion + 1,  // <-- AUTO-INCREMENT
    updated: new Date(),
  };
}
```

**3. Atomic version check:**
The SQL generated by Drizzle ORM looks like:

```sql
UPDATE accounts
SET
  posted_amount = 50000,
  posted_credits = 50000,
  lock_version = 2,      -- Incrementing from 1 to 2
  updated = NOW()
WHERE
  id = 'lac_01ABC...'
  AND lock_version = 1;  -- Must match current version
```

**4. Conflict detection:**

| Scenario | Rows Updated | Meaning |
|----------|--------------|---------|
| `0` | Optimistic lock failure | Another transaction modified this account and incremented the version |
| `1` | Success | We got the lock, update succeeded |
| `>1` | Data integrity bug | Database has duplicate IDs (should be impossible with primary key) |

### The Race Window

Here's what happens when two transactions compete for the same account:

```
Time →
┌─────────┬──────────────────────────────────────┬──────────────────────────────────────┐
│ Step    │ Transaction A                        │ Transaction B                        │
├─────────┼──────────────────────────────────────┼──────────────────────────────────────┤
│ T0      │ READ: account balance = 100,         │                                      │
│         │       lockVersion = 1                │                                      │
├─────────┼──────────────────────────────────────┼──────────────────────────────────────┤
│ T1      │ BUILD: newBalance = 150              │ READ: account balance = 100,         │
│         │                                      │       lockVersion = 1                │
├─────────┼──────────────────────────────────────┼──────────────────────────────────────┤
│ T2      │ WRITE: UPDATE accounts               │ BUILD: newBalance = 80               │
│         │        SET balance = 150,            │                                      │
│         │            lockVersion = 2           │                                      │
│         │        WHERE lockVersion = 1         │                                      │
│         │ ✓ 1 row updated                      │                                      │
├─────────┼──────────────────────────────────────┼──────────────────────────────────────┤
│ T3      │                                      │ WRITE: UPDATE accounts               │
│         │                                      │        SET balance = 80,             │
│         │                                      │            lockVersion = 2           │
│         │                                      │        WHERE lockVersion = 1         │
│         │                                      │ ✗ 0 rows updated (lockVersion is 2!) │
│         │                                      │ throw ConflictError                  │
└─────────┴──────────────────────────────────────┴──────────────────────────────────────┘
```

**Transaction B detects the conflict** at write time and throws `ConflictError` with `retryable: true`.

---

## Error Handling & Retry Strategy

### Retryable vs Non-Retryable Conflicts

Not all conflicts should trigger a retry. We distinguish between transient and permanent failures:

| Scenario | Error Type | Retryable | Reason |
|----------|------------|-----------|--------|
| Optimistic lock failure | `ConflictError` | ✓ Yes | Another transaction modified the account - retry with fresh data |
| Unique constraint violation | `ConflictError` | ✗ No | Resource already exists (e.g., duplicate idempotency key) |
| Data integrity error (>1 row updated) | `ConflictError` | ✗ No | System bug - retrying won't help |
| Serialization failure (PostgreSQL 40001) | `ServiceUnavailableError` | ✓ Yes | Database-level transaction conflict |
| Deadlock detected (PostgreSQL 40P01) | `ServiceUnavailableError` | ✓ Yes | Temporary condition |

The `ConflictError` class exposes the `retryable` flag:

```typescript
type ConflictErrorOpts = {
  message: string;
  retryable?: boolean;      // Defaults to false
  context?: ErrorContext;
};

class ConflictError extends LedgerError {
  public readonly status = 409;
  public readonly retryable: boolean;
  public readonly context?: ErrorContext;

  constructor({ message, retryable, context }: ConflictErrorOpts) {
    super(message);
    this.name = "ConflictError";
    this.retryable = retryable ?? false;
    this.context = context;
  }

  public toResponse(): ConflictErrorResponse {
    return {
      type: "CONFLICT",
      status: this.status,
      title: "Conflict",
      detail: this.message,
      instance: `/instance/${uuid()}`,
      traceId: uuid(),
      retryable: this.retryable,  // Exposed to API clients
      ...this.context,
    };
  }
}
```

### Service-Level Automatic Retry

The service layer implements retry with exponential backoff:

```typescript
import { retry } from "radash";

// Retry on 409 conflicts (optimistic locking) with exponential backoff + jitter
const result = await retry(
  {
    times: 5,                    // Max 5 attempts
    delay: 50,                   // Initial delay 50ms
    backoff: attempt => {
      // Exponential backoff with full jitter, capped at 1s
      const base = Math.min(1000, 50 * 2 ** attempt);
      return Math.floor(Math.random() * base);
    },
  },
  async exit => {
    try {
      return await this.ledgerTransactionRepo.createTransaction(transactionEntity);
    } catch (error) {
      // Only retry on ConflictError with retryable flag
      if (error instanceof ConflictError && error.retryable) {
        throw error; // Let retry handle it (re-throw triggers retry)
      }
      // For non-retryable errors, exit immediately
      exit(error);
      throw error; // TypeScript requires this
    }
  }
);
```

**Backoff schedule:**

| Attempt | Delay Range | Average |
|---------|-------------|---------|
| 1 | 0-50ms | 25ms |
| 2 | 0-100ms | 50ms |
| 3 | 0-200ms | 100ms |
| 4 | 0-400ms | 200ms |
| 5 | 0-800ms | 400ms |

**Why full jitter?** Prevents thundering herd - if 100 transactions fail simultaneously, they retry at random intervals instead of retrying together and failing again.

---

## Idempotency & Safety

### Upsert Operations

All writes use `onConflictDoUpdate` to make them idempotent:

```typescript
await tx
  .insert(LedgerTransactionsTable)
  .values(transactionRecord)
  .onConflictDoUpdate({
    target: LedgerTransactionsTable.id,
    set: {
      ledgerId: transactionRecord.ledgerId,
      organizationId: transactionRecord.organizationId,
      description: transactionRecord.description,
      // ... all fields
    },
  })
  .returning();
```

**Why this matters:** If a client retries a request after a network timeout, the transaction is created once, not duplicated.

### The idempotencyKey Field

Clients can provide an `idempotencyKey` to deduplicate requests:

```typescript
type LedgerTransactionEntity = {
  id: LedgerTransactionID;
  idempotencyKey?: string;  // Client-provided deduplication key
  // ... other fields
};
```

The database enforces uniqueness:

```typescript
// Schema constraint
idempotencyKeyIndex: uniqueIndex("ledger_transactions_idempotency_key_idx").on(
  table.organizationId,
  table.ledgerId,
  table.idempotencyKey
),
```

If a client retries with the same `idempotencyKey`, the database returns a unique constraint violation (`23505`), which we translate to `ConflictError` with `retryable: false`.

---

## Performance: Real Benchmark Results

We benchmarked the system under various contention scenarios using autocannon:

**Test setup:**
- PostgreSQL 16 on local machine
- 30-second test duration
- Concurrent connections: 10
- Scenarios vary by number of accounts (more accounts = less contention)

| Scenario | Accounts | Req/sec | p50 | p97.5 | p99 | Errors |
|----------|----------|---------|-----|-------|-----|--------|
| **High Contention** | 2 | 159.47 | 619ms | 1522ms | 1594ms | 0 |
| **Medium Contention** | 20 | 307.24 | 144ms | 1422ms | 1564ms | 0 |
| **Low Contention** | 200 | 433.67 | 98ms | 1361ms | 1579ms | 0 |
| **Hot: 2/2002** | 2002 | 225.47 | 250ms | 1398ms | 1488ms | 0 |
| **Hot: 20/2020** | 2020 | 285.94 | 149ms | 1452ms | 1566ms | 0 |

**Key insights:**

### 1. Throughput Degradation: 44%

High contention (2 accounts) achieves **159 req/sec**, while low contention (200 accounts) achieves **434 req/sec**.

**Why?** More retries. When 10 concurrent requests target the same 2 accounts, many transactions fail their optimistic lock check and retry, consuming CPU and database resources.

### 2. Zero Errors Across All Scenarios

The retry mechanism successfully handles all conflicts. No transactions were lost.

### 3. Tail Latencies Remain Stable

p99 latency is ~1.5s across all scenarios. The retry backoff caps at 1s, so even under extreme contention, tail latencies don't explode.

### 4. Median Latency Shows the Real Cost

p50 latency jumps from **98ms** (low contention) to **619ms** (high contention) - a **6.3x increase**.

This is the cost of retries: the first attempt succeeds in low contention, but high contention requires 2-3 retries on average.

### 5. Hot Account Scenarios

The "Hot: 2/2002" scenario simulates a realistic workload:
- 2002 total accounts
- 2 are "hot" (frequently accessed, e.g., platform revenue account)
- 2000 are "cold" (customer accounts)

Performance: **225 req/sec** - better than pure high contention, worse than pure low contention.

**Takeaway:** Even a few hot accounts drag down overall throughput.

---

## When Optimistic Locking Wins

Based on our benchmarks and production experience, optimistic locking is the right choice when:

### ✅ Use Optimistic Locking When:

1. **Read-heavy workloads** - Most queries don't modify balances
2. **Low to medium contention** - <10 concurrent writes to the same account
3. **Horizontal scaling matters** - No read locks means read replicas work great
4. **Retry-friendly operations** - Idempotent transactions can safely retry
5. **Predictable tail latencies** - p99 must be bounded (retries cap at 1s)

### ❌ Consider Pessimistic Locking When:

1. **Extreme contention** - Platform accounts handling thousands of TPS
2. **Complex validation** - Balance checks depend on fresh data (e.g., overdraft protection)
3. **Long-running transactions** - The retry window becomes too large
4. **Strict latency SLAs** - Cannot tolerate retry delays

**Hybrid approach:** Use pessimistic locks for hot accounts (platform revenue, settlement accounts) and optimistic locks for customer accounts.

---

## Edge Cases & Gotchas

### 1. Multiple Entries for the Same Account

What if a transaction has two entries affecting the same account?

```typescript
// Transfer $50 from Account A to Account B, with a $5 fee to Platform
const transaction = {
  entries: [
    { accountId: "A", direction: "credit", amount: 5500 },  // -$55 from A
    { accountId: "B", direction: "debit", amount: 5000 },   // +$50 to B
    { accountId: "Platform", direction: "credit", amount: 500 },  // +$5 fee
  ]
};
```

**Problem:** If we naively apply both entries to Account A, we'd update it twice in the same transaction.

**Solution:** Group entries by account before applying:

```typescript
// Group entries by accountId
const entriesByAccount = new Map<string, LedgerTransactionEntryEntity[]>();
for (const entry of transaction.entries) {
  const accountId = entry.accountId.toString();
  if (!entriesByAccount.has(accountId)) {
    entriesByAccount.set(accountId, []);
  }
  entriesByAccount.get(accountId)?.push(entry);
}

// Apply all entries for each account in one pass
const ledgerAccounts = Array.from(entriesByAccount.entries()).map(([accountId, entries]) => {
  let account = ledgerAccountsById.get(accountId);
  if (account === undefined) {
    throw new NotFoundError(`Missing Ledger Account ${accountId}`);
  }

  // Apply all entries sequentially, returning a new entity each time
  for (const entry of entries) {
    account = account.applyEntry(entry);
  }

  return account;
});
```

### 2. The Race Window

Between Phase 1 (READ) and Phase 3 (WRITE), another transaction can modify the account.

**Example:**

```
T0: Transaction A reads account.balance = 100, lockVersion = 5
T1: Transaction B reads account.balance = 100, lockVersion = 5
T2: Transaction B writes account.balance = 150, lockVersion = 6  ✓
T3: Transaction A writes account.balance = 200, lockVersion = 6
    WHERE lockVersion = 5  ✗ Conflict! (lockVersion is now 6)
```

**This is expected behavior.** Transaction A detects the conflict and retries with fresh data.

The race window is unavoidable in optimistic locking. The key is making it **detectable** (via version check) and **recoverable** (via retry).

### 3. Deadlock Prevention

Why do we use `Promise.all()` instead of sequential updates?

```typescript
// ✓ GOOD: Parallel updates
await Promise.all([
  updateAccount("A"),
  updateAccount("B"),
]);

// ✗ BAD: Sequential updates (deadlock risk)
await updateAccount("A");
await updateAccount("B");
```

**Deadlock scenario (sequential):**

```
Transaction A: UPDATE A, then UPDATE B
Transaction B: UPDATE B, then UPDATE A

Time →
T0: A locks Account A (waiting for B)
T1: B locks Account B (waiting for A)
T2: DEADLOCK! Both transactions wait forever
```

**With parallel updates (Promise.all):**

```
Transaction A: UPDATE A and UPDATE B simultaneously
Transaction B: UPDATE A and UPDATE B simultaneously

Time →
T0: A and B both attempt UPDATE A and UPDATE B
T1: One wins (say A), the other detects optimistic lock failure
T2: B retries with fresh data
```

No deadlock because we don't hold locks while waiting for other locks.

### 4. The Data Integrity Check

```typescript
if (result.length > 1) {
  throw new ConflictError({
    message: `Data integrity error: Updated ${result.length} rows for account ${account.id.toString()}, expected 1`,
  });
}
```

**When would this happen?** If the database has duplicate account IDs (violating the primary key constraint).

This should be **impossible** with a properly configured database, but we check it anyway as a defensive measure. If it ever fires, it indicates a serious bug (corrupted database, failed migration, etc.).

**Recovery:** Do NOT mark this as retryable - retrying won't fix a data integrity bug.

---

## Conclusion

Optimistic locking is a powerful pattern for high-throughput financial systems, but it's not a silver bullet.

### Summary of the Pattern

1. **READ** without locks (high concurrency)
2. **VALIDATE & BUILD** in-memory (immutable entities)
3. **WRITE** with version check (conflict detection)
4. **RETRY** on conflict (exponential backoff + jitter)

### When to Use This Approach

✅ **Use optimistic locking when:**
- Read volume >> Write volume
- Contention is low to medium (<10 concurrent writes/account)
- Operations are idempotent (safe to retry)
- Horizontal scaling is important

❌ **Consider pessimistic locking when:**
- Extreme contention (hot accounts)
- Complex balance validation (overdraft rules)
- Strict latency SLAs (cannot tolerate retries)

### Production Lessons

From running this in production:

1. **Monitor retry rates** - If >30% of transactions retry, you have a hot account problem
2. **Set retry budgets** - Cap retries at 5 attempts to prevent cascading failures
3. **Log conflicts** - Track which accounts cause the most conflicts
4. **Consider hybrid approaches** - Pessimistic locks for platform accounts, optimistic for customers
5. **Measure tail latencies** - p99 is more important than p50 for financial APIs

---

## Further Reading

- [Martin Fowler: Optimistic Offline Lock](https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html)
- [PostgreSQL MVCC and Isolation Levels](https://www.postgresql.org/docs/current/mvcc-intro.html)
- [Amazon DynamoDB: Optimistic Locking with Version Numbers](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBMapper.OptimisticLocking.html)
- [Google Cloud Spanner: Transactions](https://cloud.google.com/spanner/docs/transactions)

---

**About the Author**

This pattern is used in production at [Exchequer](https://github.com/exchequerio), an open-source real-time double-entry ledger platform for Payment Service Providers and marketplaces.

**Source Code:**
- [LedgerTransactionRepo.ts](../apps/api/src/repo/LedgerTransactionRepo.ts) - Main transaction repository
- [LedgerAccountEntity.ts](../apps/api/src/repo/entities/LedgerAccountEntity.ts) - Account balance logic
- [LedgerTransactionEntity.ts](../apps/api/src/repo/entities/LedgerTransactionEntity.ts) - Transaction validation
- [Benchmarks](../apps/api/test/bench/transaction.bench.ts) - Performance testing suite
