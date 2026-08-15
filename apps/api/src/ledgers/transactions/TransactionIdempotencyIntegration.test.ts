import { setTimeout as delay } from "node:timers/promises";

import { count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import Redis from "ioredis";
import type { FastifyInstance, InjectOptions } from "fastify";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { signJWT } from "@/auth";
import { Config } from "@/config";
import { newOrgID } from "@/repo/entities/types";
import {
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/repo/schema";
import { makeServerRuntimeLayer } from "@/runtime";
import { buildServer } from "@/server";

type JsonObject = Record<string, unknown>;
interface Fixture {
	organizationId: string;
	ledgerId: string;
	debitId: string;
	creditId: string;
}

const config = new Config();
const pool = new Pool({ connectionString: config.databaseUrl, max: 4 });
const db = drizzle(pool);
const organizationIds = new Set<string>();
const valkeyKeys = new Set<string>();

const auth = (organizationId: string) => ({
	Authorization: `Bearer ${signJWT({ sub: organizationId, scope: ["org_admin"] })}`,
});

const cacheKey = (organizationId: string, key: string) =>
	`exchequer:transactions:idempotency:${organizationId}:${key}`;

const payload = (
	fixture: Fixture,
	amount: number,
	description: string,
	status: "pending" | "posted" = "pending"
) => ({
	status,
	description,
	ledgerEntries: [
		{ accountId: fixture.debitId, direction: "debit" as const, amount },
		{ accountId: fixture.creditId, direction: "credit" as const, amount },
	],
});

const waitFor = async <A>(read: () => Promise<A>, ready: (value: A) => boolean): Promise<A> => {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		const value = await read();
		if (ready(value)) return value;
		await delay(10);
	}
	throw new Error("Timed out waiting for concurrent request state");
};

describe("Transaction idempotency across server instances", () => {
	let firstServer: FastifyInstance;
	let secondServer: FastifyInstance;
	let unavailableServer: FastifyInstance;
	let valkey: Redis;
	const servers: FastifyInstance[] = [];

	beforeAll(async () => {
		firstServer = await buildServer();
		servers.push(firstServer);
		secondServer = await buildServer();
		servers.push(secondServer);
		unavailableServer = await buildServer({
			runtimeLayer: makeServerRuntimeLayer(
				new Config({ valkeyUrl: "redis://127.0.0.1:1", environment: "test-valkey-unavailable" })
			),
		});
		servers.push(unavailableServer);
		valkey = new Redis(config.valkeyUrl, { maxRetriesPerRequest: 1 });
	});

	afterAll(async () => {
		const closures = await Promise.allSettled(servers.map(server => server.close()));
		try {
			if (valkey !== undefined) await valkey.quit();
		} finally {
			await pool.end();
		}
		const failed = closures.find(result => result.status === "rejected");
		if (failed?.status === "rejected") throw failed.reason;
	});

	afterEach(async () => {
		if (valkeyKeys.size > 0) await valkey.del(...valkeyKeys);
		valkeyKeys.clear();
		const ids = [...organizationIds];
		if (ids.length === 0) return;
		await db
			.delete(LedgerTransactionEntriesTable)
			.where(inArray(LedgerTransactionEntriesTable.organizationId, ids));
		await db
			.delete(LedgerTransactionsTable)
			.where(inArray(LedgerTransactionsTable.organizationId, ids));
		await db.delete(LedgerAccountsTable).where(inArray(LedgerAccountsTable.organizationId, ids));
		await db.delete(LedgersTable).where(inArray(LedgersTable.organizationId, ids));
		await db.delete(OrganizationsTable).where(inArray(OrganizationsTable.id, ids));
		organizationIds.clear();
	});

	const inject = (server: FastifyInstance, organizationId: string, options: InjectOptions) =>
		server.inject({
			...options,
			headers: { ...auth(organizationId), ...options.headers },
		});

	const fixtures = async (name: string) => {
		const organizationId = newOrgID().toString();
		organizationIds.add(organizationId);
		await db.insert(OrganizationsTable).values({ id: organizationId, name });

		const ledgerResponse = await inject(firstServer, organizationId, {
			method: "POST",
			url: "/api/ledgers",
			payload: { name: `${name} ledger` },
		});
		expect(ledgerResponse.statusCode).toBe(201);
		const ledgerId = ledgerResponse.json<JsonObject>().id as string;

		const createAccount = async (accountName: string, normalBalance: "debit" | "credit") => {
			const response = await inject(firstServer, organizationId, {
				method: "POST",
				url: `/api/ledgers/${ledgerId}/accounts`,
				payload: {
					name: accountName,
					normalBalance,
					currencyCode: "EUR",
					minorUnitExponent: 2,
				},
			});
			expect(response.statusCode).toBe(201);
			return response.json<JsonObject>().id as string;
		};

		return {
			organizationId,
			ledgerId,
			debitId: await createAccount(`${name} debit`, "debit"),
			creditId: await createAccount(`${name} credit`, "credit"),
		};
	};

	const create = (
		server: FastifyInstance,
		fixture: Awaited<ReturnType<typeof fixtures>>,
		key: string,
		body: ReturnType<typeof payload>
	) => {
		const keyName = cacheKey(fixture.organizationId, key);
		valkeyKeys.add(keyName);
		return inject(server, fixture.organizationId, {
			method: "POST",
			url: `/api/ledgers/${fixture.ledgerId}/transactions`,
			headers: { "idempotency-key": key },
			payload: body,
		});
	};

	const accountRow = (accountId: string) =>
		db
			.select({
				pendingCredits: LedgerAccountsTable.pendingCredits,
				pendingDebits: LedgerAccountsTable.pendingDebits,
				postedCredits: LedgerAccountsTable.postedCredits,
				postedDebits: LedgerAccountsTable.postedDebits,
				lockVersion: LedgerAccountsTable.lockVersion,
			})
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.id, accountId))
			.then(rows => rows[0]!);

	const persistedCounts = async (organizationId: string) => {
		const [transactions, entries] = await Promise.all([
			db
				.select({ value: count() })
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.organizationId, organizationId)),
			db
				.select({ value: count() })
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.organizationId, organizationId)),
		]);
		return { transactions: transactions[0]!.value, entries: entries[0]!.value };
	};

	it("returns one canonical result and applies one balance effect while requests overlap", async () => {
		const fixture = await fixtures("cross-instance overlap");
		const key = `overlap-${crypto.randomUUID()}`;
		const keyName = cacheKey(fixture.organizationId, key);
		valkeyKeys.add(keyName);
		const [debitBaseline, creditBaseline] = await Promise.all([
			accountRow(fixture.debitId),
			accountRow(fixture.creditId),
		]);
		let blocker: PoolClient | undefined;

		try {
			blocker = await pool.connect();
			await blocker.query("BEGIN");
			await blocker.query("SELECT id FROM ledger_accounts WHERE id = $1 FOR UPDATE", [
				fixture.debitId,
			]);

			const first = create(firstServer, fixture, key, payload(fixture, 125, "canonical"));
			const claimedId = await waitFor(
				() => valkey.get(keyName),
				value => value !== null
			);
			const second = create(secondServer, fixture, key, payload(fixture, 999, "ignored"));
			await delay(30);
			expect(await valkey.get(keyName)).toBe(claimedId);

			await blocker.query("COMMIT");
			blocker.release();
			blocker = undefined;

			const [firstResponse, secondResponse] = await Promise.all([first, second]);
			expect(firstResponse.statusCode).toBe(201);
			expect(secondResponse.statusCode).toBe(201);
			expect(secondResponse.json()).toEqual(firstResponse.json());
			expect(firstResponse.json<JsonObject>()).toMatchObject({
				id: claimedId,
				description: "canonical",
			});

			const [counts, debitAccount, creditAccount] = await Promise.all([
				persistedCounts(fixture.organizationId),
				accountRow(fixture.debitId),
				accountRow(fixture.creditId),
			]);
			expect(counts).toEqual({ transactions: 1, entries: 2 });
			expect(debitAccount).toEqual({
				pendingCredits: debitBaseline.pendingCredits,
				pendingDebits: debitBaseline.pendingDebits + 125,
				postedCredits: debitBaseline.postedCredits,
				postedDebits: debitBaseline.postedDebits,
				lockVersion: debitBaseline.lockVersion + 1,
			});
			expect(creditAccount).toEqual({
				pendingCredits: creditBaseline.pendingCredits + 125,
				pendingDebits: creditBaseline.pendingDebits,
				postedCredits: creditBaseline.postedCredits,
				postedDebits: creditBaseline.postedDebits,
				lockVersion: creditBaseline.lockVersion + 1,
			});
		} finally {
			if (blocker !== undefined) {
				await blocker.query("ROLLBACK");
				blocker.release();
			}
		}
	});

	it("claims on a cache miss before PostgreSQL recovery and repopulates the canonical ID", async () => {
		const fixture = await fixtures("cache miss recovery");
		const key = `miss-${crypto.randomUUID()}`;
		const first = await create(firstServer, fixture, key, payload(fixture, 210, "canonical"));
		expect(first.statusCode).toBe(201);
		const canonical = first.json<JsonObject>();
		const keyName = cacheKey(fixture.organizationId, key);
		const baseline = await accountRow(fixture.debitId);
		await valkey.del(keyName);
		let blocker: PoolClient | undefined;

		try {
			blocker = await pool.connect();
			await blocker.query("BEGIN");
			await blocker.query("LOCK TABLE ledger_transactions IN ACCESS EXCLUSIVE MODE");
			const replay = create(secondServer, fixture, key, payload(fixture, 999, "ignored"));

			const candidate = await waitFor(
				() => valkey.get(keyName),
				value => value !== null
			);
			expect(candidate).not.toBe(canonical.id);
			await blocker.query("COMMIT");
			blocker.release();
			blocker = undefined;

			const replayResponse = await replay;
			expect(replayResponse.statusCode).toBe(201);
			expect(replayResponse.json()).toEqual(canonical);
			expect(await valkey.get(keyName)).toBe(canonical.id);
			expect(await valkey.ttl(keyName)).toBeGreaterThan(0);
			expect(await persistedCounts(fixture.organizationId)).toEqual({
				transactions: 1,
				entries: 2,
			});
			expect(await accountRow(fixture.debitId)).toEqual(baseline);
		} finally {
			if (blocker !== undefined) {
				await blocker.query("ROLLBACK");
				blocker.release();
			}
		}
	});

	it("recovers an expired mapping and refreshes its TTL without another balance effect", async () => {
		const fixture = await fixtures("expired mapping");
		const key = `expired-${crypto.randomUUID()}`;
		const first = await create(firstServer, fixture, key, payload(fixture, 310, "canonical"));
		expect(first.statusCode).toBe(201);
		const canonical = first.json<JsonObject>();
		const keyName = cacheKey(fixture.organizationId, key);
		const baseline = await accountRow(fixture.debitId);
		await valkey.pexpire(keyName, 1);
		await waitFor(
			() => valkey.exists(keyName),
			exists => exists === 0
		);

		const replay = await create(secondServer, fixture, key, payload(fixture, 777, "ignored"));
		expect(replay.statusCode).toBe(201);
		expect(replay.json()).toEqual(canonical);
		expect(await valkey.get(keyName)).toBe(canonical.id);
		expect(await valkey.ttl(keyName)).toBeGreaterThan(0);
		expect(await persistedCounts(fixture.organizationId)).toEqual({
			transactions: 1,
			entries: 2,
		});
		expect(await accountRow(fixture.debitId)).toEqual(baseline);
	});

	it("limits a Valkey outage to creates", async () => {
		const fixture = await fixtures("Valkey outage");
		const pending = await create(
			firstServer,
			fixture,
			`pending-${crypto.randomUUID()}`,
			payload(fixture, 40, "replace then post")
		);
		const voidCandidate = await create(
			firstServer,
			fixture,
			`void-${crypto.randomUUID()}`,
			payload(fixture, 15, "void separately")
		);
		expect(pending.statusCode).toBe(201);
		expect(voidCandidate.statusCode).toBe(201);
		const pendingId = pending.json<JsonObject>().id as string;
		const voidId = voidCandidate.json<JsonObject>().id as string;
		const collection = `/api/ledgers/${fixture.ledgerId}/transactions`;

		const unavailableCreate = await create(
			unavailableServer,
			fixture,
			`unavailable-${crypto.randomUUID()}`,
			payload(fixture, 100, "unavailable")
		);
		expect(unavailableCreate.statusCode).toBe(503);

		const list = await inject(unavailableServer, fixture.organizationId, {
			method: "GET",
			url: collection,
		});
		const get = await inject(unavailableServer, fixture.organizationId, {
			method: "GET",
			url: `${collection}/${pendingId}`,
		});
		const replace = await inject(unavailableServer, fixture.organizationId, {
			method: "PUT",
			url: `${collection}/${pendingId}`,
			payload: {
				description: "replaced",
				ledgerEntries: payload(fixture, 50, "replaced").ledgerEntries,
			},
		});
		expect(list.statusCode).toBe(200);
		expect(get.statusCode).toBe(200);
		expect(replace.statusCode).toBe(200);

		const posted = await inject(unavailableServer, fixture.organizationId, {
			method: "POST",
			url: `${collection}/${pendingId}/post`,
		});
		const voided = await inject(unavailableServer, fixture.organizationId, {
			method: "DELETE",
			url: `${collection}/${voidId}`,
		});
		const ledger = await inject(unavailableServer, fixture.organizationId, {
			method: "GET",
			url: `/api/ledgers/${fixture.ledgerId}`,
		});
		const health = await unavailableServer.inject({ method: "GET", url: "/health" });
		expect(posted.statusCode).toBe(200);
		expect(voided.statusCode).toBe(204);
		expect(ledger.statusCode).toBe(200);
		expect(health.statusCode).toBe(200);
	});
});
