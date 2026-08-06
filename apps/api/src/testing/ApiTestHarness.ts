import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import Redis from "ioredis";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import type { FastifyInstance } from "fastify";
import { signJWT } from "../Auth";
import { Config } from "../Config";
import { makeDatabaseTest, type DrizzleDatabase } from "../database/Database";
import * as schema from "../repo/schema";
import { LedgersTable, OrganizationsTable } from "../repo/schema";
import { makeRedisClientTest } from "../runtime/RedisClient";
import { makeServerRuntimeLayer } from "../runtime/ServerRuntime";
import { buildServer } from "../Server";

type TestScope = "super_admin" | "org_admin" | "org_user" | "org_readonly";

interface ApiTestHarnessOptions {
	readonly environment?: string;
	readonly rateLimitMax?: number;
	readonly rateLimitWindowMs?: number;
}

interface ApiTestHarness {
	readonly server: FastifyInstance;
	readonly db: DrizzleDatabase;
	readonly redis: Redis;
	readonly environment: string;
	readonly organizationIds: Set<string>;
	readonly ledgerIds: Set<string>;
	readonly token: (organizationId: string, scope?: TestScope) => string;
	readonly createOrganization: (name: string, description?: string) => Promise<string>;
	readonly createLedger: (organizationId: string, name?: string) => Promise<string>;
	readonly rememberOrganization: (organizationId: string) => void;
	readonly close: () => Promise<void>;
}

const createApiTestHarness = async (
	options: ApiTestHarnessOptions = {}
): Promise<ApiTestHarness> => {
	const environment = options.environment ?? `test-${new TypeID("tst").toString()}`;
	const config = new Config({
		environment,
		organizationRateLimitMax: options.rateLimitMax ?? 1000,
		organizationRateLimitWindowMs: options.rateLimitWindowMs ?? 60_000,
	});
	const pool = new Pool({ connectionString: config.databaseUrl });
	const db = drizzle(pool, { schema });
	const redis = new Redis(config.redisUrl);
	const organizationIds = new Set<string>();
	const ledgerIds = new Set<string>();
	const runtimeLayer = makeServerRuntimeLayer(config, {
		database: makeDatabaseTest(db),
		redis: makeRedisClientTest(redis),
	});
	const server = await buildServer({ runtimeLayer });

	const createOrganization = async (name: string, description?: string) => {
		const id = new TypeID("org").toString();
		organizationIds.add(id);
		await db.insert(OrganizationsTable).values({ id, name, description });
		return id;
	};
	const createLedger = async (organizationId: string, name = "Dependent Ledger") => {
		const id = new TypeID("lgr").toString();
		ledgerIds.add(id);
		await db.insert(LedgersTable).values({ id, organizationId, name });
		return id;
	};
	const clearRateLimits = async () => {
		let cursor = "0";
		do {
			const [next, keys] = await redis.scan(
				cursor,
				"MATCH",
				`exchequer:${environment}:organizations:*`,
				"COUNT",
				100
			);
			cursor = next;
			if (keys.length > 0) await redis.del(...keys);
		} while (cursor !== "0");
	};
	const close = async () => {
		for (const id of ledgerIds) await db.delete(LedgersTable).where(eq(LedgersTable.id, id));
		for (const id of organizationIds) {
			await db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id));
		}
		await clearRateLimits();
		await server.close();
		redis.disconnect();
		await pool.end();
	};

	return {
		server,
		db,
		redis,
		environment,
		organizationIds,
		ledgerIds,
		token: (organizationId, scope = "super_admin") =>
			signJWT({ sub: organizationId, scope: [scope] }),
		createOrganization,
		createLedger,
		rememberOrganization: id => organizationIds.add(id),
		close,
	};
};

export type { ApiTestHarness, ApiTestHarnessOptions, TestScope };
export { createApiTestHarness };
