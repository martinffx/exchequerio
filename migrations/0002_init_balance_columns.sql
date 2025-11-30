-- Drop old balance_amount column
ALTER TABLE "ledger_accounts" DROP COLUMN IF EXISTS "balance_amount";--> statement-breakpoint

-- Add individual balance columns as BIGINT
ALTER TABLE "ledger_accounts" ADD COLUMN "pending_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "posted_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "available_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "pending_credits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "pending_debits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "posted_credits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "posted_debits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "available_credits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "available_debits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Migrate metadata columns from JSONB to TEXT
ALTER TABLE "ledger_accounts" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledgers" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint

-- Drop old index
DROP INDEX IF EXISTS "idx_ledger_accounts_balance";--> statement-breakpoint

-- Create new indexes for balance columns
CREATE INDEX IF NOT EXISTS "idx_ledger_accounts_posted_balance" ON "ledger_accounts" USING btree ("ledger_id","posted_amount");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ledger_accounts_available_balance" ON "ledger_accounts" USING btree ("ledger_id","available_amount");
