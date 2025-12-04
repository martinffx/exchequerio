ALTER TABLE "ledger_transaction_entries" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD COLUMN "currency" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD COLUMN "currency_exponent" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_organization_id_organizations_table_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_table"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_organization_id_organizations_table_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_table"("id") ON DELETE no action ON UPDATE no action;