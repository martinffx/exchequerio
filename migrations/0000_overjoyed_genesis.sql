CREATE TYPE "public"."ledger_entry_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."ledger_normal_balance" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."ledger_settlement_status" AS ENUM('drafting', 'processing', 'pending', 'posted', 'archiving', 'archived');--> statement-breakpoint
CREATE TYPE "public"."ledger_transaction_status" AS ENUM('pending', 'posted', 'archived');--> statement-breakpoint
CREATE TABLE "ledger_account_balance_monitors" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"alert_threshold" numeric(20, 4) DEFAULT '0' NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_account_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"normal_balance" "ledger_normal_balance" NOT NULL,
	"parent_category_id" text,
	"metadata" jsonb,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_account_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"settlement_date" timestamp with time zone DEFAULT now() NOT NULL,
	"settlement_amount" numeric(20, 4) DEFAULT '0' NOT NULL,
	"status" "ledger_settlement_status" DEFAULT 'drafting' NOT NULL,
	"external_reference" text,
	"metadata" jsonb,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_account_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"statement_date" timestamp with time zone NOT NULL,
	"opening_balance" numeric(20, 4) DEFAULT '0' NOT NULL,
	"closing_balance" numeric(20, 4) DEFAULT '0' NOT NULL,
	"total_credits" numeric(20, 4) DEFAULT '0' NOT NULL,
	"total_debits" numeric(20, 4) DEFAULT '0' NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"normal_balance" "ledger_normal_balance" NOT NULL,
	"balance_amount" numeric(20, 4) DEFAULT '0' NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transaction_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"direction" "ledger_entry_direction" NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"status" "ledger_transaction_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positive_amount" CHECK ("ledger_transaction_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_id" text NOT NULL,
	"idempotency_key" text,
	"description" text,
	"status" "ledger_transaction_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ledgers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"currency_exponent" integer DEFAULT 2 NOT NULL,
	"metadata" jsonb,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations_table" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_account_balance_monitors" ADD CONSTRAINT "ledger_account_balance_monitors_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ADD CONSTRAINT "ledger_account_categories_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account_settlements" ADD CONSTRAINT "ledger_account_settlements_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account_statements" ADD CONSTRAINT "ledger_account_statements_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "ledgers_organization_id_organizations_table_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations_table"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ledger_account_settlements_batch" ON "ledger_account_settlements" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_account_settlements_status" ON "ledger_account_settlements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ledger_account_settlements_date" ON "ledger_account_settlements" USING btree ("settlement_date");--> statement-breakpoint
CREATE INDEX "idx_ledger_accounts_balance" ON "ledger_accounts" USING btree ("ledger_id","balance_amount");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_account_name_per_ledger" ON "ledger_accounts" USING btree ("ledger_id","name");--> statement-breakpoint
CREATE INDEX "idx_ledger_transaction_entries_account" ON "ledger_transaction_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_transaction_entries_transaction" ON "ledger_transaction_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_transaction_entries_status" ON "ledger_transaction_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ledger_transactions_status" ON "ledger_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ledger_transactions_created" ON "ledger_transactions" USING btree ("created");