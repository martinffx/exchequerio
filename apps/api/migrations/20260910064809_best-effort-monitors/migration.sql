-- Stop accounting writes and drain the old relay before applying this migration.
DO $$
BEGIN
 LOCK TABLE balance_monitor_outbox IN ACCESS EXCLUSIVE MODE;
 IF EXISTS (SELECT 1 FROM balance_monitor_outbox) THEN
  RAISE EXCEPTION 'Balance monitor outbox must be drained before migration';
 END IF;
END $$;
--> statement-breakpoint
LOCK TABLE ledger_account_balance_monitors IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DELETE FROM ledger_account_balance_monitors WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
DROP TABLE "balance_monitor_outbox";--> statement-breakpoint
DROP TABLE "balance_monitor_revisions";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" DROP COLUMN "deleted_at";
