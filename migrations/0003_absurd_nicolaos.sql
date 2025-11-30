ALTER TABLE "ledger_accounts" RENAME COLUMN "balance_amount" TO "pending_amount";--> statement-breakpoint
DROP INDEX "idx_ledger_accounts_balance";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "amount" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledgers" ALTER COLUMN "metadata" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "posted_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "available_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "pending_credits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "pending_debits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "posted_credits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "posted_debits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "available_credits" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "available_debits" bigint DEFAULT 0 NOT NULL;