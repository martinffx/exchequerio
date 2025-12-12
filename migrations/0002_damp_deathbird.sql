-- Add ledger_id column as nullable first
ALTER TABLE "ledger_account_statements" ADD COLUMN "ledger_id" text;--> statement-breakpoint

-- Populate ledger_id from the account's ledger
UPDATE "ledger_account_statements" 
SET "ledger_id" = (
  SELECT "ledger_id" 
  FROM "ledger_accounts" 
  WHERE "ledger_accounts"."id" = "ledger_account_statements"."account_id"
);--> statement-breakpoint

-- Make ledger_id NOT NULL
ALTER TABLE "ledger_account_statements" ALTER COLUMN "ledger_id" SET NOT NULL;--> statement-breakpoint

-- Add foreign key constraint
ALTER TABLE "ledger_account_statements" ADD CONSTRAINT "ledger_account_statements_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;
