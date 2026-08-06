import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect } from "effect";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { Config } from "../Config";
import * as schema from "../repo/schema";
import { DatabaseLive, DatabaseTag, makeDatabaseLive, makeDatabaseTest } from "./Database";

describe("Database Layers", () => {
	it("forces checked-out clients closed and completes when pool shutdown rejects", async () => {
		const release = vi.fn();
		let connected: ((client: PoolClient) => void) | undefined;
		const pool = {
			end: vi.fn(() => Promise.reject(new Error("shutdown failed"))),
			off: vi.fn(),
			on: vi.fn((event: string, listener: (client: PoolClient) => void) => {
				if (event === "connect") connected = listener;
				return pool;
			}),
		} as unknown as Pool;
		const database = new DatabaseLive(pool, 20);
		connected?.({ release } as unknown as PoolClient);

		await expect(Effect.runPromise(database.close())).resolves.toBeUndefined();

		expect(release).toHaveBeenCalledWith(true);
		expect(pool.off).toHaveBeenCalledTimes(2);
	});

	it("closes an owned PostgreSQL pool when its scope ends", async () => {
		const config = new Config();
		let pool: Pool | undefined;
		const layer = makeDatabaseLive(config.databaseUrl, connectionString => {
			pool = new Pool({ connectionString });
			return pool;
		});

		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const { db } = yield* DatabaseTag;
					yield* Effect.promise(() => db.execute(sql`select 1`));
				}).pipe(Effect.provide(layer))
			)
		);

		expect(pool?.ended).toBe(true);
	});

	it("leaves an externally owned PostgreSQL pool usable", async () => {
		const pool = new Pool({ connectionString: new Config().databaseUrl });
		const db = drizzle(pool, { schema });

		try {
			await Effect.runPromise(Effect.scoped(DatabaseTag.pipe(Effect.provide(makeDatabaseTest(db)))));

			await expect(db.execute(sql`select 1`)).resolves.toBeDefined();
			expect(pool.ended).toBe(false);
		} finally {
			await pool.end();
		}
	});
});
