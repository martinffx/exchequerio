SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "currency_code" text;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD COLUMN "minor_unit_exponent" integer;--> statement-breakpoint
UPDATE "ledger_accounts" AS account
SET
	"currency_code" = ledger."currency",
	"minor_unit_exponent" = ledger."currency_exponent"
FROM "ledgers" AS ledger
WHERE ledger."id" = account."ledger_id";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "ledger_accounts" AS account
		LEFT JOIN "ledgers" AS ledger ON ledger."id" = account."ledger_id"
		WHERE account."currency_code" IS NULL
			OR btrim(account."currency_code") = ''
			OR account."minor_unit_exponent" IS NULL
			OR account."minor_unit_exponent" < 0
			OR ledger."id" IS NULL
			OR account."organization_id" <> ledger."organization_id"
	) THEN
		RAISE EXCEPTION 'Account Currency backfill verification failed';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "ledger_accounts"
		WHERE "pending_amount" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "posted_amount" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "available_amount" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "pending_credits" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "pending_debits" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "posted_credits" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "posted_debits" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "available_credits" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "available_debits" NOT BETWEEN -9007199254740991 AND 9007199254740991
	) THEN
		RAISE EXCEPTION 'Account balance safe-integer verification failed';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "ledger_transaction_entries" AS entry
		JOIN "ledger_accounts" AS account ON account."id" = entry."account_id"
		WHERE entry."currency" <> account."currency_code"
			OR entry."currency_exponent" <> account."minor_unit_exponent"
	) THEN
		RAISE EXCEPTION 'Transaction Entry Currency verification failed';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "ledger_account_settlements" AS settlement
		JOIN "ledger_accounts" AS settled ON settled."id" = settlement."settled_account_id"
		JOIN "ledger_accounts" AS contra ON contra."id" = settlement."contra_account_id"
		WHERE settlement."currency" <> settled."currency_code"
			OR settlement."currency_exponent" <> settled."minor_unit_exponent"
			OR settlement."currency" <> contra."currency_code"
			OR settlement."currency_exponent" <> contra."minor_unit_exponent"
	) THEN
		RAISE EXCEPTION 'Settlement Currency verification failed';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ALTER COLUMN "currency_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ALTER COLUMN "minor_unit_exponent" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "unique_ledgers_organization_id_id" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_ledger_id_ledgers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_ledger_fk" FOREIGN KEY ("organization_id","ledger_id") REFERENCES "public"."ledgers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_currency_code_not_blank" CHECK (btrim("ledger_accounts"."currency_code") <> '');--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_minor_unit_exponent_nonnegative" CHECK ("ledger_accounts"."minor_unit_exponent" >= 0);--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_balances_safe_integers" CHECK ("ledger_accounts"."pending_amount" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."posted_amount" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."available_amount" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."pending_credits" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."pending_debits" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."posted_credits" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."posted_debits" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."available_credits" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."available_debits" BETWEEN -9007199254740991 AND 9007199254740991);--> statement-breakpoint
ALTER TABLE "ledgers" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "ledgers" DROP COLUMN "currency_exponent";
