import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { Config } from "@/config";

const migrationsDirectory = join(import.meta.dirname, "../../../../migrations");
const migrationNames = [
	"20251206175734_normal_retro_girl",
	"20251207122110_narrow_tigra",
	"20251210214057_damp_deathbird",
	"20260806203446_blue_kid_colt",
	"20260809203355_worthless_chimera",
	"20260826080418_transactions_effect",
];

const executeMigration = async (client: PoolClient, name: string) => {
	const migration = await readFile(join(migrationsDirectory, name, "migration.sql"), "utf8");
	for (const statement of migration.split("--> statement-breakpoint")) {
		if (statement.trim()) await client.query(statement);
	}
};

const withLegacyDatabase = async (run: (client: PoolClient) => Promise<void>) => {
	const configuredUrl = new URL(new Config().databaseUrl);
	const databaseName = `exchequer_migration_${crypto.randomUUID().replaceAll("-", "")}`;
	const adminUrl = new URL(configuredUrl);
	adminUrl.pathname = "/postgres";
	adminUrl.search = "";
	const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
	const databaseUrl = new URL(configuredUrl);
	databaseUrl.pathname = `/${databaseName}`;
	const pool = new Pool({ connectionString: databaseUrl.toString(), max: 1 });

	try {
		await admin.query(`CREATE DATABASE "${databaseName}"`);
		const client = await pool.connect();
		try {
			for (const migration of migrationNames.slice(0, -1)) await executeMigration(client, migration);
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

const seedLegacyTransaction = async (client: PoolClient, withEntry: boolean) => {
	await client.query(`
		INSERT INTO organizations_table (id, name) VALUES ('org-1', 'One');
		INSERT INTO ledgers (id, organization_id, name) VALUES ('ledger-1', 'org-1', 'One');
		INSERT INTO ledger_accounts (
			id, organization_id, ledger_id, name, normal_balance, currency_code, minor_unit_exponent
		) VALUES ('account-1', 'org-1', 'ledger-1', 'Cash', 'debit', 'USD', 2);
		INSERT INTO ledger_transactions (
			id, ledger_id, organization_id, status, effective_at
		) VALUES ('transaction-1', 'ledger-1', 'org-1', 'pending', '2026-08-01');
	`);
	if (withEntry) {
		await client.query(`
			INSERT INTO ledger_transaction_entries (
				id, transaction_id, account_id, organization_id, direction, amount,
				currency, currency_exponent, status
			) VALUES (
				'entry-1', 'transaction-1', 'account-1', 'org-1', 'debit', 1,
				'USD', 2, 'pending'
			);
		`);
	}
};

describe("transaction Effect migration", () => {
	it("backfills restored effective time from creation time without inventing historical dates", async () => {
		await withLegacyDatabase(async client => {
			await applyTransactionMigration(client);
			await client.query(`
				INSERT INTO organizations_table (id, name) VALUES ('org-time', 'Time');
				INSERT INTO ledgers (id, organization_id, name) VALUES ('ledger-time', 'org-time', 'Time');
				INSERT INTO ledger_transactions (id, ledger_id, organization_id, status, created)
				VALUES ('transaction-time', 'ledger-time', 'org-time', 'pending', '2026-08-01T12:00:00Z');
			`);
			await executeMigration(client, "20260906074715_transaction-effective-time");
			const result = await client.query<{ matches: boolean }>(
				"SELECT effective_at = created AS matches FROM ledger_transactions WHERE id = 'transaction-time'"
			);
			expect(result.rows).toEqual([{ matches: true }]);
			await expect(
				client.query("UPDATE ledger_transactions SET effective_at = NULL")
			).rejects.toMatchObject({ code: "23502" });
		});
	}, 30_000);

	it("migrates an empty Transaction schema", async () => {
		await withLegacyDatabase(async client => {
			await applyTransactionMigration(client);

			const columns = await client.query<{ table_name: string; column_name: string }>(`
				SELECT table_name, column_name
				FROM information_schema.columns
				WHERE table_schema = 'public'
				AND (table_name, column_name) IN (
					('ledger_transactions', 'posted_at'),
					('ledger_transactions', 'lock_version'),
					('ledger_transaction_entries', 'ledger_id')
				)
				ORDER BY table_name, column_name
			`);
			expect(columns.rows).toEqual([
				{ table_name: "ledger_transaction_entries", column_name: "ledger_id" },
				{ table_name: "ledger_transactions", column_name: "lock_version" },
				{ table_name: "ledger_transactions", column_name: "posted_at" },
			]);

			const removedColumns = await client.query<{ count: number }>(`
				SELECT count(*)::int AS count
				FROM information_schema.columns
				WHERE table_schema = 'public'
				AND (table_name, column_name) IN (
					('ledger_accounts', 'minor_unit_exponent'),
					('ledger_transaction_entries', 'currency_exponent'),
					('ledger_transactions', 'idempotency_key')
				)
			`);
			expect(removedColumns.rows[0]).toEqual({ count: 0 });

			const lifecycle = await client.query<{ values: string[] }>(`
				SELECT array_agg(enumlabel::text ORDER BY enumsortorder) AS values
				FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
				WHERE pg_type.typname = 'ledger_transaction_status'
			`);
			expect(lifecycle.rows[0]).toEqual({ values: ["pending", "posted", "voided"] });
		});
	}, 30_000);

	it.each([
		["a Transaction", false],
		["a Transaction Entry", true],
	])(
		"rejects a legacy database containing %s before changing the schema",
		async (_case, withEntry) => {
			await withLegacyDatabase(async client => {
				await seedLegacyTransaction(client, withEntry);

				await expect(applyTransactionMigration(client)).rejects.toThrow(
					"transactions Effect migration requires empty ledger_transactions and ledger_transaction_entries tables"
				);

				const columns = await client.query<{ column_name: string }>(`
				SELECT column_name
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'ledger_transactions'
			`);
				const names = columns.rows.map(row => row.column_name);
				expect(names).toContain("effective_at");
				expect(names).toContain("idempotency_key");
				expect(names).not.toContain("posted_at");
				expect(
					(await client.query("SELECT count(*)::int AS count FROM ledger_transactions")).rows[0]
				).toEqual({ count: 1 });
			});
		},
		30_000
	);
});
