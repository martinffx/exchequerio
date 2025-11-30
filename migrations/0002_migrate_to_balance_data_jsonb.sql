-- Migration: Migrate from balance_amount (numeric) to individual balance columns (bigint minor units)
-- Also migrate metadata from JSONB to TEXT for DSQL compatibility

-- Step 1: Add individual balance columns as BIGINT (integer minor units)
ALTER TABLE ledger_accounts 
  ADD COLUMN pending_amount BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN posted_amount BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN available_amount BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN pending_credits BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN pending_debits BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN posted_credits BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN posted_debits BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN available_credits BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN available_debits BIGINT NOT NULL DEFAULT 0;

-- Step 2: Migrate existing balance_amount to posted_amount and available_amount
-- Convert decimal balance to integer minor units: balance * 10^currency_exponent
-- Example: USD (exponent=2): 100.50 * 10^2 = 10050 minor units
UPDATE ledger_accounts la
SET 
  posted_amount = ROUND(la.balance_amount::numeric * POWER(10, l.currency_exponent))::bigint,
  available_amount = ROUND(la.balance_amount::numeric * POWER(10, l.currency_exponent))::bigint,
  pending_amount = 0,
  pending_credits = 0,
  pending_debits = 0,
  posted_credits = 0,
  posted_debits = 0,
  available_credits = 0,
  available_debits = 0
FROM ledgers l
WHERE la.ledger_id = l.id;

-- Step 3: Drop old balance_amount column and its index
DROP INDEX IF EXISTS idx_ledger_accounts_balance;
ALTER TABLE ledger_accounts DROP COLUMN balance_amount;

-- Step 4: Migrate metadata columns from JSONB to TEXT for DSQL compatibility
-- ledger_accounts.metadata
ALTER TABLE ledger_accounts ADD COLUMN metadata_text TEXT;
UPDATE ledger_accounts SET metadata_text = metadata::text WHERE metadata IS NOT NULL;
ALTER TABLE ledger_accounts DROP COLUMN metadata;
ALTER TABLE ledger_accounts RENAME COLUMN metadata_text TO metadata;

-- ledgers.metadata
ALTER TABLE ledgers ADD COLUMN metadata_text TEXT;
UPDATE ledgers SET metadata_text = metadata::text WHERE metadata IS NOT NULL;
ALTER TABLE ledgers DROP COLUMN metadata;
ALTER TABLE ledgers RENAME COLUMN metadata_text TO metadata;

-- organizations.metadata (if it exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organizations' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE organizations ADD COLUMN metadata_text TEXT;
    UPDATE organizations SET metadata_text = metadata::text WHERE metadata IS NOT NULL;
    ALTER TABLE organizations DROP COLUMN metadata;
    ALTER TABLE organizations RENAME COLUMN metadata_text TO metadata;
  END IF;
END $$;

-- Step 5: Create indexes on balance columns for common queries
CREATE INDEX idx_ledger_accounts_posted_balance 
  ON ledger_accounts (ledger_id, posted_amount);

CREATE INDEX idx_ledger_accounts_available_balance 
  ON ledger_accounts (ledger_id, available_amount);
