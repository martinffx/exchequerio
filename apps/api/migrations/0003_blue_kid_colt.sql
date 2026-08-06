SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "idx_ledger_accounts_organization" ON "ledger_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_transaction_entries_organization" ON "ledger_transaction_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_transactions_organization" ON "ledger_transactions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_ledgers_organization" ON "ledgers" USING btree ("organization_id");
