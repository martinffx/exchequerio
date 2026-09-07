-- Apply after recreating the database. Existing TypeID text is not castable to UUID.
ALTER TABLE "ledger_account_balance_monitors" DROP CONSTRAINT "ledger_account_balance_monitors_account_id_ledger_accounts_id_f";--> statement-breakpoint
ALTER TABLE "ledger_account_categories" DROP CONSTRAINT "ledger_account_categories_10ZpzutUYSZO_fkey";--> statement-breakpoint
ALTER TABLE "ledger_account_categories" DROP CONSTRAINT "ledger_account_categories_organization_ledger_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" DROP CONSTRAINT "ledger_account_category_accounts_account_ownership_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" DROP CONSTRAINT "ledger_account_category_accounts_category_ownership_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" DROP CONSTRAINT "ledger_account_category_accounts_z2oJDWm1j0ll_fkey";--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" DROP CONSTRAINT "ledger_account_category_parents_EjxA1DFRZvSc_fkey";--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" DROP CONSTRAINT "ledger_account_category_parents_child_ownership_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" DROP CONSTRAINT "ledger_account_category_parents_parent_ownership_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" DROP CONSTRAINT "no_self_reference";--> statement-breakpoint
ALTER TABLE "ledger_account_settlement_entries" DROP CONSTRAINT "ledger_account_settlement_entries_entry_id_ledger_transaction_e";--> statement-breakpoint
ALTER TABLE "ledger_account_settlement_entries" DROP CONSTRAINT "ledger_account_settlement_entries_settlement_id_ledger_account_";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_Y3rqDXe6jv1j_fkey";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_contra_account_id_ledger_accounts_id";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_jFCYNwGVrSmf_fkey";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_organization_id_organizations_table_";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_settled_account_id_ledger_accounts_i";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "ledger_account_settlements_towB8SwcySZt_fkey";--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" DROP CONSTRAINT "no_self_settle";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP CONSTRAINT "ledger_account_statements_account_id_ledger_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_statements" DROP CONSTRAINT "ledger_account_statements_ledger_id_ledgers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_organization_id_organizations_table_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_organization_ledger_fk";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "ledger_transaction_entries_account_ownership_fk";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "ledger_transaction_entries_organization_id_organizations_table_";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "ledger_transaction_entries_transaction_ownership_fk";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_eZ1dhlX7qrxY_fkey";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_organization_id_organizations_table_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_organization_ledger_fk";--> statement-breakpoint
ALTER TABLE "ledgers" DROP CONSTRAINT "ledgers_organization_id_organizations_table_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ALTER COLUMN "account_id" SET DATA TYPE uuid USING "account_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ALTER COLUMN "ledger_id" SET DATA TYPE uuid USING "ledger_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ALTER COLUMN "parent_category_id" SET DATA TYPE uuid USING "parent_category_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ALTER COLUMN "category_id" SET DATA TYPE uuid USING "category_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ALTER COLUMN "account_id" SET DATA TYPE uuid USING "account_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ALTER COLUMN "category_id" SET DATA TYPE uuid USING "category_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ALTER COLUMN "parent_category_id" SET DATA TYPE uuid USING "parent_category_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_settlement_entries" ALTER COLUMN "settlement_id" SET DATA TYPE uuid USING "settlement_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_settlement_entries" ALTER COLUMN "entry_id" SET DATA TYPE uuid USING "entry_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "settled_account_id" SET DATA TYPE uuid USING "settled_account_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "contra_account_id" SET DATA TYPE uuid USING "contra_account_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "ledger_id" SET DATA TYPE uuid USING "ledger_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ALTER COLUMN "account_id" SET DATA TYPE uuid USING "account_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ALTER COLUMN "ledger_id" SET DATA TYPE uuid USING "ledger_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "transaction_id" SET DATA TYPE uuid USING "transaction_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "account_id" SET DATA TYPE uuid USING "account_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "ledger_id" SET DATA TYPE uuid USING "ledger_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "ledger_id" SET DATA TYPE uuid USING "ledger_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledgers" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "ledgers" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "organizations_table" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ALTER COLUMN "ledger_id" SET DATA TYPE uuid USING "ledger_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "settlement_id" SET DATA TYPE uuid USING "settlement_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ALTER COLUMN "ledger_id" SET DATA TYPE uuid USING "ledger_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ALTER COLUMN "organization_id" SET DATA TYPE uuid USING "organization_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ALTER COLUMN "ledger_id" SET DATA TYPE uuid USING "ledger_id"::uuid;--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD CONSTRAINT "ledger_account_balance_monitors_account_id_ledger_accounts_id_f" FOREIGN KEY (account_id) REFERENCES ledger_accounts(id);--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ADD CONSTRAINT "ledger_account_categories_10ZpzutUYSZO_fkey" FOREIGN KEY (organization_id) REFERENCES organizations_table(id);--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ADD CONSTRAINT "ledger_account_categories_organization_ledger_fk" FOREIGN KEY (organization_id, ledger_id) REFERENCES ledgers(organization_id, id);--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD CONSTRAINT "ledger_account_category_accounts_account_ownership_fk" FOREIGN KEY (organization_id, ledger_id, account_id) REFERENCES ledger_accounts(organization_id, ledger_id, id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD CONSTRAINT "ledger_account_category_accounts_category_ownership_fk" FOREIGN KEY (organization_id, ledger_id, category_id) REFERENCES ledger_account_categories(organization_id, ledger_id, id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD CONSTRAINT "ledger_account_category_accounts_z2oJDWm1j0ll_fkey" FOREIGN KEY (organization_id) REFERENCES organizations_table(id);--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD CONSTRAINT "ledger_account_category_parents_EjxA1DFRZvSc_fkey" FOREIGN KEY (organization_id) REFERENCES organizations_table(id);--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD CONSTRAINT "ledger_account_category_parents_child_ownership_fk" FOREIGN KEY (organization_id, ledger_id, category_id) REFERENCES ledger_account_categories(organization_id, ledger_id, id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD CONSTRAINT "ledger_account_category_parents_parent_ownership_fk" FOREIGN KEY (organization_id, ledger_id, parent_category_id) REFERENCES ledger_account_categories(organization_id, ledger_id, id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD CONSTRAINT "no_self_reference" CHECK ((category_id <> parent_category_id));--> statement-breakpoint
ALTER TABLE "ledger_account_settlement_entries" ADD CONSTRAINT "ledger_account_settlement_entries_entry_id_ledger_transaction_e" FOREIGN KEY (entry_id) REFERENCES ledger_transaction_entries(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_settlement_entries" ADD CONSTRAINT "ledger_account_settlement_entries_settlement_id_ledger_account_" FOREIGN KEY (settlement_id) REFERENCES ledger_account_settlements(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_Y3rqDXe6jv1j_fkey" FOREIGN KEY (organization_id, ledger_id, settled_account_id) REFERENCES ledger_accounts(organization_id, ledger_id, id);--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_contra_account_id_ledger_accounts_id" FOREIGN KEY (contra_account_id) REFERENCES ledger_accounts(id);--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_jFCYNwGVrSmf_fkey" FOREIGN KEY (organization_id, ledger_id, contra_account_id) REFERENCES ledger_accounts(organization_id, ledger_id, id);--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_organization_id_organizations_table_" FOREIGN KEY (organization_id) REFERENCES organizations_table(id);--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_settled_account_id_ledger_accounts_i" FOREIGN KEY (settled_account_id) REFERENCES ledger_accounts(id);--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_towB8SwcySZt_fkey" FOREIGN KEY (organization_id, ledger_id) REFERENCES ledgers(organization_id, id);--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "no_self_settle" CHECK ((settled_account_id <> contra_account_id));--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD CONSTRAINT "ledger_account_statements_account_id_ledger_accounts_id_fk" FOREIGN KEY (account_id) REFERENCES ledger_accounts(id);--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD CONSTRAINT "ledger_account_statements_ledger_id_ledgers_id_fk" FOREIGN KEY (ledger_id) REFERENCES ledgers(id);--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_id_organizations_table_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations_table(id);--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_ledger_fk" FOREIGN KEY (organization_id, ledger_id) REFERENCES ledgers(organization_id, id);--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_account_ownership_fk" FOREIGN KEY (organization_id, ledger_id, account_id) REFERENCES ledger_accounts(organization_id, ledger_id, id);--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_organization_id_organizations_table_" FOREIGN KEY (organization_id) REFERENCES organizations_table(id);--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_transaction_ownership_fk" FOREIGN KEY (organization_id, ledger_id, transaction_id) REFERENCES ledger_transactions(organization_id, ledger_id, id);--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_eZ1dhlX7qrxY_fkey" FOREIGN KEY (organization_id, ledger_id, settlement_id) REFERENCES ledger_account_settlements(organization_id, ledger_id, id);--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_organization_id_organizations_table_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations_table(id);--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_organization_ledger_fk" FOREIGN KEY (organization_id, ledger_id) REFERENCES ledgers(organization_id, id);--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "ledgers_organization_id_organizations_table_id_fk" FOREIGN KEY (organization_id) REFERENCES organizations_table(id);
