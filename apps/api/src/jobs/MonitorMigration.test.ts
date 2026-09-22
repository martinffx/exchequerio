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

const bestEffortGuard = readFileSync(
	new URL("../../migrations/20260910064809_best-effort-monitors/migration.sql", import.meta.url),
	"utf8"
).split("--> statement-breakpoint")[0];
it.each([false, true])(
	"requires an empty outbox before removing durable capture (populated=%s)",
	async populated => {
		const client = new Client({ connectionString: new Config().databaseUrl });
		await client.connect();
		try {
			await client.query("BEGIN");
			await client.query("CREATE TEMP TABLE balance_monitor_outbox (id text) ON COMMIT DROP");
			await client.query("SET LOCAL search_path TO pg_temp");
			if (populated) await client.query("INSERT INTO balance_monitor_outbox VALUES ('pending-event')");
			await client.query("SAVEPOINT before_guard");
			if (populated) {
				await expect(client.query(bestEffortGuard)).rejects.toThrow(
					"Balance monitor outbox must be drained"
				);
				await client.query("ROLLBACK TO SAVEPOINT before_guard");
				expect((await client.query("SELECT id FROM balance_monitor_outbox")).rows).toEqual([
					{ id: "pending-event" },
				]);
			} else await client.query(bestEffortGuard);
		} finally {
			await client.query("ROLLBACK");
			await client.end();
		}
	}
);

it("preserves active monitor configuration while removing deleted heads and historical storage", async () => {
	const client = new Client({ connectionString: new Config().databaseUrl });
	await client.connect();
	try {
		await client.query("BEGIN");
		await client.query("SET LOCAL search_path TO pg_temp");
		await client.query(
			"CREATE TEMP TABLE ledger_account_balance_monitors (id text primary key, webhook_token text, deleted_at timestamptz)"
		);
		await client.query("CREATE TEMP TABLE balance_monitor_outbox (id text)");
		await client.query(
			"CREATE TEMP TABLE balance_monitor_revisions (monitor_id text REFERENCES ledger_account_balance_monitors(id) ON DELETE CASCADE)"
		);
		await client.query(
			"INSERT INTO ledger_account_balance_monitors VALUES ('active', 'keep-ciphertext', NULL), ('deleted', 'retired-ciphertext', now())"
		);
		await client.query("INSERT INTO balance_monitor_revisions VALUES ('active'), ('deleted')");
		const migration = readFileSync(
			new URL("../../migrations/20260910064809_best-effort-monitors/migration.sql", import.meta.url),
			"utf8"
		);
		await client.query(migration);
		expect((await client.query("SELECT * FROM ledger_account_balance_monitors")).rows).toEqual([
			{ id: "active", webhook_token: "keep-ciphertext" },
		]);
	} finally {
		await client.query("ROLLBACK");
		await client.end();
	}
});
