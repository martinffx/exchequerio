SET LOCAL lock_timeout = '5s';--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "ledger_transactions")
		OR EXISTS (SELECT 1 FROM "ledger_transaction_entries") THEN
		RAISE EXCEPTION 'transactions Effect migration requires empty ledger_transactions and ledger_transaction_entries tables';
	END IF;
END $$;--> statement-breakpoint

ALTER TABLE "ledger_transaction_entries" ADD COLUMN "ledger_id" text;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "lock_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "ledger_transaction_entries_transaction_id_ledger_transactions_i";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "ledger_transaction_entries_account_id_ledger_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_ledger_id_ledgers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "positive_amount";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_minor_unit_exponent_nonnegative";--> statement-breakpoint
DROP INDEX "idx_ledger_transactions_created";--> statement-breakpoint
DROP INDEX "idx_ledger_transactions_effective_at";--> statement-breakpoint
DROP INDEX "idx_ledger_transaction_entries_status";--> statement-breakpoint

ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
DROP TYPE "ledger_transaction_status";--> statement-breakpoint
CREATE TYPE "ledger_transaction_status" AS ENUM('pending', 'posted', 'voided');--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "status" SET DATA TYPE "ledger_transaction_status" USING "status"::"ledger_transaction_status";--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "status" SET DATA TYPE "ledger_transaction_status" USING "status"::"ledger_transaction_status";--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "status" SET DEFAULT 'pending'::"ledger_transaction_status";--> statement-breakpoint

ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "ledger_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP COLUMN "currency_exponent";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP COLUMN "updated";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP COLUMN "idempotency_key";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP COLUMN "effective_at";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP COLUMN "currency_exponent";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP COLUMN "minor_unit_exponent";--> statement-breakpoint
ALTER TABLE "ledger_accounts" ALTER COLUMN "lock_version" SET DEFAULT 1;--> statement-breakpoint

ALTER TABLE "ledger_accounts" ADD CONSTRAINT "unique_ledger_accounts_organization_ledger_id" UNIQUE("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "unique_ledger_transactions_organization_ledger_id" UNIQUE("organization_id","ledger_id","id");--> statement-breakpoint
CREATE INDEX "idx_ledger_transactions_ledger_created_id" ON "ledger_transactions" ("ledger_id","created" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_transaction_ownership_fk" FOREIGN KEY ("organization_id","ledger_id","transaction_id") REFERENCES "ledger_transactions"("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_account_ownership_fk" FOREIGN KEY ("organization_id","ledger_id","account_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_organization_ledger_fk" FOREIGN KEY ("organization_id","ledger_id") REFERENCES "ledgers"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_amount_positive_and_safe" CHECK ("amount" > 0 AND "amount" <= 9007199254740991);
