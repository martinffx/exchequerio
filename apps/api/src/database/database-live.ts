import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer } from "effect";
import { Pool } from "pg";
import * as schema from "../repo/schema";
import { Database, type DrizzleDatabase } from "./database";

type PoolFactory = (connectionString: string) => Pool;

const defaultPoolFactory: PoolFactory = connectionString => new Pool({ connectionString });

const makeDatabaseLive = (connectionString: string, createPool: PoolFactory = defaultPoolFactory) =>
	Layer.scoped(
		Database,
		Effect.acquireRelease(
			Effect.sync(() => {
				const pool = createPool(connectionString);
				return { db: drizzle(pool, { schema }), pool };
			}),
			({ pool }) => Effect.promise(() => pool.end())
		).pipe(Effect.map(({ db }) => ({ db })))
	);

const makeDatabaseTest = (db: DrizzleDatabase) => Layer.succeed(Database, { db });

export { makeDatabaseLive, makeDatabaseTest };
export type { PoolFactory };
