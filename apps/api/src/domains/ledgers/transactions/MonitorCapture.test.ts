import { asc, eq, inArray } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";
import { DateTime } from "luxon";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive, postgresErrorCode } from "@/db";
import {
	newLedgerAccountID,
	newLedgerAccountSettlementID,
	newLedgerID,
	newLedgerTransactionID,
	newOrgID,
} from "@/repo/entities/types";
import {
	BalanceMonitorOutboxTable,
	LedgerAccountSettlementsTable,
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/repo/schema";
import { LedgerTransaction } from "./LedgerTransaction";
import {
	type LedgerTransactionRepo,
	LedgerTransactionRepoTag,
	ledgerTransactionRepoLayer,
} from "./LedgerTransactionRepo";
import { TransactionPersistenceFailure } from "./LedgerTransactionErrors";

describe("atomic balance monitor capture", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const runtime = ManagedRuntime.make(
		Layer.merge(databaseLayer, ledgerTransactionRepoLayer.pipe(Layer.provide(databaseLayer)))
	);
	const organizations: string[] = [];
	let db: Database["db"];
	let repository: LedgerTransactionRepo;
	beforeAll(async () => {
		db = (await runtime.runPromise(DatabaseTag)).db;
		repository = await runtime.runPromise(LedgerTransactionRepoTag);
	});
	afterAll(async () => {
		if (organizations.length) {
			await db
				.delete(BalanceMonitorOutboxTable)
				.where(inArray(BalanceMonitorOutboxTable.organizationId, organizations));
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
			await db.delete(OrganizationsTable).where(inArray(OrganizationsTable.id, organizations));
		}
		await runtime.dispose();
	});
	const fixture = async (monitored = true) => {
		const organizationId = newOrgID();
		const ledgerId = newLedgerID();
		const debit = newLedgerAccountID();
		const credit = newLedgerAccountID();
		organizations.push(organizationId.toString());
		await db
			.insert(OrganizationsTable)
			.values({ id: organizationId.toString(), name: "Capture organization" });
		await db.insert(LedgersTable).values({
			id: ledgerId.toString(),
			organizationId: organizationId.toString(),
			name: "Capture ledger",
		});
		await db.insert(LedgerAccountsTable).values([
			{
				id: debit.toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				name: "Monitored debit",
				normalBalance: "debit",
				currencyCode: "EUR",
				balanceMonitorCount: monitored ? 1 : 0,
			},
			{
				id: credit.toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				name: "Unmonitored credit",
				normalBalance: "credit",
				currencyCode: "EUR",
			},
		]);
		const entries = (amount: number) => [
			{ accountId: debit.toString(), direction: "debit" as const, amount, currencyCode: "EUR" },
			{ accountId: credit.toString(), direction: "credit" as const, amount, currencyCode: "EUR" },
		];
		const create = (status: "pending" | "posted", amount = 100, id = newLedgerTransactionID()) =>
			runtime.runPromise(
				LedgerTransaction.fromCreateRequest(id, organizationId, ledgerId, {
					status,
					ledgerEntries: entries(amount),
				}).pipe(Effect.flatMap(transaction => repository.createTransaction(transaction)))
			);
		const events = () =>
			db
				.select()
				.from(BalanceMonitorOutboxTable)
				.where(eq(BalanceMonitorOutboxTable.organizationId, organizationId.toString()))
				.orderBy(asc(BalanceMonitorOutboxTable.accountVersion));
		return { organizationId, ledgerId, debit, credit, entries, create, events };
	};

	it.each(["pending", "posted"] as const)(
		"captures one complete snapshot for a new %s transaction and excludes unmonitored accounts",
		async status => {
			const f = await fixture();
			const transaction = await f.create(status);
			const events = await f.events();
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				organizationId: f.organizationId.toString(),
				ledgerId: f.ledgerId.toString(),
				accountId: f.debit.toString(),
				accountVersion: 2,
				transactionId: transaction.id.toString(),
				currencyCode: "EUR",
				before: { posted: 0, pending: 0, availableBalance: 0 },
				after: {
					posted: status === "posted" ? 100 : 0,
					pending: 100,
					availableBalance: status === "posted" ? 100 : 0,
				},
			});
			expect(events[0]!.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
			expect(events[0]!.occurredAt).toBeInstanceOf(Date);
		}
	);

	it("captures pending replacement and posting using final balances and does not repeat idempotent posting", async () => {
		const f = await fixture();
		const transaction = await f.create("pending");
		await runtime.runPromise(
			repository.updateTransaction(f.organizationId, f.ledgerId, transaction.id, {
				ledgerEntries: f.entries(40),
			})
		);
		await runtime.runPromise(
			repository.postTransaction(f.organizationId, f.ledgerId, transaction.id, DateTime.utc())
		);
		await runtime.runPromise(
			repository.postTransaction(f.organizationId, f.ledgerId, transaction.id, DateTime.utc())
		);
		const events = await f.events();
		expect(events).toHaveLength(3);
		expect(events[1]).toMatchObject({
			accountVersion: 3,
			before: { posted: 0, pending: 100, availableBalance: 0 },
			after: { posted: 0, pending: 40, availableBalance: 0 },
		});
		expect(events[2]).toMatchObject({
			accountVersion: 4,
			before: { posted: 0, pending: 40, availableBalance: 0 },
			after: { posted: 40, pending: 40, availableBalance: 40 },
		});
		expect(events.every(event => event.transactionId === transaction.id.toString())).toBe(true);
	});

	it("captures voiding and does not repeat an idempotent void", async () => {
		const f = await fixture();
		const transaction = await f.create("pending");
		await runtime.runPromise(
			repository.voidTransaction(f.organizationId, f.ledgerId, transaction.id, DateTime.utc())
		);
		await runtime.runPromise(
			repository.voidTransaction(f.organizationId, f.ledgerId, transaction.id, DateTime.utc())
		);
		const events = await f.events();
		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({
			accountVersion: 3,
			before: { posted: 0, pending: 100, availableBalance: 0 },
			after: { posted: 0, pending: 0, availableBalance: 0 },
		});
	});

	it("aggregates multiple entries into one snapshot and omits an unchanged replacement", async () => {
		const f = await fixture();
		const transaction = await runtime.runPromise(
			LedgerTransaction.fromCreateRequest(newLedgerTransactionID(), f.organizationId, f.ledgerId, {
				status: "pending",
				ledgerEntries: [{ ...f.entries(60)[0]! }, { ...f.entries(40)[0]! }, { ...f.entries(100)[1]! }],
			}).pipe(Effect.flatMap(value => repository.createTransaction(value)))
		);
		expect(await f.events()).toHaveLength(1);
		expect((await f.events())[0]!.after.pending).toBe(100);
		await runtime.runPromise(
			repository.updateTransaction(f.organizationId, f.ledgerId, transaction.id, {
				ledgerEntries: f.entries(100),
				description: "Equivalent entries",
			})
		);
		expect(await f.events()).toHaveLength(1);
	});

	it("omits outbox writes when no accounts have monitors", async () => {
		const f = await fixture(false);
		await f.create("posted");
		expect(await f.events()).toHaveLength(0);
	});

	it.each(["posted", "voided"] as const)(
		"captures generated settlement accounting through %s",
		async target => {
			const f = await fixture();
			const settlementId = newLedgerAccountSettlementID();
			await db.insert(LedgerAccountSettlementsTable).values({
				id: settlementId.toString(),
				organizationId: f.organizationId.toString(),
				ledgerId: f.ledgerId.toString(),
				settledAccountId: f.debit.toString(),
				contraAccountId: f.credit.toString(),
				currency: "EUR",
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
			await runtime.runPromise(repository.createSettlementTransaction(generated));
			await db
				.update(LedgerAccountSettlementsTable)
				.set({ targetStatus: target })
				.where(eq(LedgerAccountSettlementsTable.id, settlementId.toString()));
			await runtime.runPromise(
				target === "posted"
					? repository.postSettlementTransaction(
							f.organizationId,
							f.ledgerId,
							settlementId,
							DateTime.utc()
						)
					: repository.voidSettlementTransaction(
							f.organizationId,
							f.ledgerId,
							settlementId,
							DateTime.utc()
						)
			);
			const events = await f.events();
			expect(events).toHaveLength(2);
			expect(events[0]).toMatchObject({
				transactionId: generated.id.toString(),
				before: { posted: 0, pending: 0, availableBalance: 0 },
				after: { posted: 0, pending: 100, availableBalance: 0 },
			});
			expect(events[1]).toMatchObject({
				transactionId: generated.id.toString(),
				before: { posted: 0, pending: 100, availableBalance: 0 },
				after: {
					posted: target === "posted" ? 100 : 0,
					pending: target === "posted" ? 100 : 0,
					availableBalance: target === "posted" ? 100 : 0,
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
					f.debit.toString(),
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
				expect(await f.events()).toHaveLength(enabled ? 1 : 0);
			} finally {
				await client.query("ROLLBACK");
				await client.end();
				if (pending) await pending;
			}
		}
	);

	it("rolls back accounting and capture together if the outbox insert fails", async () => {
		const f = await fixture();
		await db
			.update(LedgerAccountsTable)
			.set({ balanceMonitorCount: 1 })
			.where(eq(LedgerAccountsTable.id, f.credit.toString()));
		const transactionId = newLedgerTransactionID();
		const existingId = crypto.randomUUID();
		await db.insert(BalanceMonitorOutboxTable).values({
			id: existingId,
			organizationId: f.organizationId.toString(),
			ledgerId: f.ledgerId.toString(),
			accountId: f.credit.toString(),
			accountVersion: 2,
			transactionId: newLedgerTransactionID().toString(),
			currencyCode: "EUR",
			occurredAt: new Date(),
			before: { posted: 0, pending: 0, availableBalance: 0 },
			after: { posted: 0, pending: 1, availableBalance: 0 },
		});
		const failure: unknown = await f
			.create("posted", 100, transactionId)
			.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(TransactionPersistenceFailure);
		expect(postgresErrorCode(failure)).toBe("23505");
		expect(
			await db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, transactionId.toString()))
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, transactionId.toString()))
		).toHaveLength(0);
		const accounts = await db
			.select()
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.organizationId, f.organizationId.toString()));
		for (const account of accounts)
			expect(account).toMatchObject({
				lockVersion: 1,
				postedAmount: 0,
				pendingAmount: 0,
				availableAmount: 0,
			});
		expect((await f.events()).map(event => event.id)).toEqual([existingId]);
	});
});
