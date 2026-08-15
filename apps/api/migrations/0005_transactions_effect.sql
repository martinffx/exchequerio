SET LOCAL lock_timeout = '5s';--> statement-breakpoint

-- Expand first so every verification and backfill can run before contraction.
ALTER TABLE "ledger_transactions" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD COLUMN "ledger_id" text;--> statement-breakpoint

UPDATE "ledger_transaction_entries" AS entry
SET "ledger_id" = transaction."ledger_id"
FROM "ledger_transactions" AS transaction
WHERE transaction."id" = entry."transaction_id";--> statement-breakpoint

UPDATE "ledger_transactions"
SET "posted_at" = "updated"
WHERE "status" = 'posted';--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "ledger_transactions" AS transaction
		LEFT JOIN "ledgers" AS ledger ON ledger."id" = transaction."ledger_id"
		WHERE ledger."id" IS NULL
			OR transaction."organization_id" <> ledger."organization_id"
	) THEN
		RAISE EXCEPTION 'Transaction tenancy verification failed';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "ledger_transactions"
		WHERE "status"::text NOT IN ('pending', 'posted', 'archived')
	) THEN
		RAISE EXCEPTION 'Transaction lifecycle verification failed';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "ledger_transaction_entries" AS entry
		LEFT JOIN "ledger_transactions" AS transaction ON transaction."id" = entry."transaction_id"
		LEFT JOIN "ledger_accounts" AS account ON account."id" = entry."account_id"
		WHERE transaction."id" IS NULL
			OR account."id" IS NULL
			OR entry."organization_id" <> transaction."organization_id"
			OR entry."organization_id" <> account."organization_id"
			OR transaction."ledger_id" <> account."ledger_id"
	) THEN
		RAISE EXCEPTION 'Transaction Entry tenancy verification failed';
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
		FROM "ledger_transaction_entries"
		WHERE "amount" <= 0 OR "amount" > 9007199254740991
	) THEN
		RAISE EXCEPTION 'Transaction Entry Amount verification failed';
	END IF;
END $$;--> statement-breakpoint

CREATE TEMP TABLE "transaction_effect_account_balances" ON COMMIT DROP AS
SELECT
	account."id" AS "account_id",
	COALESCE(SUM(entry."amount") FILTER (
		WHERE transaction."status" IN ('pending', 'posted') AND entry."direction" = 'credit'
	), 0)::numeric AS "pending_credits",
	COALESCE(SUM(entry."amount") FILTER (
		WHERE transaction."status" IN ('pending', 'posted') AND entry."direction" = 'debit'
	), 0)::numeric AS "pending_debits",
	COALESCE(SUM(entry."amount") FILTER (
		WHERE transaction."status" = 'posted' AND entry."direction" = 'credit'
	), 0)::numeric AS "posted_credits",
	COALESCE(SUM(entry."amount") FILTER (
		WHERE transaction."status" = 'posted' AND entry."direction" = 'debit'
	), 0)::numeric AS "posted_debits"
FROM "ledger_accounts" AS account
LEFT JOIN "ledger_transaction_entries" AS entry ON entry."account_id" = account."id"
LEFT JOIN "ledger_transactions" AS transaction ON transaction."id" = entry."transaction_id"
GROUP BY account."id";--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "transaction_effect_account_balances"
		WHERE "pending_credits" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "pending_debits" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "posted_credits" NOT BETWEEN -9007199254740991 AND 9007199254740991
			OR "posted_debits" NOT BETWEEN -9007199254740991 AND 9007199254740991
	) THEN
		RAISE EXCEPTION 'Account counter rebuild exceeds JavaScript safe integer range';
	END IF;
END $$;--> statement-breakpoint

UPDATE "ledger_accounts" AS account
SET
	"pending_credits" = balances."pending_credits"::bigint,
	"pending_debits" = balances."pending_debits"::bigint,
	"posted_credits" = balances."posted_credits"::bigint,
	"posted_debits" = balances."posted_debits"::bigint
