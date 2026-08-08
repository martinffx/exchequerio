import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Context, Effect, Layer } from "effect";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { Config } from "../Config";
import { DatabaseTag, makeDatabaseTest } from "../db/Database";
import * as schema from "../repo/schema";
import { buildServer } from "../Server";
import { makeServerRuntimeLayer, ServerConfigTag, ServerRuntime } from "./ServerRuntime";

class Probe extends Context.Service<Probe, { readonly token: symbol }>()(
	"ServerRuntimeTestProbe"
) {}

describe("ServerRuntime", () => {
	it("builds one shared Layer graph and finalizes it once", async () => {
		const acquired = vi.fn();
		const released = vi.fn();
		const token = Symbol("probe");
		const layer = Layer.effect(
			Probe,
			Effect.acquireRelease(
				Effect.sync(() => {
					acquired();
					return { token };
				}),
				() => Effect.sync(released)
			)
		);
		const runtime = new ServerRuntime(layer);

		const first = await runtime.runPromise(Probe);
		const second = await runtime.runPromise(Probe);
		const firstDisposal = runtime.dispose();
		const secondDisposal = runtime.dispose();
		expect(firstDisposal).toBe(secondDisposal);
		await Promise.all([firstDisposal, secondDisposal]);
		await runtime.dispose();

		expect(first).toBe(second);
		expect(acquired).toHaveBeenCalledOnce();
		expect(released).toHaveBeenCalledOnce();
	});

	it("bridges real external resources to public legacy repositories without taking ownership", async () => {
		const config = new Config({ environment: "test" });
		const pool = new Pool({ connectionString: config.databaseUrl });
		const db = drizzle(pool, { schema });
		const runtimeLayer = makeServerRuntimeLayer(config, {
			database: makeDatabaseTest(db),
		});

		try {
			const server = await buildServer({ runtimeLayer });

			const firstDatabase = await server.runtime.runPromise(DatabaseTag);
			const secondDatabase = await server.runtime.runPromise(DatabaseTag);
			expect(firstDatabase).toBe(secondDatabase);
			expect((await server.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);

			await server.close();

			await expect(db.execute(sql`select 1`)).resolves.toBeDefined();
		} finally {
			await pool.end();
		}
	});

	it("keeps the exact Config instance supplied to the runtime", async () => {
		const config = new Config({ environment: "test" });
		const runtime = new ServerRuntime(Layer.succeed(ServerConfigTag, config));

		expect(await runtime.runPromise(ServerConfigTag)).toBe(config);
		await runtime.dispose();
	});
});
