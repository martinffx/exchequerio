import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Config } from "@/config";
import { DatabaseTag, makeDatabaseLive, type Database } from "@/db";
import { newLedgerAccountID, newLedgerID, newOrgID } from "@/lib/ids";
import {
	AssetsTable,
	BalanceMonitorOutboxTable as outbox,
	BalanceMonitorRevisionsTable as revisions,
	LedgerAccountBalanceMonitorsTable as monitors,
	LedgerAccountsTable as accounts,
	LedgersTable as ledgers,
	OrganizationsTable as organizations,
} from "@/db/schema";
import { MonitorOutboxRepoLive } from "./MonitorOutboxRepo";

const configuration = {
	description: "outbox test",
	metadata: "{}",
	alertCondition: {
		mode: "all" as const,
		conditions: [{ balanceType: "posted" as const, operator: "<" as const, value: "100" }],
	},
	webhookUrl: "https://example.com/monitor",
	webhookToken: "encrypted-token",
};

describe("MonitorOutboxRepoLive", () => {
	const runtime = ManagedRuntime.make(makeDatabaseLive(new Config().databaseUrl));
	const assetId = randomUUID();
	const scope = {
		organizationId: newOrgID().toUUID(),
		ledgerId: newLedgerID().toUUID(),
		accountId: newLedgerAccountID().toUUID(),
	};
	let database: Database;
	let repository: MonitorOutboxRepoLive;
	let monitorId: string;

	beforeAll(async () => {
		database = await runtime.runPromise(DatabaseTag);
		repository = new MonitorOutboxRepoLive(database.effectDb);
		await database.db
			.insert(organizations)
			.values({ id: scope.organizationId, name: "Outbox repository test" });
		await database.db
			.insert(ledgers)
			.values({ id: scope.ledgerId, organizationId: scope.organizationId, name: "Ledger" });
		await database.db.insert(AssetsTable).values({
			id: assetId,
			organizationId: scope.organizationId,
			code: "USD",
			name: "US Dollar",
			minorUnitExponent: 2,
		});
		await database.db.insert(accounts).values({
			id: scope.accountId,
			ledgerId: scope.ledgerId,
			organizationId: scope.organizationId,
			name: "Account",
			normalBalance: "debit",
			assetId,
		});
	});
	beforeEach(async () => {
		monitorId = randomUUID();
		await database.db.insert(monitors).values({ id: monitorId, ...scope, ...configuration });
	});
	afterEach(async () => {
		await database.db.delete(outbox).where(eq(outbox.accountId, scope.accountId));
		await database.db.delete(monitors).where(eq(monitors.accountId, scope.accountId));
	});
	afterAll(async () => {
		try {
			await database.db.delete(accounts).where(eq(accounts.id, scope.accountId));
			await database.db.delete(ledgers).where(eq(ledgers.id, scope.ledgerId));
			await database.db.delete(AssetsTable).where(eq(AssetsTable.id, assetId));
			await database.db.delete(organizations).where(eq(organizations.id, scope.organizationId));
		} finally {
			await runtime.dispose();
		}
	});

	const insertEvent = async (accountVersion: number) => {
		const [event] = await database.db
			.insert(outbox)
			.values({
				id: randomUUID(),
				...scope,
				accountVersion,
				transactionId: randomUUID(),
				occurredAt: new Date(),
				assetId,
				assetCode: "USD",
				minorUnitExponent: 2,
				before: { posted: "100", pending: "100", availableBalance: "100" },
				after: { posted: "90", pending: "90", availableBalance: "90" },
				// Keep this test's claims ahead of concurrently produced integration fixtures.
				created: new Date(1900, 0, accountVersion),
			})
			.returning();
		return event;
	};
	const insertRevision = (version: number, startVersion: number, endVersion?: number) =>
		database.db.insert(revisions).values({
			monitorId,
			accountId: scope.accountId,
			version,
			startVersion,
			endVersion,
			configuration,
		});

	it("claims disjoint bounded batches and excludes live claims", async () => {
		const first = await insertEvent(2);
		const second = await insertEvent(3);
		const claims = await Promise.all([
			runtime.runPromise(repository.claimBatch(1)),
			runtime.runPromise(repository.claimBatch(1)),
		]);
		expect(
			claims
				.flat()
				.map(event => event.id)
				.sort()
		).toEqual([first.id, second.id].sort());
		expect(claims[0][0].claimToken).not.toBe(claims[1][0].claimToken);
		for (const event of claims.flat()) {
			expect(event.claimUntil!.getTime()).toBeGreaterThan(Date.now() + 50_000);
		}
	});

	it("skips a row locked by another relay instead of waiting", async () => {
		const lockedEvent = await insertEvent(2);
		const availableEvent = await insertEvent(3);
		let rowLocked!: () => void;
		let releaseLock!: () => void;
		const acquired = new Promise<void>(resolve => {
			rowLocked = resolve;
		});
		const release = new Promise<void>(resolve => {
			releaseLock = resolve;
		});
		const locking = database.db.transaction(async tx => {
			await tx.select().from(outbox).where(eq(outbox.id, lockedEvent.id)).for("update");
			rowLocked();
			await release;
		});
		try {
			await acquired;
			const result = await runtime.runPromise(
				repository.claimBatch(1).pipe(Effect.timeout("1 second"))
			);
			expect(result.map(event => event.id)).toEqual([availableEvent.id]);
		} finally {
			releaseLock();
			await locking;
		}
	});

	it("reclaims expired leases and fences stale acknowledgements and releases", async () => {
		const event = await insertEvent(2);
		const [first] = await runtime.runPromise(repository.claimBatch(1));
		await database.db
			.update(outbox)
			.set({ claimUntil: sql`now() - interval '1 second'` })
			.where(eq(outbox.id, event.id));
		const [second] = await runtime.runPromise(repository.claimBatch(1));
		expect(second.id).toBe(event.id);
		expect(second.claimToken).not.toBe(first.claimToken);
		expect(await runtime.runPromise(repository.acknowledge(event.id, first.claimToken))).toBe(false);
		expect(await runtime.runPromise(repository.release(event.id, first.claimToken))).toBe(false);
		expect(await runtime.runPromise(repository.release(event.id, second.claimToken))).toBe(true);
		const [third] = await runtime.runPromise(repository.claimBatch(1));
		expect(await runtime.runPromise(repository.acknowledge(event.id, third.claimToken))).toBe(true);
		expect(await database.db.select().from(outbox).where(eq(outbox.id, event.id))).toEqual([]);
	});

	it("selects historical revisions at exclusive start and inclusive end boundaries within scope", async () => {
		await insertRevision(1, 1, 3);
		await insertRevision(2, 3, 5);
		await insertRevision(3, 5);
		await database.db
			.update(monitors)
			.set({ deletedAt: new Date() })
			.where(eq(monitors.id, monitorId));
		for (const [accountVersion, expectedVersions] of [
			[1, []],
			[2, [1]],
			[3, [1]],
			[4, [2]],
			[5, [2]],
			[6, [3]],
		] as const) {
			const matching = await runtime.runPromise(repository.revisionsFor({ ...scope, accountVersion }));
			expect(matching.map(revision => revision.version)).toEqual(expectedVersions);
		}
		expect(
			await runtime.runPromise(
				repository.revisionsFor({ ...scope, organizationId: randomUUID(), accountVersion: 2 })
			)
		).toEqual([]);
		expect(
			await runtime.runPromise(
				repository.revisionsFor({ ...scope, ledgerId: randomUUID(), accountVersion: 2 })
			)
		).toEqual([]);
	});

	it("retains needed retired revisions and deletes a retired head only after all work is handed off", async () => {
		await insertRevision(1, 1, 3);
		await insertRevision(2, 3, 5);
		await database.db
			.update(monitors)
			.set({ deletedAt: new Date() })
			.where(eq(monitors.id, monitorId));
		const event = await insertEvent(3);
		await runtime.runPromise(repository.cleanup(scope.accountId));
		expect(
			(await database.db.select().from(revisions).where(eq(revisions.monitorId, monitorId))).map(
				revision => revision.version
			)
		).toEqual([1]);
		expect(await database.db.select().from(monitors).where(eq(monitors.id, monitorId))).toHaveLength(
			1
		);
		const [claimed] = await runtime.runPromise(repository.claimBatch(1));
		await runtime.runPromise(repository.acknowledge(event.id, claimed.claimToken));
		await runtime.runPromise(repository.cleanup(scope.accountId));
		expect(
			await database.db.select().from(revisions).where(eq(revisions.monitorId, monitorId))
		).toEqual([]);
		expect(await database.db.select().from(monitors).where(eq(monitors.id, monitorId))).toEqual([]);
	});

	it("keeps active revisions and active monitor heads during cleanup", async () => {
		await insertRevision(1, 1);
		await runtime.runPromise(repository.cleanup(scope.accountId));
		expect(
			await database.db.select().from(revisions).where(eq(revisions.monitorId, monitorId))
		).toHaveLength(1);
		expect(await database.db.select().from(monitors).where(eq(monitors.id, monitorId))).toHaveLength(
			1
		);
	});
});
