import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { JobStore } from "effect-mq";
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Config } from "@/config";
import { DatabaseTag, makeDatabaseLive, type Database } from "@/db";
import { newOrgID, newLedgerID, newLedgerAccountID } from "@/repo/entities/types";
import {
	BalanceMonitorOutboxTable as outbox,
	BalanceMonitorRevisionsTable as revisions,
	LedgerAccountBalanceMonitorsTable as monitors,
	LedgerAccountsTable as accounts,
	LedgersTable as ledgers,
	OrganizationsTable as organizations,
} from "@/repo/schema";
import { MonitorOutboxRepoLive, type ClaimedMonitorEvent } from "./MonitorOutboxRepo";
import { makeMonitorJobStore } from "./MonitorQueue";
import { relayMonitorBatch } from "./MonitorRelay";
const valkeyUrl = process.env.VALKEY_URL ?? "redis://127.0.0.1:6379";
const configuration = {
	description: "Original",
	metadata: "{}",
	alertCondition: {
		mode: "all" as const,
		conditions: [{ balanceType: "posted" as const, operator: "<" as const, value: 100 }],
	},
	webhookUrl: "https://example.com/original",
	webhookToken: "encrypted-original",
};
describe("Monitor relay durable handoff", () => {
	const prefix = `monitor-relay-test-${randomUUID()}`;
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			makeDatabaseLive(new Config().databaseUrl),
			makeMonitorJobStore(valkeyUrl, { prefix })
		)
	);
	const scope = {
		organizationId: newOrgID().toString(),
		ledgerId: newLedgerID().toString(),
		accountId: newLedgerAccountID().toString(),
	};
	let database: Database;
	let repository: MonitorOutboxRepoLive;
	let store: JobStore.Service;
	let event: ClaimedMonitorEvent;
	let monitorIds: string[];
	beforeAll(async () => {
		database = await runtime.runPromise(DatabaseTag);
		repository = new MonitorOutboxRepoLive(database.effectDb);
		store = await runtime.runPromise(JobStore.JobStore);
		await database.db.insert(organizations).values({ id: scope.organizationId, name: "Relay test" });
		await database.db
			.insert(ledgers)
			.values({ id: scope.ledgerId, organizationId: scope.organizationId, name: "Ledger" });
		await database.db.insert(accounts).values({
			...scope,
			id: scope.accountId,
			name: "Account",
			normalBalance: "debit",
			currencyCode: "USD",
		});
	});
	beforeEach(async () => {
		monitorIds = [randomUUID(), randomUUID()];
		for (const id of monitorIds) {
			await database.db.insert(monitors).values({ id, ...scope, ...configuration });
			await database.db.insert(revisions).values({
				monitorId: id,
				accountId: scope.accountId,
				version: 1,
				startVersion: 0,
				endVersion: 2,
				configuration,
			});
		}
		const [inserted] = await database.db
			.insert(outbox)
			.values({
				id: randomUUID(),
				...scope,
				accountVersion: 2,
				transactionId: randomUUID(),
				occurredAt: new Date(),
				currencyCode: "USD",
				before: { posted: 100, pending: 100, availableBalance: 100 },
				after: { posted: 90, pending: 90, availableBalance: 90 },
				claimToken: randomUUID(),
			})
			.returning();
		event = { ...inserted, claimToken: inserted.claimToken! };
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await database.db.delete(outbox).where(eq(outbox.accountId, scope.accountId));
		await database.db.delete(monitors).where(eq(monitors.accountId, scope.accountId));
	});
	afterAll(async () => {
		try {
			await database.db.delete(accounts).where(eq(accounts.id, scope.accountId));
			await database.db.delete(ledgers).where(eq(ledgers.id, scope.ledgerId));
			await database.db.delete(organizations).where(eq(organizations.id, scope.organizationId));
		} finally {
			await runtime.dispose();
			const cleanup = new Redis(valkeyUrl, { maxRetriesPerRequest: 1 });
			try {
				let cursor = "0";
				do {
					const [next, keys] = await cleanup.scan(cursor, "MATCH", `${prefix}:*`, "COUNT", 100);
					cursor = next;
					if (keys.length) await cleanup.del(...keys);
				} while (cursor !== "0");
			} finally {
				cleanup.disconnect();
			}
		}
	});
	const relayRepo = () => ({
		claimBatch: () => Effect.succeed([event]),
		revisionsFor: repository.revisionsFor.bind(repository),
		acknowledge: repository.acknowledge.bind(repository),
		cleanup: repository.cleanup.bind(repository),
	});
	const pending = () => database.db.select().from(outbox).where(eq(outbox.id, event.id));
	it("publishes every historical revision before acknowledging and retains immutable inputs after edit/deletion", async () => {
		await database.db
			.update(monitors)
			.set({
				...configuration,
				webhookUrl: "https://example.com/new",
				webhookToken: "encrypted-new",
				lockVersion: 2,
				deletedAt: new Date(),
			})
			.where(eq(monitors.accountId, scope.accountId));
		const ids: JobStore.JobId[] = [];
		const enqueue = store.enqueue;
		vi.spyOn(store, "enqueue").mockImplementation(request =>
			Effect.gen(function* () {
				const rows = yield* Effect.promise(pending);
				expect(rows).toHaveLength(1);
				const result = yield* enqueue(request);
				ids.push(result.id);
				return result;
			})
		);
		expect(await runtime.runPromise(relayMonitorBatch(relayRepo()))).toBe(1);
		expect(ids).toHaveLength(2);
		expect(await pending()).toEqual([]);
		await runtime.runPromise(repository.cleanup(scope.accountId));
		for (const id of ids) {
			const stored = Option.getOrThrow(await runtime.runPromise(store.getJob(id)));
			expect(stored.payload).toMatchObject({
				eventId: event.id,
				monitorVersion: 1,
				webhookUrl: configuration.webhookUrl,
				webhookToken: configuration.webhookToken,
				alertCondition: configuration.alertCondition,
				before: event.before,
				after: event.after,
			});
		}
	});
	it("retains the PostgreSQL event when only part of its queue publication succeeds", async () => {
		const enqueue = store.enqueue;
		let calls = 0;
		vi
			.spyOn(store, "enqueue")
			.mockImplementation(request =>
				++calls === 2 ? Effect.die("publication failed") : enqueue(request)
			);
		await expect(runtime.runPromise(relayMonitorBatch(relayRepo()))).rejects.toThrow();
		expect(calls).toBe(2);
		expect(await pending()).toHaveLength(1);
	});
	it("deduplicates publication after a crash before PostgreSQL acknowledgement", async () => {
		const ids: JobStore.EnqueueResult[] = [];
		const enqueue = store.enqueue;
		vi.spyOn(store, "enqueue").mockImplementation(request =>
			enqueue(request).pipe(
				Effect.tap(result =>
					Effect.sync(() => {
						ids.push(result);
					})
				)
			)
		);
		const crashed = {
			...relayRepo(),
			acknowledge: () => Effect.die("crashed before acknowledgement"),
		};
		await expect(runtime.runPromise(relayMonitorBatch(crashed))).rejects.toThrow();
		expect(await pending()).toHaveLength(1);
		await runtime.runPromise(relayMonitorBatch(relayRepo()));
		expect(ids.map(result => result.duplicate)).toEqual([false, false, true, true]);
		expect(ids.slice(0, 2).map(result => result.id)).toEqual(ids.slice(2).map(result => result.id));
		expect(await pending()).toEqual([]);
	});
});