FROM "transaction_effect_account_balances" AS balances
WHERE balances."account_id" = account."id";--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		WITH rebuilt AS (
			SELECT
				account."id" AS "account_id",
				COALESCE(SUM(entry."amount") FILTER (
					WHERE transaction."status" IN ('pending', 'posted') AND entry."direction" = 'credit'
				), 0)::bigint AS "pending_credits",
				COALESCE(SUM(entry."amount") FILTER (
					WHERE transaction."status" IN ('pending', 'posted') AND entry."direction" = 'debit'
				), 0)::bigint AS "pending_debits",
				COALESCE(SUM(entry."amount") FILTER (
					WHERE transaction."status" = 'posted' AND entry."direction" = 'credit'
				), 0)::bigint AS "posted_credits",
				COALESCE(SUM(entry."amount") FILTER (
					WHERE transaction."status" = 'posted' AND entry."direction" = 'debit'
				), 0)::bigint AS "posted_debits"
			FROM "ledger_accounts" AS account
			LEFT JOIN "ledger_transaction_entries" AS entry ON entry."account_id" = account."id"
			LEFT JOIN "ledger_transactions" AS transaction ON transaction."id" = entry."transaction_id"
			GROUP BY account."id"
		)
		SELECT 1
		FROM "ledger_accounts" AS account
		JOIN rebuilt ON rebuilt."account_id" = account."id"
		WHERE account."pending_credits" <> rebuilt."pending_credits"
			OR account."pending_debits" <> rebuilt."pending_debits"
			OR account."posted_credits" <> rebuilt."posted_credits"
			OR account."posted_debits" <> rebuilt."posted_debits"
	) THEN
		RAISE EXCEPTION 'Account counter rebuild verification failed';
	END IF;
END $$;--> statement-breakpoint

-- Contract only after all legacy data has been verified and rebuilt.
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_balances_safe_integers";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "positive_amount";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "ledger_transaction_entries_transaction_id_ledger_transactions_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP CONSTRAINT "ledger_transaction_entries_account_id_ledger_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_ledger_id_ledgers_id_fk";--> statement-breakpoint

DROP INDEX "idx_ledger_accounts_posted_balance";--> statement-breakpoint
DROP INDEX "idx_ledger_accounts_available_balance";--> statement-breakpoint
DROP INDEX "idx_ledger_transaction_entries_status";--> statement-breakpoint
DROP INDEX "idx_ledger_transactions_created";--> statement-breakpoint
DROP INDEX "idx_ledger_transactions_effective_at";--> statement-breakpoint

ALTER TABLE "ledger_transactions" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
UPDATE "ledger_transactions" SET "status" = 'voided' WHERE "status" = 'archived';--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."ledger_transaction_status";--> statement-breakpoint
CREATE TYPE "public"."ledger_transaction_status" AS ENUM('pending', 'posted', 'voided');--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "status" SET DATA TYPE "public"."ledger_transaction_status" USING "status"::"public"."ledger_transaction_status";--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."ledger_transaction_status";--> statement-breakpoint

ALTER TABLE "ledger_transaction_entries" ALTER COLUMN "ledger_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP COLUMN "pending_amount";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP COLUMN "posted_amount";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP COLUMN "available_amount";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP COLUMN "available_credits";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP COLUMN "available_debits";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP COLUMN "currency_exponent";--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" DROP COLUMN "updated";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP COLUMN "effective_at";--> statement-breakpoint

ALTER TABLE "ledger_accounts" ADD CONSTRAINT "unique_ledger_accounts_organization_ledger_id" UNIQUE("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "unique_ledger_transactions_organization_ledger_id" UNIQUE("organization_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_transaction_ownership_fk" FOREIGN KEY ("organization_id","ledger_id","transaction_id") REFERENCES "public"."ledger_transactions"("organization_id","ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_account_ownership_fk" FOREIGN KEY ("organization_id","ledger_id","account_id") REFERENCES "public"."ledger_accounts"("organization_id","ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_organization_ledger_fk" FOREIGN KEY ("organization_id","ledger_id") REFERENCES "public"."ledgers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_ledger_transactions_organization_idempotency_key" ON "ledger_transactions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_ledger_transactions_ledger_created_id" ON "ledger_transactions" USING btree ("ledger_id","created" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_balances_safe_integers" CHECK (
	"ledger_accounts"."pending_credits" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."pending_debits" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."posted_credits" BETWEEN -9007199254740991 AND 9007199254740991
	AND "ledger_accounts"."posted_debits" BETWEEN -9007199254740991 AND 9007199254740991
);--> statement-breakpoint
ALTER TABLE "ledger_transaction_entries" ADD CONSTRAINT "ledger_transaction_entries_amount_positive_and_safe" CHECK (
	"ledger_transaction_entries"."amount" > 0
	AND "ledger_transaction_entries"."amount" <= 9007199254740991
);
