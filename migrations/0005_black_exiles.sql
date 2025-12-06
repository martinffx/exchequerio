CREATE TABLE "ledger_account_category_accounts" (
	"category_id" text NOT NULL,
	"account_id" text NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_category_accounts_category_id_account_id_pk" PRIMARY KEY("category_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_account_category_parents" (
	"category_id" text NOT NULL,
	"parent_category_id" text NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_category_parents_category_id_parent_category_id_pk" PRIMARY KEY("category_id","parent_category_id"),
	CONSTRAINT "no_self_reference" CHECK ("ledger_account_category_parents"."category_id" <> "ledger_account_category_parents"."parent_category_id")
);
--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD CONSTRAINT "ledger_account_category_accounts_category_id_ledger_account_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ledger_account_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD CONSTRAINT "ledger_account_category_accounts_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD CONSTRAINT "ledger_account_category_parents_category_id_ledger_account_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ledger_account_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD CONSTRAINT "ledger_account_category_parents_parent_category_id_ledger_account_categories_id_fk" FOREIGN KEY ("parent_category_id") REFERENCES "public"."ledger_account_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_category_accounts_account" ON "ledger_account_category_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_category_parents_parent" ON "ledger_account_category_parents" USING btree ("parent_category_id");