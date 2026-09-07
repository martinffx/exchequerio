SET LOCAL lock_timeout = '5s';
LOCK TABLE ledger_account_balance_monitors IN ACCESS EXCLUSIVE MODE;
-- Conditions were never persisted by the legacy scaffold. Require explicit operator resolution.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM ledger_account_balance_monitors) THEN
  RAISE EXCEPTION 'Legacy balance monitors cannot be migrated: export and explicitly remove/recreate them with alert conditions and webhook configuration before rerunning this migration.';
 END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "balance_monitor_outbox" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"ledger_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"account_version" integer NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_code" text NOT NULL,
	"minor_unit_exponent" integer NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"claim_token" uuid,
	"claim_until" timestamp with time zone,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_monitor_event_account_version_unique" UNIQUE("account_id","account_version")
);
--> statement-breakpoint
CREATE TABLE "balance_monitor_revisions" (
	"monitor_id" uuid,
	"version" integer,
	"account_id" uuid NOT NULL,
	"start_version" integer NOT NULL,
	"end_version" integer,
	"configuration" jsonb NOT NULL,
	CONSTRAINT "balance_monitor_revisions_pkey" PRIMARY KEY("monitor_id","version")
);
--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" DROP CONSTRAINT "ledger_account_balance_monitors_account_id_ledger_accounts_id_f";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "ledger_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "alert_condition" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "webhook_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "webhook_token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "lock_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "balance_monitor_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" DROP COLUMN "alert_threshold";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" DROP COLUMN "is_active";--> statement-breakpoint
CREATE INDEX "balance_monitor_outbox_claim_idx" ON "balance_monitor_outbox" ("claim_until","created");--> statement-breakpoint
CREATE INDEX "balance_monitor_revisions_account_idx" ON "balance_monitor_revisions" ("account_id","start_version");--> statement-breakpoint
CREATE INDEX "balance_monitors_account_idx" ON "ledger_account_balance_monitors" ("account_id");--> statement-breakpoint
ALTER TABLE "balance_monitor_revisions" ADD CONSTRAINT "balance_monitor_revisions_kKgq4rXfowDa_fkey" FOREIGN KEY ("monitor_id") REFERENCES "ledger_account_balance_monitors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD CONSTRAINT "balance_monitor_account_scope_fk" FOREIGN KEY ("organization_id","ledger_id","account_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_monitor_count_nonnegative" CHECK ("balance_monitor_count" >= 0);