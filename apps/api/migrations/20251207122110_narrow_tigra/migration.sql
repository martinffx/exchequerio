ALTER TABLE "ledger_account_settlements" RENAME COLUMN "ledger_transaction_id" TO "transaction_id";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" RENAME COLUMN "settled_ledger_account_id" TO "settled_account_id";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" RENAME COLUMN "contra_ledger_account_id" TO "contra_account_id";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "no_self_settle";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_ledger_transaction_id_ledger_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_settled_ledger_account_id_ledger_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_contra_ledger_account_id_ledger_accounts_id_fk";
--> statement-breakpoint
DROP INDEX "idx_settlements_settled_account";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_settled_account_id_ledger_accounts_id_fk" FOREIGN KEY ("settled_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_contra_account_id_ledger_accounts_id_fk" FOREIGN KEY ("contra_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_settlements_settled_account" ON "ledger_account_settlements" USING btree ("settled_account_id");--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "no_self_settle" CHECK ("ledger_account_settlements"."settled_account_id" <> "ledger_account_settlements"."contra_account_id");