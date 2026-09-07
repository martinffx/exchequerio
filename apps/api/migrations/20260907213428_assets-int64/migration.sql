SET LOCAL lock_timeout = '5s';--> statement-breakpoint

-- Clean cutover: existing currency strings do not determine an Asset exponent.
-- Lock before checking so concurrent writes cannot pass the empty-data precondition.
LOCK TABLE "ledger_accounts", "ledger_transaction_entries", "ledger_account_settlements" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM ledger_accounts)
 OR EXISTS (SELECT 1 FROM ledger_transaction_entries)
 OR EXISTS (SELECT 1 FROM ledger_account_settlements) THEN
  RAISE EXCEPTION 'Asset cutover requires empty accounting tables; use a fresh development database. Legacy currency-to-Asset migration is not supported.';
 END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"minor_unit_exponent" integer NOT NULL,
	"description" text,
	"metadata" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "assets_organization_code_unique" UNIQUE("organization_id","code"),
	CONSTRAINT "assets_code_valid" CHECK ("code" ~ '^[A-Z0-9._:-]{1,64}$'),
	CONSTRAINT "assets_name_not_blank" CHECK (btrim("name") <> ''),
	CONSTRAINT "assets_exponent_valid" CHECK ("minor_unit_exponent" BETWEEN 0 AND 18)
);
--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_Y3rqDXe6jv1j_fkey";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_jFCYNwGVrSmf_fkey";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "ledger_transaction_entries_amount_positive_and_safe";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_currency_code_not_blank";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_balances_safe_integers";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD COLUMN "asset_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "asset_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD COLUMN "asset_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP COLUMN "currency_code";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ALTER COLUMN "alert_threshold" SET DATA TYPE bigint USING "alert_threshold"::bigint;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ALTER COLUMN "alert_threshold" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "opening_balance" SET DATA TYPE bigint USING "opening_balance"::bigint;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "opening_balance" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "closing_balance" SET DATA TYPE bigint USING "closing_balance"::bigint;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "closing_balance" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "total_credits" SET DATA TYPE bigint USING "total_credits"::bigint;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "total_credits" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "total_debits" SET DATA TYPE bigint USING "total_debits"::bigint;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "total_debits" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_ownership_asset_unique" UNIQUE("organization_id","ledger_id","id","asset_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organizations_table_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations_table"("id");--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_x59EnC75U5FZ_fkey" FOREIGN KEY ("organization_id","ledger_id","settled_account_id","asset_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id","asset_id");--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_lv8egsMDTtjv_fkey" FOREIGN KEY ("organization_id","ledger_id","contra_account_id","asset_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id","asset_id");--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_asset_ownership_fk" FOREIGN KEY ("organization_id","asset_id") REFERENCES "assets"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "ledger_transaction_entries_account_ownership_fk", ADD CONSTRAINT "ledger_transaction_entries_account_ownership_fk" FOREIGN KEY ("organization_id","ledger_id","account_id","asset_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id","asset_id");--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_amount_positive" CHECK ("amount" > 0);
