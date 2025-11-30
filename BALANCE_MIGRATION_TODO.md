# Balance Data Migration - DSQL Compatible (Individual Columns)

## Completed ✅
1. ✅ Migration 0002 created with individual balance columns (bigint) instead of JSONB
2. ✅ Schema updated - balanceData JSONB → 9 individual bigint columns, metadata jsonb → text
3. ✅ LedgerAccountEntity updated - individual balance fields, metadata parsing (JSON.parse/stringify)
4. ✅ fixtures.ts updated with individual balance fields

## Schema Changes

### Before (JSONB - NOT supported by DSQL)
```typescript
balanceData: jsonb("balance_data")
metadata: jsonb("metadata")
```

### After (Individual Columns - DSQL Compatible)
```typescript
// Individual balance columns as BIGINT (integer minor units)
pendingAmount: bigint("pending_amount", { mode: "number" }).notNull().default(0)
postedAmount: bigint("posted_amount", { mode: "number" }).notNull().default(0)
availableAmount: bigint("available_amount", { mode: "number" }).notNull().default(0)
pendingCredits: bigint("pending_credits", { mode: "number" }).notNull().default(0)
pendingDebits: bigint("pending_debits", { mode: "number" }).notNull().default(0)
postedCredits: bigint("posted_credits", { mode: "number" }).notNull().default(0)
postedDebits: bigint("posted_debits", { mode: "number" }).notNull().default(0)
availableCredits: bigint("available_credits", { mode: "number" }).notNull().default(0)
availableDebits: bigint("available_debits", { mode: "number" }).notNull().default(0)

// Metadata as TEXT (JSON string)
metadata: text("metadata")
```

## Remaining Tasks

### High Priority

**1. Update LedgerTransactionRepo.ts balance update logic** (~30 min)

Current (lines 132-162):
```typescript
// ❌ Uses balanceAmount (numeric) with float arithmetic
const currentBalance = Number.parseFloat(account.balanceAmount);
const newBalance = currentBalance + entryAmount;
await updateAccountBalanceInternal(accountId, newBalance.toFixed(4), ...);
```

Needs to become:
```typescript
// ✅ Uses individual balance fields with integer arithmetic
const postedAmount = account.postedAmount; // Already an integer
const entryAmountMinor = parseInt(entryEntity.amount); // Assuming minor units

// Update posted balance with integer arithmetic
let newPostedAmount: number;
if (account.normalBalance === "debit") {
  newPostedAmount = entryEntity.direction === "debit"
    ? postedAmount + entryAmountMinor
    : postedAmount - entryAmountMinor;
} else {
  newPostedAmount = entryEntity.direction === "credit"
    ? postedAmount + entryAmountMinor
    : postedAmount - entryAmountMinor;
}

// Update the account record
await tx.update(LedgerAccountsTable)
  .set({
    postedAmount: newPostedAmount,
    availableAmount: newPostedAmount,
    postedCredits: ..., // Update if credit
    postedDebits: ...,  // Update if debit
    lockVersion: account.lockVersion + 1,
    updated: new Date(),
  })
  .where(...);
```

### Medium Priority

**2. Update Test Files** (~45 min)

Files needing updates:
- `src/repo/LedgerRepo.test.ts` (lines 50, 120, 131)
- `src/repo/LedgerTransactionRepo.test.ts` (lines 53, 122, 177, 178, 220, 221, 582, 583, 664, 715, 764, 821, 822, 866, 867)

Changes needed:
```typescript
// ❌ OLD
{ balanceAmount: "0" }
expect(account.balanceAmount).toBe("100.0000");

// ✅ NEW
{ postedAmount: 0, availableAmount: 0, ... } // All balance fields
expect(account.postedAmount).toBe(100000); // Minor units (100.00 USD = 10000)
```

**3. Update Other Entities with Metadata** (~15 min)

Files to update (metadata JSON.parse/stringify):
- `src/services/entities/LedgerEntity.ts`
- `src/services/entities/OrganizationEntity.ts`
- Any other entities with `metadata` field

Pattern:
```typescript
// fromRecord
metadata: record.metadata ? JSON.parse(record.metadata) : undefined

// toRecord
metadata: this.metadata ? JSON.stringify(this.metadata) : undefined
```

## Testing Plan

1. Run migration: `drizzle-kit push` or apply 0002 manually
2. Run type check: `bun run types`
3. Fix remaining test failures
4. Run full test suite: `mise run test`
5. Verify balance calculations with integer arithmetic

## Benefits of This Approach

1. ✅ **DSQL Compatible** - No JSONB dependency
2. ✅ **Integer Precision** - No floating point errors
3. ✅ **Better Indexing** - Can index individual balance columns  
4. ✅ **Query Flexibility** - Direct SQL queries on balance fields
5. ✅ **Type Safety** - BIGINT natively maps to number in TypeScript

## Key Design Points

- **All amounts are integers** in minor units (e.g., 10050 = $100.50 for USD)
- **Currency exponent** from ledger determines decimal places for display
- **Metadata stored as TEXT** with JSON.parse/stringify in entity layer
- **Balance updates** use integer arithmetic only
- **toResponse()** now requires currency/currencyExponent parameters from ledger

## Estimated Remaining Time

- LedgerTransactionRepo updates: 30 min
- Test file updates: 45 min
- Other entity metadata: 15 min
- Testing & verification: 15 min

**Total: ~1.75 hours**
