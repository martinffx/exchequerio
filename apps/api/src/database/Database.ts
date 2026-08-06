import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Context, Effect, Layer } from "effect";
import { Pool, type PoolClient } from "pg";
import * as schema from "../repo/schema";

type DrizzleDatabase = NodePgDatabase<typeof schema>;

abstract class Database {
	abstract readonly db: DrizzleDatabase;
}

const DatabaseTag = Context.Service<Database>("Database");

type PoolFactory = (connectionString: string) => Pool;

const defaultPoolFactory: PoolFactory = connectionString =>
	new Pool({ connectionString, connectionTimeoutMillis: 2_000 });

type Settlement =
	| { readonly _tag: "Resolved" }
	| { readonly _tag: "Rejected"; readonly error: unknown };

const settleWithin = (
	promise: Promise<unknown>,
	timeoutMs: number
): Promise<Settlement | undefined> =>
	new Promise(resolve => {
		let settled = false;
		const finish = (result: Settlement | undefined) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve(result);
		};
		const timeout = setTimeout(() => finish(undefined), timeoutMs);
		void promise.then(
			() => finish({ _tag: "Resolved" }),
			error => finish({ _tag: "Rejected", error })
		);
	});

class DatabaseLive extends Database {
	readonly db: DrizzleDatabase;
	private readonly clients = new Set<PoolClient>();
	private readonly onConnect = (client: PoolClient) => this.clients.add(client);
	private readonly onRemove = (client: PoolClient) => this.clients.delete(client);

	constructor(
		private readonly pool: Pool,
		private readonly shutdownTimeoutMs: number
	) {
		super();
		this.db = drizzle(pool, { schema });
		pool.on("connect", this.onConnect);
		pool.on("remove", this.onRemove);
	}

	close(): Effect.Effect<void> {
		return Effect.tryPromise({
			try: async () => {
				const issues: unknown[] = [];
				const forceClientsClosed = async () => {
					const settlements = await Promise.allSettled(
						[...this.clients].map(client =>
							Promise.resolve().then(() => {
								client.release(true);
							})
						)
					);
					for (const settlement of settlements) {
						if (settlement.status === "rejected") issues.push(settlement.reason);
					}
				};

				try {
					let graceful: Promise<void>;
					try {
						graceful = this.pool.end();
					} catch (error) {
						issues.push(error);
						await forceClientsClosed();
						return issues;
					}

					const initial = await settleWithin(graceful, this.shutdownTimeoutMs);
					if (initial?._tag === "Resolved") return issues;
					if (initial?._tag === "Rejected") issues.push(initial.error);

					await forceClientsClosed();
					if (initial === undefined) {
						const forced = await settleWithin(graceful, this.shutdownTimeoutMs);
						if (forced?._tag === "Rejected") issues.push(forced.error);
						if (forced === undefined) {
							issues.push(new Error("PostgreSQL pool shutdown timed out"));
						}
					}
					return issues;
				} finally {
					this.pool.off("connect", this.onConnect);
					this.pool.off("remove", this.onRemove);
				}
			},
			catch: error => error,
		}).pipe(
			Effect.flatMap(issues =>
				issues.length === 0
					? Effect.void
					: Effect.logWarning("PostgreSQL pool shutdown did not complete cleanly", { issues })
			),
			Effect.catch(error => Effect.logWarning("PostgreSQL pool shutdown cleanup failed", { error }))
		);
	}
}

const makeDatabaseLive = (
	connectionString: string,
	createPool: PoolFactory = defaultPoolFactory,
	shutdownTimeoutMs = 1_000
) =>
	Layer.effect(
		DatabaseTag,
		Effect.acquireRelease(
			Effect.sync(() => new DatabaseLive(createPool(connectionString), shutdownTimeoutMs)),
			database => database.close()
		)
	);

const makeDatabaseTest = (db: DrizzleDatabase) => Layer.succeed(DatabaseTag, { db });

export type { DrizzleDatabase, PoolFactory };
export { Database, DatabaseLive, DatabaseTag, makeDatabaseLive, makeDatabaseTest };
