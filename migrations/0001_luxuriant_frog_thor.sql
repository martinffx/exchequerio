-- Add organization_id column as nullable first
ALTER TABLE "ledger_accounts" ADD COLUMN "organization_id" text;--> statement-breakpoint

-- Backfill organization_id from ledgers table
UPDATE "ledger_accounts" 
SET "organization_id" = (
  SELECT "organization_id" 
  FROM "ledgers" 
  WHERE "ledgers"."id" = "ledger_accounts"."ledger_id"
);--> statement-breakpoint

-- Make organization_id NOT NULL after backfill
ALTER TABLE "ledger_accounts" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint

-- Add foreign key constraint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_id_organizations_table_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_table"("id") ON DELETE no action ON UPDATE no action;