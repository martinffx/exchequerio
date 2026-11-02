-- Placeholder Statements contain no accounting snapshot and cannot be migrated.
-- This deletion is irreversible once the migration commits; stop the API before applying it.
DELETE FROM "ledger_account_statements";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP CONSTRAINT "ledger_account_statements_ledger_id_ledgers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP CONSTRAINT "ledger_account_statements_account_id_ledger_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD COLUMN "start_datetime" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD COLUMN "end_datetime" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD COLUMN "ledger_account_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD COLUMN "snapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD COLUMN "lock_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP COLUMN "statement_date";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP COLUMN "opening_balance";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP COLUMN "closing_balance";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP COLUMN "total_credits";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP COLUMN "total_debits";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP COLUMN "transaction_count";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "metadata" SET DATA TYPE jsonb USING "metadata"::jsonb;--> statement-breakpoint
CREATE INDEX "idx_ledger_account_statements_account_created" ON "ledger_account_statements" ("organization_id","ledger_id","account_id","created" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD CONSTRAINT "ledger_account_statements_organization_ledger_account_fk" FOREIGN KEY ("organization_id","ledger_id","account_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD CONSTRAINT "ledger_account_statements_period_valid" CHECK ("start_datetime" < "end_datetime");