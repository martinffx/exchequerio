import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { Config } from "@/config";
const guard = readFileSync(
	new URL("../../migrations/20260907223239_balance-monitors/migration.sql", import.meta.url),
	"utf8"
).split("--> statement-breakpoint")[0];
describe("Balance monitor migration legacy guard", () => {
	it.each([false, true])(
		"preserves legacy rows and requires explicit resolution (populated=%s)",
		async populated => {
			const client = new Client({ connectionString: new Config().databaseUrl });
			await client.connect();
			try {
				await client.query("BEGIN");
				await client.query(
					"CREATE TEMP TABLE ledger_account_balance_monitors (id text) ON COMMIT DROP"
				);
				await client.query("SET LOCAL search_path TO pg_temp");
				if (populated)
					await client.query("INSERT INTO ledger_account_balance_monitors VALUES ('legacy-monitor')");
				await client.query("SAVEPOINT before_guard");
				if (populated) {
					await expect(client.query(guard)).rejects.toThrow(
						"Legacy balance monitors cannot be migrated"
					);
					await client.query("ROLLBACK TO SAVEPOINT before_guard");
					expect((await client.query("SELECT id FROM ledger_account_balance_monitors")).rows).toEqual([
						{ id: "legacy-monitor" },
					]);
				} else {
					await client.query(guard);
					expect((await client.query("SELECT id FROM ledger_account_balance_monitors")).rows).toEqual(
						[]
					);
				}
			} finally {
				await client.query("ROLLBACK");
				await client.end();
			}
		}
	);
});
