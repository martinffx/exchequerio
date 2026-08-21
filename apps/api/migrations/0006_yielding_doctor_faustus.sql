ALTER TABLE "ledger_accounts" ALTER COLUMN "lock_version" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "lock_version" integer DEFAULT 1 NOT NULL;