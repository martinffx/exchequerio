SET LOCAL lock_timeout = '5s';--> statement-breakpoint

ALTER TABLE "ledger_account_categories" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD COLUMN "ledger_id" text;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD COLUMN "ledger_id" text;--> statement-breakpoint

UPDATE "ledger_account_categories" AS category
SET "organization_id" = ledger."organization_id"
FROM "ledgers" AS ledger
WHERE category."ledger_id" = ledger."id";--> statement-breakpoint

UPDATE "ledger_account_category_accounts" AS relationship
SET "organization_id" = category."organization_id",
	"ledger_id" = category."ledger_id"
FROM "ledger_account_categories" AS category
WHERE relationship."category_id" = category."id";--> statement-breakpoint

UPDATE "ledger_account_category_parents" AS relationship
SET "organization_id" = category."organization_id",
	"ledger_id" = category."ledger_id"
FROM "ledger_account_categories" AS category
WHERE relationship."category_id" = category."id";--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "ledger_account_category_accounts" AS relationship
		JOIN "ledger_accounts" AS account ON account."id" = relationship."account_id"
		WHERE account."organization_id" <> relationship."organization_id"
			OR account."ledger_id" <> relationship."ledger_id"
	) THEN
		RAISE EXCEPTION 'category ownership migration found Account relationships outside the Category Organization or Ledger';
	END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "ledger_account_category_parents" AS relationship
		JOIN "ledger_account_categories" AS parent ON parent."id" = relationship."parent_category_id"
		WHERE parent."organization_id" <> relationship."organization_id"
			OR parent."ledger_id" <> relationship."ledger_id"
	) THEN
		RAISE EXCEPTION 'category ownership migration found parent relationships outside the child Category Organization or Ledger';
	END IF;
END $$;--> statement-breakpoint

ALTER TABLE "ledger_account_categories" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ALTER COLUMN "ledger_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ALTER COLUMN "ledger_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "ledger_account_categories" DROP CONSTRAINT "ledger_account_categories_ledger_id_ledgers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" DROP CONSTRAINT "ledger_account_category_accounts_category_id_ledger_account_cat";--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" DROP CONSTRAINT "ledger_account_category_accounts_account_id_ledger_accounts_id_";--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" DROP CONSTRAINT "ledger_account_category_parents_category_id_ledger_account_cate";--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" DROP CONSTRAINT "ledger_account_category_parents_parent_category_id_ledger_accou";--> statement-breakpoint

ALTER TABLE "ledger_account_categories" ADD CONSTRAINT "unique_ledger_account_categories_organization_ledger_id" UNIQUE("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ADD CONSTRAINT "ledger_account_categories_10ZpzutUYSZO_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations_table"("id");--> statement-breakpoint
ALTER TABLE "ledger_account_categories" ADD CONSTRAINT "ledger_account_categories_organization_ledger_fk" FOREIGN KEY ("organization_id","ledger_id") REFERENCES "ledgers"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD CONSTRAINT "ledger_account_category_accounts_z2oJDWm1j0ll_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations_table"("id");--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD CONSTRAINT "ledger_account_category_accounts_category_ownership_fk" FOREIGN KEY ("organization_id","ledger_id","category_id") REFERENCES "ledger_account_categories"("organization_id","ledger_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_category_accounts" ADD CONSTRAINT "ledger_account_category_accounts_account_ownership_fk" FOREIGN KEY ("organization_id","ledger_id","account_id") REFERENCES "ledger_accounts"("organization_id","ledger_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD CONSTRAINT "ledger_account_category_parents_EjxA1DFRZvSc_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations_table"("id");--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD CONSTRAINT "ledger_account_category_parents_child_ownership_fk" FOREIGN KEY ("organization_id","ledger_id","category_id") REFERENCES "ledger_account_categories"("organization_id","ledger_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_account_category_parents" ADD CONSTRAINT "ledger_account_category_parents_parent_ownership_fk" FOREIGN KEY ("organization_id","ledger_id","parent_category_id") REFERENCES "ledger_account_categories"("organization_id","ledger_id","id") ON DELETE CASCADE;
