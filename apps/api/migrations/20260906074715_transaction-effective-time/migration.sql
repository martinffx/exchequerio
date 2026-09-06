ALTER TABLE "ledger_transactions" ADD COLUMN "effective_at" timestamp with time zone;
--> statement-breakpoint
-- Historical effective dates discarded by the earlier migration cannot be recovered.
UPDATE "ledger_transactions" SET "effective_at" = "created";
--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "effective_at" SET NOT NULL;
