import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Context, Effect, Layer } from "effect";
import { Pool } from "pg";
import * as schema from "../repo/schema";

type DrizzleDatabase = NodePgDatabase<typeof schema>;

abstract class Database {
	abstract readonly db: DrizzleDatabase;
}

const DatabaseTag = Context.Service<Database>("Database");

type PoolFactory = (connectionString: string) => Pool;

const defaultPoolFactory: PoolFactory = connectionString =>
	new Pool({ connectionString, connectionTimeoutMillis: 2_000 });

class DatabaseLive extends Database {
	readonly db: DrizzleDatabase;

	constructor(private readonly pool: Pool) {
		super();
		this.db = drizzle(pool, { schema });
	}

	close(): Effect.Effect<void> {
		return Effect.tryPromise({
			try: () => this.pool.end(),
			catch: error => error,
		}).pipe(Effect.catch(error => Effect.logWarning("PostgreSQL pool shutdown failed", { error })));
	}
}

const makeDatabaseLive = (connectionString: string, createPool: PoolFactory = defaultPoolFactory) =>
	Layer.effect(
		DatabaseTag,
		Effect.acquireRelease(
			Effect.sync(() => new DatabaseLive(createPool(connectionString))),
			database => database.close()
		)
	);

const makeDatabaseTest = (db: DrizzleDatabase) => Layer.succeed(DatabaseTag, { db });

export type { DrizzleDatabase, PoolFactory };
export { Database, DatabaseLive, DatabaseTag, makeDatabaseLive, makeDatabaseTest };
