import type { AccountingMutation } from "./LedgerTransactionRepo";
import type { MonitorJob } from "@/jobs/MonitorPublisher";
import { TypeID } from "typeid-js";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";
import { DateTime } from "luxon";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import {
	newLedgerAccountID,
	newLedgerAccountSettlementID,
	newLedgerID,
	newLedgerTransactionID,
	newOrgID,
} from "@/lib/ids";
import {
	AssetsTable,
	LedgerAccountBalanceMonitorsTable,
	LedgerAccountSettlementsTable,
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/db/schema";
import { LedgerTransaction } from "./LedgerTransaction";
import {
	type LedgerTransactionRepo,
	LedgerTransactionRepoTag,
	ledgerTransactionRepoLayer,
} from "./LedgerTransactionRepo";

describe("atomic balance monitor capture", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const runtime = ManagedRuntime.make(
		Layer.merge(databaseLayer, ledgerTransactionRepoLayer.pipe(Layer.provide(databaseLayer)))
	);
	const organizations: string[] = [];
	const jobs: MonitorJob[] = [];
	const capture = (result: AccountingMutation) => {
		jobs.push(...result.monitorJobs);
		return result.transaction;
	};
	let db: Database["db"];
	let repository: LedgerTransactionRepo;
	beforeAll(async () => {
		db = (await runtime.runPromise(DatabaseTag)).db;
		repository = await runtime.runPromise(LedgerTransactionRepoTag);
	});
	afterAll(async () => {
		if (organizations.length) {
			await db
				.delete(LedgerAccountBalanceMonitorsTable)
				.where(inArray(LedgerAccountBalanceMonitorsTable.organizationId, organizations));
			await db
				.delete(LedgerTransactionEntriesTable)
				.where(inArray(LedgerTransactionEntriesTable.organizationId, organizations));
			await db
				.delete(LedgerTransactionsTable)
				.where(inArray(LedgerTransactionsTable.organizationId, organizations));
			await db
				.delete(LedgerAccountSettlementsTable)
				.where(inArray(LedgerAccountSettlementsTable.organizationId, organizations));
			await db
				.delete(LedgerAccountsTable)
				.where(inArray(LedgerAccountsTable.organizationId, organizations));
			await db.delete(LedgersTable).where(inArray(LedgersTable.organizationId, organizations));
			await db.delete(AssetsTable).where(inArray(AssetsTable.organizationId, organizations));
			await db.delete(OrganizationsTable).where(inArray(OrganizationsTable.id, organizations));
		}
		await runtime.dispose();
	});
	const fixture = async (monitored = true) => {
		const organizationId = newOrgID();
		const ledgerId = newLedgerID();
		const assetId = new TypeID("ast");
		const debit = newLedgerAccountID();
		const credit = newLedgerAccountID();
		organizations.push(organizationId.toUUID());
		await db
			.insert(OrganizationsTable)
			.values({ id: organizationId.toUUID(), name: "Capture organization" });
		await db.insert(LedgersTable).values({
			id: ledgerId.toUUID(),
			organizationId: organizationId.toUUID(),
			name: "Capture ledger",
		});
		await db.insert(AssetsTable).values({
			id: assetId.toUUID(),
			organizationId: organizationId.toUUID(),
			code: "EUR",
			name: "Euro",
			minorUnitExponent: 2,
		});
		await db.insert(LedgerAccountsTable).values([
			{
				id: debit.toUUID(),
				organizationId: organizationId.toUUID(),
				ledgerId: ledgerId.toUUID(),
				name: "Monitored debit",
				normalBalance: "debit",
				assetId: assetId.toUUID(),
				balanceMonitorCount: monitored ? 1 : 0,
			},
			{
				id: credit.toUUID(),
				organizationId: organizationId.toUUID(),
				ledgerId: ledgerId.toUUID(),
				name: "Unmonitored credit",
				normalBalance: "credit",
				assetId: assetId.toUUID(),
			},
		]);
		const monitor = {
			id: new TypeID("lbm").toUUID(),
			organizationId: organizationId.toUUID(),
			ledgerId: ledgerId.toUUID(),
			accountId: debit.toUUID(),
			alertCondition: {
				mode: "all" as const,
				conditions: [{ balanceType: "posted" as const, operator: ">" as const, value: "0" }],
			},
			webhookUrl: "https://example.com/original",
			webhookSigningSecret: "original-ciphertext",
		};
		if (monitored) await db.insert(LedgerAccountBalanceMonitorsTable).values(monitor);
		const entries = (amount: number | string) => [
			{
				accountId: debit.toString(),
				direction: "debit" as const,
				amount: String(amount),
				assetId: assetId.toString(),
				assetCode: "EUR",
				minorUnitExponent: 2,
			},
			{
				accountId: credit.toString(),
				direction: "credit" as const,
				amount: String(amount),
				assetId: assetId.toString(),
				assetCode: "EUR",
				minorUnitExponent: 2,
			},
		];
		const create = (
			status: "pending" | "posted",
			amount: number | string = 100,
			id = newLedgerTransactionID()
		) =>
			runtime.runPromise(
				LedgerTransaction.fromCreateRequest(id, organizationId, ledgerId, {
					status,
					ledgerEntries: entries(amount),
				}).pipe(
					Effect.flatMap(transaction =>
						repository.createTransaction(transaction).pipe(Effect.map(capture))
					)
				)
			);
		const events = () => jobs.filter(job => job.organizationId === organizationId.toString());
		return { organizationId, ledgerId, assetId, debit, credit, entries, create, events, monitor };
	};

	it.each(["pending", "posted"] as const)(
		"captures one complete snapshot for a new %s transaction and excludes unmonitored accounts",
		async status => {
			const f = await fixture();
			const transaction = await f.create(status);
			const events = f.events();
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				organizationId: f.organizationId.toString(),
				ledgerId: f.ledgerId.toString(),
				accountId: f.debit.toString(),
				accountVersion: 2,
				transactionId: transaction.id.toString(),
				assetId: f.assetId.toString(),
				assetCode: "EUR",
				minorUnitExponent: 2,
				before: { posted: "0", pending: "0", availableBalance: "0" },
				after: {
					posted: status === "posted" ? "100" : "0",
					pending: "100",
					availableBalance: status === "posted" ? "100" : "0",
				},
			});
			expect(events[0]!.eventId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
			expect(new Date(events[0]!.occurredAt).toISOString()).toBe(events[0]!.occurredAt);
		}
	);

	it("captures pending replacement and posting using final balances and does not repeat idempotent posting", async () => {
		const f = await fixture();
		const transaction = await f.create("pending");
		await runtime.runPromise(
			repository
				.updateTransaction(f.organizationId, f.ledgerId, transaction.id, {
					ledgerEntries: f.entries(40),
				})
				.pipe(Effect.map(capture))
		);
		await runtime.runPromise(
			repository
				.postTransaction(f.organizationId, f.ledgerId, transaction.id, DateTime.utc())
				.pipe(Effect.map(capture))
		);
		await runtime.runPromise(
			repository
				.postTransaction(f.organizationId, f.ledgerId, transaction.id, DateTime.utc())
				.pipe(Effect.map(capture))
		);
		const events = f.events();
		expect(events).toHaveLength(3);
		expect(events[1]).toMatchObject({
			accountVersion: 3,
			before: { posted: "0", pending: "100", availableBalance: "0" },
			after: { posted: "0", pending: "40", availableBalance: "0" },
		});
		expect(events[2]).toMatchObject({
			accountVersion: 4,
			before: { posted: "0", pending: "40", availableBalance: "0" },
			after: { posted: "40", pending: "40", availableBalance: "40" },
		});
		expect(events.every(event => event.transactionId === transaction.id.toString())).toBe(true);
	});

	it("captures voiding and does not repeat an idempotent void", async () => {
		const f = await fixture();
		const transaction = await f.create("pending");
		await runtime.runPromise(
			repository
				.voidTransaction(f.organizationId, f.ledgerId, transaction.id, DateTime.utc())
				.pipe(Effect.map(capture))
		);
		await runtime.runPromise(
			repository
				.voidTransaction(f.organizationId, f.ledgerId, transaction.id, DateTime.utc())
				.pipe(Effect.map(capture))
		);
		const events = f.events();
		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({
			accountVersion: 3,
			before: { posted: "0", pending: "100", availableBalance: "0" },
			after: { posted: "0", pending: "0", availableBalance: "0" },
		});
	});

	it("aggregates multiple entries into one snapshot and omits an unchanged replacement", async () => {
		const f = await fixture();
		const transaction = await runtime.runPromise(
			LedgerTransaction.fromCreateRequest(newLedgerTransactionID(), f.organizationId, f.ledgerId, {
				status: "pending",
				ledgerEntries: [{ ...f.entries(60)[0]! }, { ...f.entries(40)[0]! }, { ...f.entries(100)[1]! }],
			}).pipe(Effect.flatMap(value => repository.createTransaction(value).pipe(Effect.map(capture))))
		);
		expect(f.events()).toHaveLength(1);
		expect(f.events()[0]!.after.pending).toBe("100");
		await runtime.runPromise(
			repository
				.updateTransaction(f.organizationId, f.ledgerId, transaction.id, {
					ledgerEntries: f.entries(100),
					description: "Equivalent entries",
				})
				.pipe(Effect.map(capture))
		);
		expect(f.events()).toHaveLength(1);
	});

	it("omits jobs when no accounts have monitors", async () => {
		const f = await fixture(false);
		await f.create("posted");
		expect(f.events()).toHaveLength(0);
	});

	it.each(["posted", "voided"] as const)(
		"captures generated settlement accounting through %s",
		async target => {
			const f = await fixture();
			const settlementId = newLedgerAccountSettlementID();
			await db.insert(LedgerAccountSettlementsTable).values({
				id: settlementId.toUUID(),
				organizationId: f.organizationId.toUUID(),
				ledgerId: f.ledgerId.toUUID(),
				settledAccountId: f.debit.toUUID(),
				contraAccountId: f.credit.toUUID(),
				assetId: f.assetId.toUUID(),
				status: "processing",
				targetStatus: "pending",
			});
			const ordinary = Effect.runSync(
				LedgerTransaction.fromCreateRequest(newLedgerTransactionID(), f.organizationId, f.ledgerId, {
					status: "pending",
					ledgerEntries: f.entries(100),
				})
			);
			const generated = Effect.runSync(LedgerTransaction.create({ ...ordinary, settlementId }));
			await runtime.runPromise(
				repository.createSettlementTransaction(generated).pipe(Effect.map(capture))
			);
			await db
				.update(LedgerAccountSettlementsTable)
				.set({ targetStatus: target })
				.where(eq(LedgerAccountSettlementsTable.id, settlementId.toUUID()));
			await runtime.runPromise(
				target === "posted"
					? repository
							.postSettlementTransaction(f.organizationId, f.ledgerId, settlementId, DateTime.utc())
							.pipe(Effect.map(capture))
					: repository
							.voidSettlementTransaction(f.organizationId, f.ledgerId, settlementId, DateTime.utc())
							.pipe(Effect.map(capture))
			);
			const events = f.events();
			expect(events).toHaveLength(2);
			expect(events[0]).toMatchObject({
				transactionId: generated.id.toString(),
				before: { posted: "0", pending: "0", availableBalance: "0" },
				after: { posted: "0", pending: "100", availableBalance: "0" },
			});
			expect(events[1]).toMatchObject({
				transactionId: generated.id.toString(),
				before: { posted: "0", pending: "100", availableBalance: "0" },
				after: {
					posted: target === "posted" ? "100" : "0",
					pending: target === "posted" ? "100" : "0",
					availableBalance: target === "posted" ? "100" : "0",
				},
			});
		}
	);

	it.each([true, false])(
		"uses the monitor count committed while the balance update waits (enabled=%s)",
		async enabled => {
			const f = await fixture(!enabled);
			const client = new Client({ connectionString: new Config().databaseUrl });
			await client.connect();
			let pending: ReturnType<typeof f.create> | undefined;
			try {
				await client.query("BEGIN");
				const backend = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
				await client.query("UPDATE ledger_accounts SET balance_monitor_count = $1 WHERE id = $2", [
					enabled ? 1 : 0,
					f.debit.toUUID(),
				]);
				if (enabled)
					await client.query(
						"INSERT INTO ledger_account_balance_monitors (id, organization_id, ledger_id, account_id, alert_condition, webhook_url, webhook_signing_secret) VALUES ($1,$2,$3,$4,$5,$6,$7)",
						[
							f.monitor.id,
							f.monitor.organizationId,
							f.monitor.ledgerId,
							f.monitor.accountId,
							f.monitor.alertCondition,
							f.monitor.webhookUrl,
							f.monitor.webhookSigningSecret,
						]
					);
				else
					await client.query("DELETE FROM ledger_account_balance_monitors WHERE id = $1", [
						f.monitor.id,
					]);
				pending = f.create("pending");
				await vi.waitFor(
					async () => {
						const blocked = await client.query<{ blocked: boolean }>(
							"SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
							[backend.rows[0]!.pid]
						);
						expect(blocked.rows[0]!.blocked).toBe(true);
					},
					{ timeout: 3000, interval: 10 }
				);
				await client.query("COMMIT");
				await pending;
				expect(f.events()).toHaveLength(enabled ? 1 : 0);
			} finally {
				await client.query("ROLLBACK");
				await client.end();
				if (pending) await pending;
			}
		}
	);

	it("returns no additional jobs when accounting fails", async () => {
		const f = await fixture();
		const original = await f.create("posted");
		await expect(f.create("posted", 100, original.id)).rejects.toMatchObject({ statusCode: 500 });
		expect(f.events()).toHaveLength(1);
		const [account] = await db
			.select()
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.id, f.debit.toUUID()));
		expect(account!.postedAmount).toBe(100n);
	});
	it("keeps captured configuration after a monitor is edited and deleted", async () => {
		const f = await fixture();
		await f.create("posted");
		await db
			.update(LedgerAccountBalanceMonitorsTable)
			.set({
				webhookUrl: "https://example.com/new",
				webhookSigningSecret: "new-ciphertext",
				lockVersion: 2,
			})
			.where(eq(LedgerAccountBalanceMonitorsTable.id, f.monitor.id));
		await db
			.delete(LedgerAccountBalanceMonitorsTable)
			.where(eq(LedgerAccountBalanceMonitorsTable.id, f.monitor.id));
		expect(f.events()[0]).toMatchObject({
			monitorVersion: 1,
			webhookUrl: f.monitor.webhookUrl,
			webhookSigningSecret: f.monitor.webhookSigningSecret,
		});
	});
	it("captures exact large amounts and retains Asset details after renaming", async () => {
		const f = await fixture();
		await f.create("posted", "9007199254740993");
		await db
			.update(AssetsTable)
			.set({ code: "RENAMED" })
			.where(eq(AssetsTable.id, f.assetId.toUUID()));
		expect(f.events()[0]).toMatchObject({
			assetId: f.assetId.toString(),
			assetCode: "EUR",
			minorUnitExponent: 2,
			after: {
				posted: "9007199254740993",
				pending: "9007199254740993",
				availableBalance: "9007199254740993",
			},
		});
	});
	it("does not capture or persist accounting when final int64 projections overflow", async () => {
		const f = await fixture();
		await f.create("posted", "9223372036854775807");
		await expect(f.create("posted", "1")).rejects.toMatchObject({ statusCode: 409 });
		expect(f.events()).toHaveLength(1);
		const [account] = await db
			.select()
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.id, f.debit.toUUID()));
		expect(account!.postedAmount).toBe(9223372036854775807n);
	});
});
