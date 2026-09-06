DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM ledger_account_settlements) OR EXISTS (SELECT 1 FROM ledger_account_settlement_entries) THEN
  RAISE EXCEPTION 'Settlement corrections require empty Settlement tables';
 END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD COLUMN "ledger_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD COLUMN "allow_either_direction" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD COLUMN "target_status" "ledger_transaction_status";--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "settlement_id" text;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "ledger_settlement_status";--> statement-breakpoint
CREATE TYPE "ledger_settlement_status" AS ENUM('drafting', 'processing', 'pending', 'posted', 'voided');--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "status" SET DATA TYPE "ledger_settlement_status" USING "status"::"ledger_settlement_status";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "status" SET DEFAULT 'drafting'::"ledger_settlement_status";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP COLUMN "transaction_id";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP COLUMN "amount";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP COLUMN "normal_balance";--> statement-breakpoint
DROP INDEX "idx_settlement_entries_entry";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_settlement_entries_entry" ON "ledger_account_settlement_entries" ("entry_id");--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "unique_settlements_organization_ledger_id" UNIQUE("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "unique_transaction_settlement" UNIQUE("settlement_id");--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_towB8SwcySZt_fkey" FOREIGN KEY ("organization_id","ledger_id") REFERENCES "ledgers"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_Y3rqDXe6jv1j_fkey" FOREIGN KEY ("organization_id","ledger_id","settled_account_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_jFCYNwGVrSmf_fkey" FOREIGN KEY ("organization_id","ledger_id","contra_account_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_eZ1dhlX7qrxY_fkey" FOREIGN KEY ("organization_id","ledger_id","settlement_id") REFERENCES "ledger_account_settlements"("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "settlement_processing_target" CHECK (("status" = 'processing') = ("target_status" IS NOT NULL));