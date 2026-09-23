SET LOCAL lock_timeout = '5s';
LOCK TABLE ledger_account_balance_monitors IN ACCESS EXCLUSIVE MODE;
-- Conditions were never persisted by the legacy scaffold. Require explicit operator resolution.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM ledger_account_balance_monitors) THEN
  RAISE EXCEPTION 'Legacy balance monitors cannot be migrated: export and explicitly remove/recreate them with alert conditions and webhook configuration before rerunning this migration.';
 END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" DROP CONSTRAINT "ledger_account_balance_monitors_account_id_ledger_accounts_id_f";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "ledger_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "alert_condition" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "webhook_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "webhook_signing_secret" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "lock_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" DROP COLUMN "alert_threshold";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" DROP COLUMN "is_active";--> statement-breakpoint
CREATE INDEX "balance_monitors_account_idx" ON "ledger_account_balance_monitors" ("account_id");--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD CONSTRAINT "balance_monitor_account_scope_fk" FOREIGN KEY ("organization_id","ledger_id","account_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id");
