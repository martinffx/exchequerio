import { inArray, sql } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import type { Metadata } from "@/lib/utils";
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
} from "@/lib/ids";
import {
	LedgerAccountBalanceMonitorsTable,
	LedgerAccountsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/db/schema";

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
		metadata?: Metadata;
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

	let repository: LedgerAccountBalanceMonitorRepo;
	let database: Database;

	beforeAll(async () => {
		repository = await runtime.runPromise(LedgerAccountBalanceMonitorRepoTag);
		database = await runtime.runPromise(DatabaseTag);
		const db = database.db;
		await db.insert(OrganizationsTable).values({
			id: organizationId.toUUID(),
			name: "Balance Monitor repository test",
		});
		await db.insert(LedgersTable).values({
			id: ledgerId.toUUID(),
			organizationId: organizationId.toUUID(),
			name: "Ledger",
		});
		await db.insert(LedgerAccountsTable).values(
			accountIds.map((accountId, index) => ({
				id: accountId.toUUID(),
				organizationId: organizationId.toUUID(),
				ledgerId: ledgerId.toUUID(),
				name: `Account ${index}`,
				normalBalance: "debit" as const,
				currencyCode: "USD",
			}))
		);
	});

	afterAll(async () => {
		try {
			const db = database.db;
			await db.delete(LedgerAccountBalanceMonitorsTable).where(
				inArray(
					LedgerAccountBalanceMonitorsTable.accountId,
					accountIds.map(accountId => accountId.toUUID())
				)
			);
			await db.delete(LedgerAccountsTable).where(
				inArray(
					LedgerAccountsTable.id,
					accountIds.map(accountId => accountId.toUUID())
				)
			);
			await db.delete(LedgersTable).where(inArray(LedgersTable.id, [ledgerId.toUUID()]));
			await db
				.delete(OrganizationsTable)
				.where(inArray(OrganizationsTable.id, [organizationId.toUUID()]));
		} finally {
			await runtime.dispose();
		}
	});

	it("preserves created-descending list order and pagination without a tie-breaker", async () => {
		const db = database.db;
		const ids = [
			newLedgerAccountBalanceMonitorID(),
			newLedgerAccountBalanceMonitorID(),
			newLedgerAccountBalanceMonitorID(),
		];
		await db.insert(LedgerAccountBalanceMonitorsTable).values(
			ids.map((id, index) => ({
				id: id.toUUID(),
				accountId: accountIds[0].toUUID(),
				name: `Ordered ${index}`,
				created: new Date(`9999-12-31T23:5${7 + index}:00.000Z`),
			}))
		);

		const page = await runtime.runPromise(repository.listMonitors({ offset: 1, limit: 1 }));

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
		const created = await runtime.runPromise(repository.createMonitor(record));

		expect(created.description).toBe(description);
		expect(created.metadata).toEqual(metadata);
		expect(created.updated).toEqual(applicationTime);
		expect(created.created.toMillis()).toBeGreaterThan(applicationTime.toMillis());
		expect(Option.getOrUndefined(await runtime.runPromise(repository.getMonitor(record.id)))).toEqual(
			created
		);
		expect(await runtime.runPromise(repository.deleteMonitor(record.id))).toSatisfy(Option.isSome);
	});

	it("updates the existing assignments and application-supplied time", async () => {
		const original = monitor(accountIds[0], {
			description: "Before",
			metadata: { version: "before" },
		});
		await runtime.runPromise(repository.createMonitor(original));
		const updatedAt = DateTime.fromISO("2026-08-29T12:30:00.000Z", { zone: "utc" });
		const replacement = monitor(accountIds[1], {
			id: original.id,
			description: "After",
			metadata: { version: "after" },
			updated: updatedAt,
		});

		const updated = Option.getOrThrow(
			await runtime.runPromise(repository.updateMonitor(original.id, replacement))
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
		await runtime.runPromise(repository.createMonitor(original));
		const replacement = monitor(accountIds[0], { id: original.id });

		const updated = Option.getOrThrow(
			await runtime.runPromise(repository.updateMonitor(original.id, replacement))
		);

		expect(updated.description).toBe("Keep description");
		expect(updated.metadata).toEqual({ keep: "metadata" });
	});

	it("decodes persisted values independently of request defaults", async () => {
		const db = database.db;
		const id = newLedgerAccountBalanceMonitorID();
		const created = new Date("2026-08-28T09:00:00.000Z");
		await db.insert(LedgerAccountBalanceMonitorsTable).values({
			id: id.toUUID(),
			accountId: accountIds[0].toUUID(),
			name: "Stored name",
			alertThreshold: "12.3400",
			isActive: 0,
			created,
			updated: applicationTime.toJSDate(),
			metadata: JSON.stringify({ team: "treasury" }),
		});
		const found = Option.getOrThrow(await runtime.runPromise(repository.getMonitor(id)));
		expect(found).toMatchObject({
			id,
			accountId: accountIds[0],
			name: "Stored name",
			description: undefined,
			alertThreshold: 12.34,
			isActive: false,
			metadata: { team: "treasury" },
			updated: applicationTime,
		});
		expect(found.created.toJSDate()).toEqual(created);
	});

	it.each([
		// oxlint-disable-next-line unicorn/no-null -- PostgreSQL represents absent metadata as NULL.
		null,
		"not-json",
		"null",
		"[]",
		"1",
		'{"count":1}',
	])("treats invalid or absent stored metadata %s as absent", async metadata => {
		const db = database.db;
		const id = newLedgerAccountBalanceMonitorID();
		await db.insert(LedgerAccountBalanceMonitorsTable).values({
			id: id.toUUID(),
			accountId: accountIds[0].toUUID(),
			name: "Metadata fallback",
			metadata,
		});
		const found = Option.getOrThrow(await runtime.runPromise(repository.getMonitor(id)));
		expect(found.metadata).toBeUndefined();
	});

	it("returns explicit absence for missing get, update, and delete", async () => {
		const id = newLedgerAccountBalanceMonitorID();
		const replacement = monitor(accountIds[0], { id });
		const [found, updated, deleted] = await runtime.runPromise(
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
		const error = await runtime.runPromise(
			Effect.flip(repository.createMonitor(monitor(missingAccount)))
		);

		expect(error).toBeInstanceOf(LedgerAccountBalanceMonitorPersistenceFailure);
		expect(error.message).toBe("Internal Server Error");
	});

	it("maps an unrepresentable stored timestamp to the sanitized decoding error", async () => {
		const id = newLedgerAccountBalanceMonitorID();
		const db = database.db;
		await db.insert(LedgerAccountBalanceMonitorsTable).values({
			id: id.toUUID(),
			accountId: accountIds[0].toUUID(),
			name: "Malformed",
			created: sql`'infinity'::timestamptz`,
		});

		const error = await runtime.runPromise(Effect.flip(repository.getMonitor(id)));

		expect(error).toBeInstanceOf(LedgerAccountBalanceMonitorPersistenceDecodingFailure);
		expect(error.message).toBe("Internal Server Error");
	});
});
