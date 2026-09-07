import { eq, inArray } from "drizzle-orm";
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
} from "@/repo/entities/types";
import {
	BalanceMonitorRevisionsTable,
	LedgerAccountBalanceMonitorsTable,
	LedgerAccountsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/repo/schema";

import { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
import { LedgerAccountBalanceMonitorPersistenceDecodingFailure } from "./LedgerAccountBalanceMonitorErrors";
import {
	type LedgerAccountBalanceMonitorRepo,
	LedgerAccountBalanceMonitorRepoTag,
	ledgerAccountBalanceMonitorRepoLayer,
} from "./LedgerAccountBalanceMonitorRepo";

const applicationTime = DateTime.fromISO("2026-08-29T10:15:30.000Z", { zone: "utc" });

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
			const db = database.db;
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

	const scope = {
		organizationId: organizationId.toString(),
		ledgerId: ledgerId.toString(),
		accountId: accountIds[0].toString(),
	};
	const request = {
		alertCondition: {
			mode: "all" as const,
			conditions: [{ balanceType: "posted" as const, operator: "<" as const, value: 100 }],
		},
		webhook: { url: "https://example.com/hook", bearerToken: "secret" },
	};
	const make = () =>
		Effect.runSync(
			LedgerAccountBalanceMonitor.fromRequest(
				newLedgerAccountBalanceMonitorID(),
				scope,
				request,
				applicationTime,
				"ciphertext"
			)
		);
	it("creates a baseline and versions edits and deletion without changing Account balances or version", async () => {
		const original = make();
		const before = (
			await database.db
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, scope.accountId))
		)[0];
		const created = await runtime.runPromise(repository.createMonitor(original));
		expect(created.toResponse()).toMatchObject({
			lockVersion: 1,
			alertCondition: request.alertCondition,
		});
		let account = (
			await database.db
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, scope.accountId))
		)[0];
		expect(account).toEqual({ ...before, balanceMonitorCount: before.balanceMonitorCount + 1 });
		await database.db
			.update(LedgerAccountsTable)
			.set({ lockVersion: before.lockVersion + 2 })
			.where(eq(LedgerAccountsTable.id, scope.accountId));
		const updated = Option.getOrThrow(
			await runtime.runPromise(
				repository.updateMonitor(
					scope,
					created.id,
					{ webhookUrl: "https://example.com/changed" },
					applicationTime.plus({ hours: 1 }).toJSDate()
				)
			)
		);
		expect(updated.row).toMatchObject({
			lockVersion: 2,
			webhookToken: "ciphertext",
			created: created.row.created,
		});
		const versions = await database.db
			.select()
			.from(BalanceMonitorRevisionsTable)
			.where(eq(BalanceMonitorRevisionsTable.monitorId, created.row.id))
			.orderBy(BalanceMonitorRevisionsTable.version);
		expect(versions).toMatchObject([
			{
				version: 1,
				startVersion: before.lockVersion,
				endVersion: before.lockVersion + 2,
				configuration: { webhookUrl: request.webhook.url },
			},
			{
				version: 2,
				startVersion: before.lockVersion + 2,
				// oxlint-disable-next-line unicorn/no-null -- PostgreSQL nullable columns use null.
				endVersion: null,
				configuration: { webhookUrl: "https://example.com/changed" },
			},
		]);
		await runtime.runPromise(
			repository.deleteMonitor(scope, created.id, applicationTime.plus({ hours: 2 }).toJSDate())
		);
		expect(Option.isNone(await runtime.runPromise(repository.getMonitor(scope, created.id)))).toBe(
			true
		);
		account = (
			await database.db
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, scope.accountId))
		)[0];
		expect(account.balanceMonitorCount).toBe(before.balanceMonitorCount);
		expect(account.lockVersion).toBe(before.lockVersion + 2);
		const deletedVersions = await database.db
			.select()
			.from(BalanceMonitorRevisionsTable)
			.where(eq(BalanceMonitorRevisionsTable.monitorId, created.row.id));
		expect(deletedVersions.every(revision => revision.endVersion === before.lockVersion + 2)).toBe(
			true
		);
	});
	it("isolates Organization, Ledger and Account reads and mutations", async () => {
		const record = await runtime.runPromise(repository.createMonitor(make()));
		const otherAccount = { ...scope, accountId: accountIds[1].toString() };
		expect(
			await runtime.runPromise(repository.listMonitors(otherAccount, { offset: 0, limit: 20 }))
		).toEqual([]);
		expect(
			Option.isNone(await runtime.runPromise(repository.getMonitor(otherAccount, record.id)))
		).toBe(true);
		expect(
			Option.isNone(
				await runtime.runPromise(
					repository.updateMonitor(otherAccount, record.id, { description: "wrong" }, new Date())
				)
			)
		).toBe(true);
		expect(
			Option.isNone(
				await runtime.runPromise(repository.deleteMonitor(otherAccount, record.id, new Date()))
			)
		).toBe(true);
		for (const invalid of [
			{ ...scope, organizationId: newOrgID().toString() },
			{ ...scope, ledgerId: newLedgerID().toString() },
		]) {
			expect(
				await runtime.runPromise(Effect.flip(repository.getMonitor(invalid, record.id)))
			).toMatchObject({ statusCode: 404 });
			expect(
				await runtime.runPromise(
					Effect.flip(repository.listMonitors(invalid, { offset: 0, limit: 20 }))
				)
			).toMatchObject({ statusCode: 404 });
		}
	});
	it("serializes concurrent edits into complete revisions and deletes only once", async () => {
		const record = await runtime.runPromise(repository.createMonitor(make()));
		const edits = await Promise.all(
			["first", "second"].map(description =>
				runtime.runPromise(repository.updateMonitor(scope, record.id, { description }, new Date()))
			)
		);
		expect(edits.map(edit => Option.getOrThrow(edit).row.lockVersion).sort()).toEqual([2, 3]);
		const deleted = await Promise.all(
			[1, 2].map(() => runtime.runPromise(repository.deleteMonitor(scope, record.id, new Date())))
		);
		expect(deleted.filter(value => Option.isSome(value))).toHaveLength(1);
	});
	it("preserves created-descending pagination", async () => {
		const rows = [0, 1, 2].map(index => ({ ...make().row, created: new Date(999999999000 + index) }));
		await database.db.insert(LedgerAccountBalanceMonitorsTable).values(rows);
		const all = await runtime.runPromise(repository.listMonitors(scope, { offset: 0, limit: 100 }));
		const page = await runtime.runPromise(repository.listMonitors(scope, { offset: 1, limit: 1 }));
		expect(page[0].row.id).toBe(all[1].row.id);
	});
	it("returns explicit absence for missing monitors", async () => {
		const id = newLedgerAccountBalanceMonitorID();
		expect(Option.isNone(await runtime.runPromise(repository.getMonitor(scope, id)))).toBe(true);
		expect(
			Option.isNone(await runtime.runPromise(repository.updateMonitor(scope, id, {}, new Date())))
		).toBe(true);
		expect(
			Option.isNone(await runtime.runPromise(repository.deleteMonitor(scope, id, new Date())))
		).toBe(true);
	});
	it("rolls back duplicate creates without changing the count or revisions", async () => {
		const record = await runtime.runPromise(repository.createMonitor(make()));
		const before = (
			await database.db
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, scope.accountId))
		)[0];
		const error = await runtime.runPromise(Effect.flip(repository.createMonitor(record)));
		expect(error).toMatchObject({ statusCode: 500, message: "Internal Server Error" });
		const after = (
			await database.db
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, scope.accountId))
		)[0];
		expect(after).toEqual(before);
		const versions = await database.db
			.select()
			.from(BalanceMonitorRevisionsTable)
			.where(eq(BalanceMonitorRevisionsTable.monitorId, record.row.id));
		expect(versions).toHaveLength(1);
	});
	it("maps malformed stored IDs to sanitized decoding failures", async () => {
		const row = { ...make().row, id: "invalid" };
		await database.db.insert(LedgerAccountBalanceMonitorsTable).values(row);
		const error = await runtime.runPromise(
			Effect.flip(repository.getMonitor(scope, row.id as unknown as LedgerAccountBalanceMonitorID))
		);
		expect(error).toBeInstanceOf(LedgerAccountBalanceMonitorPersistenceDecodingFailure);
		expect(error.message).toBe("Internal Server Error");
	});
});
