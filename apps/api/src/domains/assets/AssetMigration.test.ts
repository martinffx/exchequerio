import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { Config } from "@/config";

const directory = join(import.meta.dirname, "../../../migrations");
const cutover = "20260907213428_assets-int64";
const executeMigration = async (client: PoolClient, name: string) => {
	const sql = await readFile(join(directory, name, "migration.sql"), "utf8");
	await client.query("BEGIN");
	try {
		for (const statement of sql.split("--> statement-breakpoint")) {
			if (statement.trim()) await client.query(statement);
		}
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
};

const withLegacyDatabase = async (run: (client: PoolClient) => Promise<void>) => {
	const url = new URL(new Config().databaseUrl);
	const name = `exchequer_assets_${crypto.randomUUID().replaceAll("-", "")}`;
	url.pathname = "/postgres";
	url.search = "";
	const admin = new Pool({ connectionString: url.toString(), max: 1 });
	url.pathname = `/${name}`;
	const pool = new Pool({ connectionString: url.toString(), max: 1 });
	try {
		await admin.query(`CREATE DATABASE "${name}"`);
		const client = await pool.connect();
		try {
			const migrations = (await readdir(directory, { withFileTypes: true }))
				.filter(entry => entry.isDirectory() && entry.name < cutover)
				.map(entry => entry.name)
				.sort();
			for (const migration of migrations) await executeMigration(client, migration);
			await run(client);
		} finally {
			client.release();
		}
	} finally {
		await pool.end();
		await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
		await admin.end();
	}
};

describe("Asset cutover migration", () => {
	it("preserves populated legacy data and explains the required clean cutover", async () => {
		await withLegacyDatabase(async client => {
			await client.query(`
				INSERT INTO organizations_table (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'One');
				INSERT INTO ledgers (id, organization_id, name) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'One');
				INSERT INTO ledger_accounts (id, organization_id, ledger_id, name, normal_balance, currency_code)
				VALUES ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'Cash', 'debit', 'USD');
			`);
			await expect(executeMigration(client, cutover)).rejects.toThrow(
				"Asset cutover requires empty accounting tables"
			);
			expect((await client.query("SELECT currency_code FROM ledger_accounts")).rows).toEqual([
				{ currency_code: "USD" },
			]);
			expect(
				(await client.query("SELECT to_regclass('public.assets') IS NULL AS absent")).rows
			).toEqual([{ absent: true }]);
		});
	});
	it("migrates a fresh database and enforces Asset ownership and exact int64 storage", async () => {
		await withLegacyDatabase(async client => {
			await executeMigration(client, cutover);
			await client.query(`
				INSERT INTO organizations_table (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'One'), ('00000000-0000-4000-8000-000000000002', 'Two');
				INSERT INTO ledgers (id, organization_id, name) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'One');
				INSERT INTO assets (id, organization_id, code, name, minor_unit_exponent)
				VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'USD', 'Dollar', 2), ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002', 'USD', 'Dollar', 2), ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', 'CREDIT', 'Credit', 6);
				INSERT INTO ledger_accounts (id, organization_id, ledger_id, name, normal_balance, asset_id, posted_amount)
				VALUES ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'Cash', 'debit', '00000000-0000-4000-8000-000000000004', 9007199254740993);
				INSERT INTO ledger_transactions (id, organization_id, ledger_id, status, effective_at)
				VALUES ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'pending', now());
			`);
			expect((await client.query("SELECT posted_amount FROM ledger_accounts")).rows).toEqual([
				{ posted_amount: "9007199254740993" },
			]);
			await expect(
				client.query("UPDATE ledger_accounts SET asset_id='00000000-0000-4000-8000-000000000005'")
			).rejects.toMatchObject({ code: "23503" });
			await expect(
				client.query(`INSERT INTO ledger_transaction_entries (id, organization_id, ledger_id, transaction_id, account_id, asset_id, amount, direction, status)
				VALUES ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000006', 1, 'debit', 'pending')`)
			).rejects.toMatchObject({ code: "23503" });
			await expect(
				client.query("UPDATE ledger_accounts SET posted_amount=9223372036854775808")
			).rejects.toMatchObject({ code: "22003" });
			expect(
				(
					await client.query(
						"SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='ledger_account_statements' AND column_name='opening_balance'"
					)
				).rows
			).toEqual([{ data_type: "bigint" }]);
		});
	});
});
