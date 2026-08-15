import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { Config } from "@/config";

const migrationsDirectory = join(import.meta.dirname, "../../../migrations");
const migrationNames = [
	"0000_normal_retro_girl.sql",
	"0001_narrow_tigra.sql",
	"0002_damp_deathbird.sql",
	"0003_blue_kid_colt.sql",
	"0004_worthless_chimera.sql",
	"0005_transactions_effect.sql",
];

const executeMigration = async (client: PoolClient, name: string) => {
	const migration = await readFile(join(migrationsDirectory, name), "utf8");
	for (const statement of migration.split("--> statement-breakpoint")) {
		if (statement.trim()) await client.query(statement);
	}
};

const seedLegacyTransactions = async (client: PoolClient) => {
	await client.query(`
		INSERT INTO organizations_table (id, name) VALUES ('org-1', 'One'), ('org-2', 'Two');
		INSERT INTO ledgers (id, organization_id, name) VALUES
			('ledger-1', 'org-1', 'One'), ('ledger-2', 'org-2', 'Two');
		INSERT INTO ledger_accounts (
			id, organization_id, ledger_id, name, normal_balance, currency_code,
			minor_unit_exponent, pending_credits, pending_debits, posted_credits, posted_debits
		) VALUES
			('account-1', 'org-1', 'ledger-1', 'Debit', 'debit', 'USD', 2, 999, 999, 999, 999),
			('account-2', 'org-1', 'ledger-1', 'Credit', 'credit', 'USD', 2, 999, 999, 999, 999),
			('account-3', 'org-2', 'ledger-2', 'Debit', 'debit', 'EUR', 2, 999, 999, 999, 999),
			('account-4', 'org-2', 'ledger-2', 'Credit', 'credit', 'EUR', 2, 999, 999, 999, 999);
		INSERT INTO ledger_transactions (
			id, ledger_id, organization_id, idempotency_key, status, effective_at, created, updated
		) VALUES
			('pending', 'ledger-1', 'org-1', NULL, 'pending', '2024-01-01', '2024-01-01', '2024-01-02'),
			('posted', 'ledger-1', 'org-1', 'shared-key', 'posted', '2024-02-01', '2024-02-01', '2024-02-02'),
			('archived', 'ledger-1', 'org-1', NULL, 'archived', '2024-03-01', '2024-03-01', '2024-03-02'),
			('other', 'ledger-2', 'org-2', NULL, 'posted', '2024-04-01', '2024-04-01', '2024-04-02');
		INSERT INTO ledger_transaction_entries (
			id, transaction_id, account_id, organization_id, direction, amount, currency, currency_exponent
		) VALUES
			('e1', 'pending', 'account-1', 'org-1', 'debit', 10, 'USD', 2),
			('e2', 'pending', 'account-2', 'org-1', 'credit', 10, 'USD', 2),
			('e3', 'posted', 'account-1', 'org-1', 'debit', 20, 'USD', 2),
			('e4', 'posted', 'account-2', 'org-1', 'credit', 20, 'USD', 2),
			('e5', 'archived', 'account-1', 'org-1', 'debit', 30, 'USD', 2),
			('e6', 'archived', 'account-2', 'org-1', 'credit', 30, 'USD', 2),
			('e7', 'other', 'account-3', 'org-2', 'debit', 7, 'EUR', 2),
			('e8', 'other', 'account-4', 'org-2', 'credit', 7, 'EUR', 2);
		INSERT INTO ledger_account_settlements (
			id, organization_id, transaction_id, settled_account_id, contra_account_id,
			amount, normal_balance, currency, currency_exponent
		) VALUES ('settlement', 'org-1', 'posted', 'account-1', 'account-2', 20, 'debit', 'USD', 2);
		INSERT INTO ledger_account_settlement_entries (settlement_id, entry_id)
		VALUES ('settlement', 'e3');
	`);
};

