import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import {
	newLedgerAccountID,
	newLedgerID,
	newLedgerTransactionEntryID,
	newLedgerTransactionID,
	newOrgID,
	type LedgerID,
	type OrgID,
} from "@/repo/entities/types";
import * as schema from "@/repo/schema";
import {
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	LedgersTable,
	OrganizationsTable,
} from "@/repo/schema";

import {
	type TransactionRepo,
	TransactionRepoLive,
	TransactionRepoTag,
	transactionRepoLayer,
} from "./TransactionRepo";
import {
	TransactionPersistenceDecodingFailure,
	TransactionPersistenceFailure,
	TransactionRepositoryUnavailable,
} from "./TransactionErrors";

describe("TransactionRepoLive reads", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const reposLayer = transactionRepoLayer.pipe(Layer.provideMerge(databaseLayer));
	const runtime: ManagedRuntime.ManagedRuntime<Database | TransactionRepo, never> =
		ManagedRuntime.make(reposLayer);
	const organizationIds = new Set<OrgID>();

	const runRepo = <A, E>(use: (repository: TransactionRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(TransactionRepoTag.pipe(Effect.flatMap(use)));
	const database = () => runtime.runPromise(DatabaseTag);

	const createLedger = async (organizationId?: OrgID) => {
		const db = (await database()).db;
		const ownerId = organizationId ?? newOrgID();
		const ledgerId = newLedgerID();
		organizationIds.add(ownerId);
		await db
			.insert(OrganizationsTable)
			.values({ id: ownerId.toString(), name: `Transaction test ${ownerId.toString()}` })
			.onConflictDoNothing();
		await db.insert(LedgersTable).values({
			id: ledgerId.toString(),
			organizationId: ownerId.toString(),
			name: `Ledger ${ledgerId.toString()}`,
		});
		return { organizationId: ownerId, ledgerId };
	};

	const createTransaction = async (
		organizationId: OrgID,
		ledgerId: LedgerID,
		overrides: {
			readonly idempotencyKey?: string;
			readonly created?: Date;
			readonly status?: "pending" | "posted" | "voided";
			readonly description?: string;
		} = {}
	) => {
		const db = (await database()).db;
		const transactionId = newLedgerTransactionID();
		const debitAccountId = newLedgerAccountID();
		const creditAccountId = newLedgerAccountID();
		const created = overrides.created ?? new Date("2026-08-15T10:00:00.000Z");
		const status = overrides.status ?? "pending";
		await db.insert(LedgerAccountsTable).values([
			{
				id: debitAccountId.toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				name: `Debit ${debitAccountId.toString()}`,
				normalBalance: "debit",
				currencyCode: "EUR",
				minorUnitExponent: 2,
			},
			{
				id: creditAccountId.toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				name: `Credit ${creditAccountId.toString()}`,
				normalBalance: "credit",
				currencyCode: "EUR",
				minorUnitExponent: 2,
			},
		]);
		await db.insert(LedgerTransactionsTable).values({
			id: transactionId.toString(),
			organizationId: organizationId.toString(),
			ledgerId: ledgerId.toString(),
			idempotencyKey: overrides.idempotencyKey,
			description: overrides.description,
			status,
			postedAt: status === "posted" ? created : undefined,
			metadata: JSON.stringify({ source: "repository-test" }),
			created,
			updated: created,
		});
		await db.insert(LedgerTransactionEntriesTable).values([
			{
				id: newLedgerTransactionEntryID().toString(),
				transactionId: transactionId.toString(),
				accountId: debitAccountId.toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				direction: "debit",
				amount: 125,
				metadata: JSON.stringify({ side: "asset" }),
				created,
			},
			{
				id: newLedgerTransactionEntryID().toString(),
				transactionId: transactionId.toString(),
				accountId: creditAccountId.toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				direction: "credit",
				amount: 125,
				created,
			},
		]);
		return transactionId;
	};

	afterAll(async () => {
		try {
			const db = (await database()).db;
			for (const organizationId of organizationIds) {
				await db
					.delete(LedgerTransactionEntriesTable)
					.where(eq(LedgerTransactionEntriesTable.organizationId, organizationId.toString()));
				await db
					.delete(LedgerTransactionsTable)
					.where(eq(LedgerTransactionsTable.organizationId, organizationId.toString()));
				await db
					.delete(LedgerAccountsTable)
					.where(eq(LedgerAccountsTable.organizationId, organizationId.toString()));
				await db.delete(LedgersTable).where(eq(LedgersTable.organizationId, organizationId.toString()));
				await db.delete(OrganizationsTable).where(eq(OrganizationsTable.id, organizationId.toString()));
			}
		} finally {
			await runtime.dispose();
		}
	});

	it("loads complete Transactions and derives Entry Currency from Accounts", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const transactionId = await createTransaction(organizationId, ledgerId, {
			status: "posted",
			description: "Hydrated",
		});

		const found = Option.getOrThrow(
			await runRepo(repository => repository.getTransaction(organizationId, ledgerId, transactionId))
		);

		expect(found).toMatchObject({ status: "posted", description: "Hydrated" });
		expect(found.entries).toHaveLength(2);
		expect(found.entries.map(entry => entry.currency)).toEqual([
			{ code: "EUR", minorUnitExponent: 2 },
			{ code: "EUR", minorUnitExponent: 2 },
		]);
		expect(found.metadata).toEqual({ source: "repository-test" });
		expect(found.entries.find(entry => entry.direction === "debit")?.metadata).toEqual({
			side: "asset",
		});
		expect(DateTime.isDateTime(found.created)).toBe(true);
		expect(DateTime.isDateTime(found.updated)).toBe(true);
		expect(DateTime.isDateTime(found.postedAt)).toBe(true);
	});

	it("lists in stable created DESC, id DESC order and paginates in PostgreSQL", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const older = await createTransaction(organizationId, ledgerId, {
			created: new Date("2026-08-15T09:00:00.000Z"),
		});
		const tied = await Promise.all([
			createTransaction(organizationId, ledgerId),
			createTransaction(organizationId, ledgerId),
		]);
		const tiedDescending = tied
			.map(id => id.toString())
			.sort()
			.reverse();

		const all = await runRepo(repository =>
			repository.listTransactions(organizationId, ledgerId, { offset: 0, limit: 100 })
		);
		expect(all.map(transaction => transaction.id.toString())).toEqual([
			...tiedDescending,
			older.toString(),
		]);
		const page = await runRepo(repository =>
			repository.listTransactions(organizationId, ledgerId, { offset: 1, limit: 1 })
		);
		expect(page.map(transaction => transaction.id.toString())).toEqual(tiedDescending.slice(1));
		const lowerBounded = await runRepo(repository =>
			repository.listTransactions(organizationId, ledgerId, { offset: -1, limit: 0 })
		);
		expect(lowerBounded.map(transaction => transaction.id.toString())).toEqual([tiedDescending[0]]);
	});

	it("looks up the first Transaction by Organization-scoped idempotency key", async () => {
		const first = await createLedger();
		const second = await createLedger();
		const key = `repo-${newLedgerTransactionID().toString()}`;
		const expected = await createTransaction(first.organizationId, first.ledgerId, {
			idempotencyKey: key,
		});
		await createTransaction(second.organizationId, second.ledgerId, { idempotencyKey: key });

		const found = await runRepo(repository =>
			repository.getTransactionByIdempotencyKey(first.organizationId, key)
		);
		expect(Option.getOrThrow(found).id.toString()).toBe(expected.toString());
	});

	it.each(["missing", "cross-Organization", "cross-Ledger"] as const)(
		"returns the same explicit absence for %s get",
		async scenario => {
			const owner = await createLedger();
			const transactionId = await createTransaction(owner.organizationId, owner.ledgerId);
			const other = await createLedger();
			const organizationId =
				scenario === "cross-Organization" ? other.organizationId : owner.organizationId;
			const ledgerId = scenario === "cross-Ledger" ? other.ledgerId : owner.ledgerId;
			const id = scenario === "missing" ? newLedgerTransactionID() : transactionId;

			expect(
				await runRepo(repository => repository.getTransaction(organizationId, ledgerId, id))
			).toEqual(Option.none());
		}
	);

	it("isolates list and idempotency lookup by Organization and Ledger", async () => {
		const owner = await createLedger();
		const otherLedger = await createLedger(owner.organizationId);
		const otherOrganization = await createLedger();
		const key = `isolated-${newLedgerTransactionID().toString()}`;
		const owned = await createTransaction(owner.organizationId, owner.ledgerId, {
			idempotencyKey: key,
		});
		await createTransaction(owner.organizationId, otherLedger.ledgerId);
		await createTransaction(otherOrganization.organizationId, otherOrganization.ledgerId, {
			idempotencyKey: key,
		});

		const listed = await runRepo(repository =>
			repository.listTransactions(owner.organizationId, owner.ledgerId, { offset: 0, limit: 100 })
		);
		expect(listed.map(transaction => transaction.id.toString())).toEqual([owned.toString()]);
		expect(
			await runRepo(repository => repository.getTransactionByIdempotencyKey(newOrgID(), key))
		).toEqual(Option.none());
	});

	it("returns a typed decoding failure for malformed persisted data", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const db = (await database()).db;
		const invalidId = "not-a-transaction-id";
		const accountIds = [newLedgerAccountID(), newLedgerAccountID()];
		await db.insert(LedgerAccountsTable).values(
			accountIds.map((id, index) => ({
				id: id.toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				name: `Malformed ${index} ${id.toString()}`,
				normalBalance: "debit" as const,
				currencyCode: "USD",
				minorUnitExponent: 2,
			}))
		);
		await db.insert(LedgerTransactionsTable).values({
			id: invalidId,
			organizationId: organizationId.toString(),
			ledgerId: ledgerId.toString(),
			status: "pending",
		});
		await db.insert(LedgerTransactionEntriesTable).values(
			accountIds.map((accountId, index) => ({
				id: newLedgerTransactionEntryID().toString(),
				transactionId: invalidId,
				accountId: accountId.toString(),
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				direction: index === 0 ? ("debit" as const) : ("credit" as const),
				amount: 1,
			}))
		);

		const error = await runRepo(repository =>
			Effect.flip(
				repository.getTransaction(
					organizationId,
					ledgerId,
					invalidId as unknown as ReturnType<typeof newLedgerTransactionID>
				)
			)
		);
		expect(error).toBeInstanceOf(TransactionPersistenceDecodingFailure);
	});

	it("classifies PostgreSQL availability failures", async () => {
		const unavailableLayer = transactionRepoLayer.pipe(
			Layer.provide(makeDatabaseLive("postgresql://postgres:postgres@127.0.0.1:1/exchequer"))
		);
		const unavailableRuntime = ManagedRuntime.make(unavailableLayer);
		try {
			const error = await unavailableRuntime.runPromise(
				TransactionRepoTag.pipe(
					Effect.flatMap(repository =>
						Effect.flip(
							repository.listTransactions(newOrgID(), newLedgerID(), {
								offset: 0,
								limit: 1,
							})
						)
					)
				)
			);
			expect(error).toBeInstanceOf(TransactionRepositoryUnavailable);
		} finally {
			await unavailableRuntime.dispose();
		}
	});

	it("classifies unexpected persistence failures", async () => {
		const pool = new Pool({ connectionString: new Config().databaseUrl });
		const db = drizzle(pool, { schema });
		await pool.end();
		const repository = new TransactionRepoLive(db);

		const error = await Effect.runPromise(
			Effect.flip(repository.listTransactions(newOrgID(), newLedgerID(), { offset: 0, limit: 1 }))
		);
		expect(error).toBeInstanceOf(TransactionPersistenceFailure);
	});
});
