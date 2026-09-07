import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { Config } from "@/config";

const migrationsDirectory = join(import.meta.dirname, "../../migrations");
const legacyMigrationNames = [
	"20251206175734_normal_retro_girl",
	"20251207122110_narrow_tigra",
	"20251210214057_damp_deathbird",
	"20260806203446_blue_kid_colt",
	"20260809203355_worthless_chimera",
	"20260826080418_transactions_effect",
];
const categoryOwnershipMigration = "20260829170957_category_ownership";

const executeMigration = async (client: PoolClient, name: string) => {
	const migration = await readFile(join(migrationsDirectory, name, "migration.sql"), "utf8");
	for (const statement of migration.split("--> statement-breakpoint")) {
		if (statement.trim()) await client.query(statement);
	}
};

const withLegacyDatabase = async (run: (client: PoolClient) => Promise<void>) => {
	const configuredUrl = new URL(new Config().databaseUrl);
	const databaseName = `exchequer_category_migration_${crypto.randomUUID().replaceAll("-", "")}`;
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
			for (const migration of legacyMigrationNames) await executeMigration(client, migration);
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

const applyCategoryOwnershipMigration = async (client: PoolClient) => {
	await client.query("BEGIN");
	try {
		await executeMigration(client, categoryOwnershipMigration);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
};

const seedOwnershipGraph = async (client: PoolClient) => {
	await client.query(`
		INSERT INTO organizations_table (id, name) VALUES ('org-1', 'One'), ('org-2', 'Two');
		INSERT INTO ledgers (id, organization_id, name)
		VALUES ('ledger-1', 'org-1', 'One'), ('ledger-2', 'org-1', 'Two'), ('ledger-3', 'org-2', 'Three');
		INSERT INTO ledger_accounts (
			id, organization_id, ledger_id, name, normal_balance, currency_code
		) VALUES
			('account-1', 'org-1', 'ledger-1', 'Cash', 'debit', 'USD'),
			('account-2', 'org-1', 'ledger-2', 'Cash', 'debit', 'USD'),
			('account-3', 'org-2', 'ledger-3', 'Cash', 'debit', 'USD');
		INSERT INTO ledger_account_categories (id, ledger_id, name, normal_balance)
		VALUES
			('category-1', 'ledger-1', 'Assets', 'debit'),
			('category-2', 'ledger-1', 'Current assets', 'debit'),
			('category-3', 'ledger-2', 'Other ledger', 'debit'),
			('category-4', 'ledger-3', 'Other organization', 'debit');
	`);
};

describe("Ledger Account Category ownership migration", () => {
	it("backfills valid ownership and preserves relationships", async () => {
		await withLegacyDatabase(async client => {
			await seedOwnershipGraph(client);
			await client.query(`
				INSERT INTO ledger_account_category_accounts (category_id, account_id)
				VALUES ('category-1', 'account-1');
				INSERT INTO ledger_account_category_parents (category_id, parent_category_id)
				VALUES ('category-2', 'category-1');
			`);

			await applyCategoryOwnershipMigration(client);

			expect(
				(
					await client.query(`
						SELECT id, organization_id, ledger_id
						FROM ledger_account_categories WHERE id IN ('category-1', 'category-2') ORDER BY id
					`)
				).rows
			).toEqual([
				{ id: "category-1", organization_id: "org-1", ledger_id: "ledger-1" },
				{ id: "category-2", organization_id: "org-1", ledger_id: "ledger-1" },
			]);
			expect(
				(
					await client.query(`
						SELECT organization_id, ledger_id, category_id, account_id
						FROM ledger_account_category_accounts
					`)
				).rows
			).toEqual([
				{
					organization_id: "org-1",
					ledger_id: "ledger-1",
					category_id: "category-1",
					account_id: "account-1",
				},
			]);
			expect(
				(
					await client.query(`
						SELECT organization_id, ledger_id, category_id, parent_category_id
						FROM ledger_account_category_parents
					`)
				).rows
			).toEqual([
				{
					organization_id: "org-1",
					ledger_id: "ledger-1",
					category_id: "category-2",
					parent_category_id: "category-1",
				},
			]);
		});
	}, 30_000);

	it.each([
		{ scope: "Ledger", accountId: "account-2" },
		{ scope: "Organization", accountId: "account-3" },
	])(
		"aborts for a cross-$scope Account relationship without changing the schema or data",
		async ({ accountId }) => {
			await withLegacyDatabase(async client => {
				await seedOwnershipGraph(client);
				await client.query(
					`INSERT INTO ledger_account_category_accounts (category_id, account_id)
				VALUES ('category-1', $1)`,
					[accountId]
				);

				await expect(applyCategoryOwnershipMigration(client)).rejects.toThrow(
					"category ownership migration found Account relationships outside the Category Organization or Ledger"
				);
				expect(
					(
						await client.query(`
						SELECT count(*)::int AS count FROM information_schema.columns
						WHERE table_name = 'ledger_account_categories' AND column_name = 'organization_id'
					`)
					).rows[0]
				).toEqual({ count: 0 });
				expect(
					(await client.query("SELECT category_id, account_id FROM ledger_account_category_accounts"))
						.rows
				).toEqual([{ category_id: "category-1", account_id: accountId }]);
			});
		},
		30_000
	);

	it.each([
		{ scope: "Ledger", parentId: "category-3" },
		{ scope: "Organization", parentId: "category-4" },
	])(
		"aborts for a cross-$scope parent relationship without changing the schema or data",
		async ({ parentId }) => {
			await withLegacyDatabase(async client => {
				await seedOwnershipGraph(client);
				await client.query(
					`INSERT INTO ledger_account_category_parents (category_id, parent_category_id)
				VALUES ('category-1', $1)`,
					[parentId]
				);

				await expect(applyCategoryOwnershipMigration(client)).rejects.toThrow(
					"category ownership migration found parent relationships outside the child Category Organization or Ledger"
				);
				expect(
					(
						await client.query(`
						SELECT count(*)::int AS count FROM information_schema.columns
						WHERE table_name = 'ledger_account_category_parents' AND column_name = 'organization_id'
					`)
					).rows[0]
				).toEqual({ count: 0 });
				expect(
					(
						await client.query(
							"SELECT category_id, parent_category_id FROM ledger_account_category_parents"
						)
					).rows
				).toEqual([{ category_id: "category-1", parent_category_id: parentId }]);
			});
		},
		30_000
	);

	it("installs composite ownership constraints", async () => {
		await withLegacyDatabase(async client => {
			await seedOwnershipGraph(client);
			await applyCategoryOwnershipMigration(client);

			await expect(
				client.query(`
					INSERT INTO ledger_account_categories (
						id, organization_id, ledger_id, name, normal_balance
					) VALUES ('category-invalid', 'org-2', 'ledger-1', 'Invalid', 'debit')
				`)
			).rejects.toMatchObject({
				code: "23503",
				constraint: "ledger_account_categories_organization_ledger_fk",
			});

			await expect(
				client.query(`
					INSERT INTO ledger_account_category_accounts (
						organization_id, ledger_id, category_id, account_id
					) VALUES ('org-1', 'ledger-1', 'category-1', 'account-2')
				`)
			).rejects.toMatchObject({
				code: "23503",
				constraint: "ledger_account_category_accounts_account_ownership_fk",
			});

			await expect(
				client.query(`
					INSERT INTO ledger_account_category_accounts (
						organization_id, ledger_id, category_id, account_id
					) VALUES ('org-1', 'ledger-1', 'category-3', 'account-1')
				`)
			).rejects.toMatchObject({
				code: "23503",
				constraint: "ledger_account_category_accounts_category_ownership_fk",
			});

			await expect(
				client.query(`
					INSERT INTO ledger_account_category_parents (
						organization_id, ledger_id, category_id, parent_category_id
					) VALUES ('org-1', 'ledger-1', 'category-1', 'category-3')
				`)
			).rejects.toMatchObject({
				code: "23503",
				constraint: "ledger_account_category_parents_parent_ownership_fk",
			});

			await expect(
				client.query(`
					INSERT INTO ledger_account_category_parents (
						organization_id, ledger_id, category_id, parent_category_id
					) VALUES ('org-1', 'ledger-1', 'category-3', 'category-1')
				`)
			).rejects.toMatchObject({
				code: "23503",
				constraint: "ledger_account_category_parents_child_ownership_fk",
			});
		});
	}, 30_000);

	it("preserves Category and Account relationship cascades", async () => {
		await withLegacyDatabase(async client => {
			await seedOwnershipGraph(client);
			await applyCategoryOwnershipMigration(client);
			await client.query(`
				INSERT INTO ledger_account_category_accounts (
					organization_id, ledger_id, category_id, account_id
				) VALUES
					('org-1', 'ledger-1', 'category-1', 'account-1'),
					('org-1', 'ledger-1', 'category-2', 'account-1');
				INSERT INTO ledger_account_category_parents (
					organization_id, ledger_id, category_id, parent_category_id
				) VALUES ('org-1', 'ledger-1', 'category-2', 'category-1');
			`);

			await client.query("DELETE FROM ledger_account_categories WHERE id = 'category-1'");

			expect(
				(
					await client.query(`
						SELECT category_id, account_id FROM ledger_account_category_accounts
					`)
				).rows
			).toEqual([{ category_id: "category-2", account_id: "account-1" }]);
			expect(
				(await client.query("SELECT count(*)::int AS count FROM ledger_account_category_parents"))
					.rows[0]
			).toEqual({ count: 0 });

			await client.query("DELETE FROM ledger_accounts WHERE id = 'account-1'");

			expect(
				(await client.query("SELECT count(*)::int AS count FROM ledger_account_category_accounts"))
					.rows[0]
			).toEqual({ count: 0 });
		});
	}, 30_000);
});