const withLegacyDatabase = async (run: (client: PoolClient) => Promise<void>, seed = true) => {
	const configuredUrl = new URL(new Config().databaseUrl);
	const databaseName = `exchequer_migration_${crypto.randomUUID().replaceAll("-", "")}`;
	const adminUrl = new URL(configuredUrl);
	adminUrl.pathname = "/postgres";
	adminUrl.search = "";
	const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
	const databaseUrl = new URL(configuredUrl);
	databaseUrl.pathname = `/${databaseName}`;
	databaseUrl.search = "";
	const pool = new Pool({ connectionString: databaseUrl.toString(), max: 1 });

	try {
		await admin.query(`CREATE DATABASE "${databaseName}"`);
		const client = await pool.connect();
		try {
			for (const migration of migrationNames.slice(0, -1)) await executeMigration(client, migration);
			if (seed) await seedLegacyTransactions(client);
			await run(client);
		} finally {
			client.release();
		}
	} finally {
		await pool.end();
		await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
		await admin.end();
	}
};

const applyTransactionMigration = async (client: PoolClient) => {
	await client.query("BEGIN");
	try {
		await executeMigration(client, migrationNames.at(-1)!);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
};

describe("transaction Effect migration", () => {
	it("migrates a clean database through 0005", async () => {
		await withLegacyDatabase(async client => {
			await applyTransactionMigration(client);
			expect(
				(await client.query("SELECT count(*)::int AS count FROM ledger_transactions")).rows[0]
			).toEqual({ count: 0 });
		}, false);
	});

	it("migrates populated 0004 data without losing rows or Settlement references", async () => {
		await withLegacyDatabase(async client => {
			await applyTransactionMigration(client);

			const transactions = await client.query<{
				id: string;
				posted_at: Date | null;
				status: string;
			}>("SELECT id, status, posted_at FROM ledger_transactions ORDER BY id");
			expect(
				transactions.rows.map(transaction => ({
					...transaction,
					posted_at: transaction.posted_at?.toISOString(),
				}))
			).toEqual([
				{ id: "archived", status: "voided", posted_at: undefined },
				{ id: "other", status: "posted", posted_at: "2024-04-02T00:00:00.000Z" },
				{ id: "pending", status: "pending", posted_at: undefined },
				{ id: "posted", status: "posted", posted_at: "2024-02-02T00:00:00.000Z" },
			]);

			const counters = await client.query(
				`SELECT id, pending_credits, pending_debits, posted_credits, posted_debits
					 FROM ledger_accounts ORDER BY id`
			);
			expect(counters.rows).toEqual([
				{
					id: "account-1",
					pending_credits: "0",
					pending_debits: "30",
					posted_credits: "0",
					posted_debits: "20",
				},
				{
					id: "account-2",
					pending_credits: "30",
					pending_debits: "0",
					posted_credits: "20",
					posted_debits: "0",
				},
				{
					id: "account-3",
					pending_credits: "0",
					pending_debits: "7",
					posted_credits: "0",
					posted_debits: "7",
				},
				{
					id: "account-4",
					pending_credits: "7",
					pending_debits: "0",
					posted_credits: "7",
					posted_debits: "0",
				},
			]);

			await expect(
				client.query(
					"INSERT INTO ledger_transactions (id, ledger_id, organization_id, idempotency_key) VALUES ('same-key-other-org', 'ledger-2', 'org-2', 'shared-key')"
				)
			).resolves.toBeDefined();
			expect(
				(await client.query("SELECT count(*)::int AS count FROM ledger_transaction_entries")).rows[0]
			).toEqual({ count: 8 });
			expect(
				(
					await client.query(
						"SELECT transaction_id FROM ledger_account_settlements WHERE id = 'settlement'"
					)
				).rows[0]
			).toEqual({ transaction_id: "posted" });
			expect(
				(await client.query("SELECT ledger_id FROM ledger_transaction_entries WHERE id = 'e3'")).rows[0]
			).toEqual({ ledger_id: "ledger-1" });

			const columns = await client.query(
				`SELECT table_name, array_agg(column_name::text ORDER BY ordinal_position) AS columns
				 FROM information_schema.columns
				 WHERE table_schema = 'public'
				 AND table_name IN ('ledger_accounts', 'ledger_transaction_entries', 'ledger_transactions')
				 GROUP BY table_name ORDER BY table_name`
			);
			expect(columns.rows).toEqual([
				{
					table_name: "ledger_accounts",
					columns: [
						"id",
						"organization_id",
						"ledger_id",
						"name",
						"description",
						"normal_balance",
						"pending_credits",
						"pending_debits",
						"posted_credits",
						"posted_debits",
						"lock_version",
						"metadata",
						"created",
						"updated",
						"currency_code",
						"minor_unit_exponent",
					],
				},
				{
					table_name: "ledger_transaction_entries",
					columns: [
						"id",
						"transaction_id",
						"account_id",
						"organization_id",
						"direction",
						"amount",
						"metadata",
						"created",
						"ledger_id",
					],
				},
				{
					table_name: "ledger_transactions",
					columns: [
						"id",
						"ledger_id",
						"organization_id",
						"idempotency_key",
						"description",
						"status",
						"metadata",
						"created",
						"updated",
						"posted_at",
					],
				},
			]);

			const lifecycle = await client.query(
				`SELECT array_agg(enumlabel::text ORDER BY enumsortorder) AS values
				 FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
				 WHERE pg_type.typname = 'ledger_transaction_status'`
			);
			expect(lifecycle.rows[0]).toEqual({ values: ["pending", "posted", "voided"] });

			const constraints = await client.query(
				`SELECT relation.relname AS table_name, array_agg(constraint_name.conname::text ORDER BY constraint_name.conname) AS constraints
				 FROM pg_constraint AS constraint_name
				 JOIN pg_class AS relation ON relation.oid = constraint_name.conrelid
				 WHERE relation.relname IN ('ledger_accounts', 'ledger_transaction_entries', 'ledger_transactions')
				 GROUP BY relation.relname ORDER BY relation.relname`
			);
			expect(constraints.rows).toEqual([
				{
					table_name: "ledger_accounts",
					constraints: [
						"ledger_accounts_balances_safe_integers",
						"ledger_accounts_currency_code_not_blank",
						"ledger_accounts_minor_unit_exponent_nonnegative",
						"ledger_accounts_organization_id_organizations_table_id_fk",
						"ledger_accounts_organization_ledger_fk",
						"ledger_accounts_pkey",
						"unique_ledger_accounts_organization_ledger_id",
					],
				},
				{
					table_name: "ledger_transaction_entries",
					constraints: [
						"ledger_transaction_entries_account_ownership_fk",
						"ledger_transaction_entries_amount_positive_and_safe",
						"ledger_transaction_entries_organization_id_organizations_table_",
						"ledger_transaction_entries_pkey",
						"ledger_transaction_entries_transaction_ownership_fk",
					],
				},
				{
					table_name: "ledger_transactions",
					constraints: [
						"ledger_transactions_organization_id_organizations_table_id_fk",
						"ledger_transactions_organization_ledger_fk",
						"ledger_transactions_pkey",
						"unique_ledger_transactions_organization_ledger_id",
					],
				},
			]);

			const indexes = await client.query(
				`SELECT tablename AS table_name, array_agg(indexname::text ORDER BY indexname) AS indexes
				 FROM pg_indexes
				 WHERE schemaname = 'public'
				 AND tablename IN ('ledger_accounts', 'ledger_transaction_entries', 'ledger_transactions')
				 GROUP BY tablename ORDER BY tablename`
			);
			expect(indexes.rows).toEqual([
				{
					table_name: "ledger_accounts",
					indexes: [
						"idx_ledger_accounts_organization",
						"ledger_accounts_pkey",
						"unique_account_name_per_ledger",
						"unique_ledger_accounts_organization_ledger_id",
					],
				},
				{
					table_name: "ledger_transaction_entries",
					indexes: [
						"idx_ledger_transaction_entries_account",
						"idx_ledger_transaction_entries_organization",
						"idx_ledger_transaction_entries_transaction",
						"ledger_transaction_entries_pkey",
					],
				},
				{
					table_name: "ledger_transactions",
					indexes: [
						"idx_ledger_transactions_ledger_created_id",
						"idx_ledger_transactions_organization",
						"idx_ledger_transactions_status",
						"ledger_transactions_pkey",
						"unique_ledger_transactions_organization_idempotency_key",
						"unique_ledger_transactions_organization_ledger_id",
					],
				},
			]);

			const finalColumns = await client.query(
				`SELECT table_name, column_name, is_nullable
				 FROM information_schema.columns
				 WHERE table_schema = 'public'
				 AND (table_name, column_name) IN (
					('ledger_transactions', 'posted_at'),
					('ledger_transaction_entries', 'ledger_id')
				 ) ORDER BY table_name`
			);
			expect(finalColumns.rows).toEqual([
				{ table_name: "ledger_transaction_entries", column_name: "ledger_id", is_nullable: "NO" },
				{ table_name: "ledger_transactions", column_name: "posted_at", is_nullable: "YES" },
			]);

			const listIndex = await client.query<{ indexdef: string }>(
				"SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_ledger_transactions_ledger_created_id'"
			);
			expect(listIndex.rows[0].indexdef).toContain(
				"(ledger_id, created DESC NULLS LAST, id DESC NULLS LAST)"
			);
		});
	}, 30_000);

	it.each([
		[
			"transaction tenancy",
			"UPDATE ledger_transactions SET organization_id = 'org-2' WHERE id = 'pending'",
		],
		[
			"entry tenancy",
			"UPDATE ledger_transaction_entries SET organization_id = 'org-2' WHERE id = 'e1'",
		],
		["entry currency", "UPDATE ledger_transaction_entries SET currency = 'EUR' WHERE id = 'e1'"],
		[
			"unsafe entry amount",
			"UPDATE ledger_transaction_entries SET amount = 9007199254740992 WHERE id = 'e1'",
		],
		[
			"transaction lifecycle",
			`ALTER TABLE ledger_transactions ALTER COLUMN status DROP DEFAULT;
			 ALTER TABLE ledger_transactions ALTER COLUMN status TYPE text USING status::text;
			 UPDATE ledger_transactions SET status = 'invalid' WHERE id = 'pending'`,
		],
		[
			"unsafe aggregate",
			`UPDATE ledger_transactions SET status = 'pending' WHERE id = 'archived';
			 UPDATE ledger_transaction_entries SET amount = 9007199254740991 WHERE id IN ('e1', 'e5')`,
		],
	])(
		"rejects invalid %s data and rolls the complete migration back",
		async (_case, corruption) => {
			await withLegacyDatabase(async client => {
				await client.query(corruption);
				await expect(applyTransactionMigration(client)).rejects.toThrow();

				const columns = await client.query<{ column_name: string }>(
					`SELECT column_name FROM information_schema.columns
					 WHERE table_schema = 'public' AND table_name = 'ledger_transactions'`
				);
				const names = columns.rows.map(row => row.column_name);
				expect(names).toContain("effective_at");
				expect(names).not.toContain("posted_at");
				expect(
					(await client.query("SELECT status FROM ledger_transactions WHERE id = 'archived'")).rows[0]
				).toEqual({ status: corruption.includes("status = 'pending'") ? "pending" : "archived" });
				expect(
					(
						await client.query(
							`SELECT pending_credits, pending_debits, posted_credits, posted_debits
							 FROM ledger_accounts WHERE id = 'account-1'`
						)
					).rows[0]
				).toEqual({
					pending_credits: "999",
					pending_debits: "999",
					posted_credits: "999",
					posted_debits: "999",
				});

				const entryColumns = await client.query<{ column_name: string }>(
					`SELECT column_name FROM information_schema.columns
					 WHERE table_schema = 'public' AND table_name = 'ledger_transaction_entries'`
				);
				const entryNames = entryColumns.rows.map(row => row.column_name);
				expect(entryNames).toEqual(
					expect.arrayContaining(["currency", "currency_exponent", "status", "updated"])
				);
				expect(entryNames).not.toContain("ledger_id");

				const indexes = await client.query<{ indexname: string }>(
					`SELECT indexname FROM pg_indexes
					 WHERE schemaname = 'public' AND tablename = 'ledger_transactions'`
				);
				const indexNames = indexes.rows.map(row => row.indexname);
				expect(indexNames).toContain("idx_ledger_transactions_effective_at");
				expect(indexNames).not.toContain("idx_ledger_transactions_ledger_created_id");

				const constraints = await client.query<{ conname: string }>(
					`SELECT conname FROM pg_constraint
					 WHERE conrelid = 'ledger_transactions'::regclass`
				);
				const constraintNames = constraints.rows.map(row => row.conname);
				expect(constraintNames).toContain("ledger_transactions_idempotency_key_unique");
				expect(constraintNames).not.toContain("unique_ledger_transactions_organization_ledger_id");
			});
		},
		30_000
	);
});
