import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Context, Effect, Layer } from "effect";
import { Pool, types } from "pg";
import { schemaRelations } from "./schema";

type DrizzleDatabase = NodePgDatabase<typeof schemaRelations>;
type EffectDrizzleDatabase = PgDrizzle.EffectPgDatabase<typeof schemaRelations>;

const drizzleParsedTypeIds = new Set([1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182]);

abstract class Database {
	abstract readonly db: DrizzleDatabase;
	abstract readonly effectDb: EffectDrizzleDatabase;
}

const DatabaseTag = Context.Service<Database>("Database");

type PoolFactory = (connectionString: string) => Pool;

const defaultPoolFactory: PoolFactory = connectionString =>
	new Pool({ connectionString, connectionTimeoutMillis: 2_000 });

class DatabaseLive extends Database {
	readonly db: DrizzleDatabase;

	constructor(
		private readonly pool: Pool,
		readonly effectDb: EffectDrizzleDatabase
	) {
		super();
		this.db = drizzle({ client: pool, relations: schemaRelations });
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
		Effect.gen(function* () {
			const pool = yield* Effect.acquireRelease(
				Effect.sync(() => createPool(connectionString)),
				pool =>
					Effect.tryPromise({
						try: () => pool.end(),
						catch: error => error,
					}).pipe(Effect.catch(error => Effect.logWarning("PostgreSQL pool shutdown failed", { error })))
			);
			const pgClientLayer = PgClient.layerFrom(
				PgClient.fromPool({
					acquire: Effect.succeed(pool),
					types: {
						getTypeParser: (typeId, format) => {
							const parser = types.getTypeParser(typeId, format) as (value: string) => unknown;
							return drizzleParsedTypeIds.has(typeId) ? (value: string) => value : parser;
						},
					},
				})
			);
			const effectDb = yield* PgDrizzle.makeWithDefaults({ relations: schemaRelations }).pipe(
				Effect.provide(pgClientLayer),
				Effect.orDie
			);
			return new DatabaseLive(pool, effectDb);
		})
	);

export type { DrizzleDatabase, EffectDrizzleDatabase, PoolFactory };
export { Database, DatabaseLive, DatabaseTag, makeDatabaseLive };
