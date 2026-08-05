import { Effect, Layer } from "effect";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { Database, type DrizzleDatabase } from "./database";
import { makeDatabaseLive, makeDatabaseTest } from "./database-live";

describe("Database Layers", () => {
	it("closes the production pool exactly once when its scope ends", async () => {
		const end = vi.fn(() => Promise.resolve());
		const pool = { end } as unknown as Pool;
		const layer = makeDatabaseLive("postgresql://example", () => pool);

		await Effect.runPromise(Effect.scoped(Layer.build(layer)));

		expect(end).toHaveBeenCalledOnce();
	});

	it("does not close a database supplied to the test Layer", async () => {
		const end = vi.fn(() => Promise.resolve());
		const database = { end } as unknown as DrizzleDatabase;
		const layer = makeDatabaseTest(database);

		const provided = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* Database;
			}).pipe(Effect.provide(layer))
		);

		expect(provided).toEqual({ db: database });
		expect(end).not.toHaveBeenCalled();
	});
});
