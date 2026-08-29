import { inArray } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import {
	newLedgerAccountBalanceMonitorID,
	newLedgerAccountID,
	newLedgerID,
	newOrgID,
	type LedgerAccountBalanceMonitorID,
	type LedgerAccountID,
} from "@/repo/entities/types";
import {
	LedgerAccountBalanceMonitorsTable,
	LedgerAccountsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/repo/schema";

import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import {
	LedgerAccountBalanceMonitorPersistenceDecodingFailure,
	LedgerAccountBalanceMonitorPersistenceFailure,
} from "./LedgerAccountBalanceMonitorErrors";
import {
	type LedgerAccountBalanceMonitorRepo,
	LedgerAccountBalanceMonitorRepoTag,
	ledgerAccountBalanceMonitorRepoLayer,
} from "./LedgerAccountBalanceMonitorRepo";

const applicationTime = DateTime.fromISO("2026-08-29T10:15:30.000Z", { zone: "utc" });

const monitor = (
	accountId: LedgerAccountID,
	overrides: {
		id?: LedgerAccountBalanceMonitorID;
		description?: string;
		metadata?: Readonly<Record<string, string>>;
		updated?: DateTime;
	} = {}
) =>
	LedgerAccountBalanceMonitor.fromRequest(
		overrides.id ?? newLedgerAccountBalanceMonitorID(),
		accountId,
		{
			accountId: accountId.toString(),
			description: overrides.description,
			alertCondition: [],
			metadata: overrides.metadata,
		},
		overrides.updated ?? applicationTime
	);

describe("LedgerAccountBalanceMonitorRepoLive", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const layer = ledgerAccountBalanceMonitorRepoLayer.pipe(Layer.provideMerge(databaseLayer));
	const runtime: ManagedRuntime.ManagedRuntime<Database | LedgerAccountBalanceMonitorRepo, never> =
		ManagedRuntime.make(layer);
	const organizationId = newOrgID();
	const ledgerId = newLedgerID();
	const accountIds = [newLedgerAccountID(), newLedgerAccountID()] as const;

	const run = <A, E>(use: (repository: LedgerAccountBalanceMonitorRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(LedgerAccountBalanceMonitorRepoTag.pipe(Effect.flatMap(use)));
	const database = () => runtime.runPromise(DatabaseTag);

	beforeAll(async () => {
		const db = (await database()).db;
		await db.insert(OrganizationsTable).values({
			id: organizationId.toString(),
			name: "Balance Monitor repository test",
		});
		await db.insert(LedgersTable).values({
			id: ledgerId.toString(),
			organizationId: organizationId.toString(),
			name: "Ledger",
		});
		await db.insert(LedgerAccountsTable).values(
			accountIds.map((accountId, index) => ({
				id: accountId.toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				name: `Account ${index}`,
				normalBalance: "debit" as const,
				currencyCode: "USD",
			}))
		);
	});

	afterAll(async () => {
		try {
			const db = (await database()).db;
			await db.delete(LedgerAccountBalanceMonitorsTable).where(
				inArray(
					LedgerAccountBalanceMonitorsTable.accountId,
					accountIds.map(accountId => accountId.toString())
				)
			);
			await db.delete(LedgerAccountsTable).where(
				inArray(
					LedgerAccountsTable.id,
					accountIds.map(accountId => accountId.toString())
				)
			);
			await db.delete(LedgersTable).where(inArray(LedgersTable.id, [ledgerId.toString()]));
			await db
				.delete(OrganizationsTable)
				.where(inArray(OrganizationsTable.id, [organizationId.toString()]));
		} finally {
			await runtime.dispose();
		}
	});

	it("preserves created-descending list order and pagination without a tie-breaker", async () => {
		const db = (await database()).db;
		const ids = [
			newLedgerAccountBalanceMonitorID(),
			newLedgerAccountBalanceMonitorID(),
			newLedgerAccountBalanceMonitorID(),
		];
		await db.insert(LedgerAccountBalanceMonitorsTable).values(
			ids.map((id, index) => ({
				id: id.toString(),
				accountId: accountIds[0].toString(),
				name: `Ordered ${index}`,
				created: new Date(`9999-12-31T23:5${7 + index}:00.000Z`),
			}))
		);

		const page = await run(repository => repository.listMonitors({ offset: 1, limit: 1 }));

		expect(page.map(value => value.id.toString())).toEqual([ids[1].toString()]);
	});

	it.each([
		{
			label: "stored optional values",
			description: "Low balance",
			metadata: { team: "treasury" },
		},
		{ label: "omitted optional values", description: undefined, metadata: undefined },
	])("creates, gets, and deletes $label", async ({ description, metadata }) => {
		const record = monitor(accountIds[0], { description, metadata });
		const created = await run(repository => repository.createMonitor(record));

		expect(created.description).toBe(description);
		expect(created.metadata).toEqual(metadata);
		expect(created.updated).toEqual(applicationTime);
		expect(Option.getOrUndefined(await run(repository => repository.getMonitor(record.id)))).toEqual(
			created
		);
		expect(await run(repository => repository.deleteMonitor(record.id))).toSatisfy(Option.isSome);
	});

	it("updates the existing assignments and application-supplied time", async () => {
		const original = monitor(accountIds[0], {
			description: "Before",
			metadata: { version: "before" },
		});
		await run(repository => repository.createMonitor(original));
		const updatedAt = DateTime.fromISO("2026-08-29T12:30:00.000Z", { zone: "utc" });
		const replacement = monitor(accountIds[1], {
			id: original.id,
			description: "After",
			metadata: { version: "after" },
			updated: updatedAt,
		});

		const updated = Option.getOrThrow(
			await run(repository => repository.updateMonitor(original.id, replacement))
		);

		expect(updated).toMatchObject({
			id: original.id,
			accountId: accountIds[1],
			name: "After",
			description: "After",
			alertThreshold: 0,
			isActive: true,
			metadata: { version: "after" },
			updated: updatedAt,
		});
	});

	it("preserves stored optional columns when update fields are omitted", async () => {
		const original = monitor(accountIds[0], {
			description: "Keep description",
			metadata: { keep: "metadata" },
		});
		await run(repository => repository.createMonitor(original));
		const replacement = monitor(accountIds[0], { id: original.id });

		const updated = Option.getOrThrow(
			await run(repository => repository.updateMonitor(original.id, replacement))
		);

		expect(updated.description).toBe("Keep description");
		expect(updated.metadata).toEqual({ keep: "metadata" });
	});

	it("returns explicit absence for missing get, update, and delete", async () => {
		const id = newLedgerAccountBalanceMonitorID();
		const replacement = monitor(accountIds[0], { id });
		const [found, updated, deleted] = await run(repository =>
			Effect.all([
				repository.getMonitor(id),
				repository.updateMonitor(id, replacement),
				repository.deleteMonitor(id),
			])
		);

		expect(Option.isNone(found)).toBe(true);
		expect(Option.isNone(updated)).toBe(true);
		expect(Option.isNone(deleted)).toBe(true);
	});

	it("maps PostgreSQL failures to the sanitized persistence error", async () => {
		const missingAccount = newLedgerAccountID();
		const error = await run(repository =>
			Effect.flip(repository.createMonitor(monitor(missingAccount)))
		);

		expect(error).toBeInstanceOf(LedgerAccountBalanceMonitorPersistenceFailure);
		expect(error.message).toBe("Internal Server Error");
	});

	it("maps undecodable rows to the sanitized decoding error", async () => {
		const invalidId = "not-a-balance-monitor";
		const db = (await database()).db;
		await db.insert(LedgerAccountBalanceMonitorsTable).values({
			id: invalidId,
			accountId: accountIds[0].toString(),
			name: "Malformed",
		});

		const error = await run(repository =>
			Effect.flip(repository.getMonitor(invalidId as unknown as LedgerAccountBalanceMonitorID))
		);

		expect(error).toBeInstanceOf(LedgerAccountBalanceMonitorPersistenceDecodingFailure);
		expect(error.message).toBe("Internal Server Error");
	});
});
