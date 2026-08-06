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

type CleanupStep = () => unknown;

const runCleanupSteps = async (steps: readonly CleanupStep[]): Promise<void> => {
	const errors: unknown[] = [];
	for (const step of steps) {
		try {
			await step();
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length > 0) throw new AggregateError(errors, "API test harness cleanup failed");
};

const makeIdempotentCleanup = (steps: readonly CleanupStep[]): (() => Promise<void>) => {
	let cleanup: Promise<void> | undefined;
	return () => (cleanup ??= runCleanupSteps(steps));
};

const errorsFrom = (error: unknown): readonly unknown[] =>
	error instanceof AggregateError ? (error.errors as unknown[]) : [error];

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
	let redis: Redis;
	try {
		redis = new Redis(config.redisUrl);
	} catch (setupError) {
		try {
			await runCleanupSteps([() => pool.end()]);
		} catch (cleanupError) {
			const cleanupErrors = errorsFrom(cleanupError);
			throw new AggregateError(
				[setupError, ...cleanupErrors],
				"API test harness setup and cleanup failed"
			);
		}
		throw setupError;
	}
	const organizationIds = new Set<string>();
	const ledgerIds = new Set<string>();
	const runtimeLayer = makeServerRuntimeLayer(config, {
		database: makeDatabaseTest(db),
		redis: makeRedisClientTest(redis),
	});
	let server: FastifyInstance;
	try {
		server = await buildServer({ runtimeLayer });
	} catch (setupError) {
		try {
			await runCleanupSteps([() => redis.disconnect(), () => pool.end()]);
		} catch (cleanupError) {
			const cleanupErrors = errorsFrom(cleanupError);
			throw new AggregateError(
				[setupError, ...cleanupErrors],
				"API test harness setup and cleanup failed"
			);
		}
		throw setupError;
	}

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
	const close = makeIdempotentCleanup([
		() =>
			runCleanupSteps(
				[...ledgerIds].map(id => () => db.delete(LedgersTable).where(eq(LedgersTable.id, id)))
			),
		() =>
			runCleanupSteps(
				[...organizationIds].map(
					id => () => db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, id))
				)
			),
		clearRateLimits,
		() => server.close(),
		() => redis.disconnect(),
		() => pool.end(),
	]);

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
export { createApiTestHarness, makeIdempotentCleanup, runCleanupSteps };
