import { setTimeout as delay } from "node:timers/promises";

import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer, ManagedRuntime, Option, type Result } from "effect";
import { DateTime } from "luxon";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { type Database, DatabaseTag, type DrizzleDatabase, makeDatabaseLive } from "@/db";
import { AccountNotFound, makeCurrency } from "@/ledgers/accounts";
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
	type TransactionCreateRepositoryError,
	type TransactionRepo,
	TransactionRepoLive,
	TransactionRepoTag,
	transactionRepoLayer,
} from "./TransactionRepo";
import { Entry, Transaction, type TransactionMutation } from "./domain/Transaction";
import {
	TransactionConcurrencyFailure,
	TransactionLifecycleConflict,
	TransactionNotFound,
	TransactionPersistenceDecodingFailure,
	TransactionPersistenceFailure,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
} from "./TransactionErrors";

const makeCreate = async (
	organizationId: OrgID,
	ledgerId: LedgerID,
	status: "pending" | "posted",
	entries: ReadonlyArray<{
		readonly accountId: ReturnType<typeof newLedgerAccountID>;
		readonly direction: "debit" | "credit";
		readonly amount: number;
		readonly currencyCode?: string;
	}>
): Promise<TransactionMutation> => {
	const created = DateTime.fromISO("2026-08-15T12:00:00.000Z", { zone: "utc" });
	const domainEntries = await Promise.all(
		entries.map(entry =>
			Effect.runPromise(
				Entry.make({
					id: newLedgerTransactionEntryID(),
					accountId: entry.accountId,
					direction: entry.direction,
					amount: entry.amount,
					currency: makeCurrency(entry.currencyCode ?? "EUR", 2),
				})
			)
		)
	);
	const common = {
		id: newLedgerTransactionID(),
		organizationId,
		ledgerId,
		entries: domainEntries,
		created,
		updated: created,
	};
	return Effect.runPromise(
		status === "posted"
			? Transaction.create({ ...common, status, postedAt: created })
			: Transaction.create({ ...common, status })
	);
};

const makeBalancedEntries = async (
	accountIds: readonly ReturnType<typeof newLedgerAccountID>[]
): Promise<readonly Entry[]> => {
	const debitCount = Math.ceil(accountIds.length / 2);
	const creditCount = accountIds.length - debitCount;
	return Promise.all(
		accountIds.map((accountId, index) =>
			Effect.runPromise(
				Entry.make({
					id: newLedgerTransactionEntryID(),
					accountId,
					direction: index < debitCount ? "debit" : "credit",
					amount: index === debitCount ? debitCount - (creditCount - 1) : 1,
					currency: makeCurrency("EUR", 2),
				})
			)
		)
	);
};

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

	const createAccount = async (
		organizationId: OrgID,
		ledgerId: LedgerID,
		overrides: {
			readonly currencyCode?: string;
			readonly pendingDebits?: number;
		} = {}
	) => {
		const accountId = newLedgerAccountID();
		await (await database()).db.insert(LedgerAccountsTable).values({
			id: accountId.toString(),
			organizationId: organizationId.toString(),
			ledgerId: ledgerId.toString(),
			name: `Create ${accountId.toString()}`,
			normalBalance: "debit",
			currencyCode: overrides.currencyCode ?? "EUR",
			minorUnitExponent: 2,
			pendingDebits: overrides.pendingDebits,
		});
		return accountId;
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

	it.each([
		{ status: "pending" as const, posted: false },
		{ status: "posted" as const, posted: true },
	])("creates a $status Transaction and applies its exact counter sets", async testCase => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
		const mutation = await makeCreate(organizationId, ledgerId, testCase.status, [
			{ accountId: debit, direction: "debit", amount: 40 },
			{ accountId: debit, direction: "debit", amount: 60 },
			{ accountId: credit, direction: "credit", amount: 100 },
		]);

		const created = await runRepo(repository =>
			repository.createTransaction(`create-${mutation.transaction.id.toString()}`, mutation)
		);
		const rows = await (
			await database()
		).db
			.select()
			.from(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			);
		const byId = new Map(rows.map(row => [row.id, row]));

		expect(created.id.toString()).toBe(mutation.transaction.id.toString());
		expect(created.postedAt?.toISO()).toBe(testCase.posted ? "2026-08-15T12:00:00.000Z" : undefined);
		expect(byId.get(debit.toString())).toMatchObject({
			pendingDebits: 100,
			postedDebits: testCase.posted ? 100 : 0,
			lockVersion: 1,
		});
		expect(byId.get(credit.toString())).toMatchObject({
			pendingCredits: 100,
			postedCredits: testCase.posted ? 100 : 0,
			lockVersion: 1,
		});
		expect(
			await (
				await database()
			).db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, created.id.toString()))
		).toHaveLength(3);
	});

	it.each([
		{ label: "missing", account: "missing" as const },
		{ label: "cross-Organization", account: "other" as const },
	])("hides a $label Account and rolls back the create", async testCase => {
		const owner = await createLedger();
		const other = await createLedger();
		const owned = await createAccount(owner.organizationId, owner.ledgerId);
		const invalid =
			testCase.account === "missing"
				? newLedgerAccountID()
				: await createAccount(other.organizationId, other.ledgerId);
		const mutation = await makeCreate(owner.organizationId, owner.ledgerId, "pending", [
			{ accountId: invalid, direction: "debit", amount: 10 },
			{ accountId: owned, direction: "credit", amount: 10 },
		]);

		const error = await runRepo(repository =>
			Effect.flip(
				repository.createTransaction(`invalid-${mutation.transaction.id.toString()}`, mutation)
			)
		);
		expect(error).toBeInstanceOf(AccountNotFound);
		expect(
			await (
				await database()
			).db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, mutation.transaction.id.toString()))
		).toHaveLength(0);
		const [account] = await (
			await database()
		).db
			.select()
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.id, owned.toString()));
		expect(account).toMatchObject({ pendingCredits: 0, lockVersion: 0 });
	});

	it.each([
		{ label: "Currency mismatch", unsafe: false },
		{ label: "unsafe resulting counter", unsafe: true },
	])("rejects $label and rolls back every write", async testCase => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, {
			currencyCode: testCase.unsafe ? "EUR" : "USD",
			pendingDebits: testCase.unsafe ? Number.MAX_SAFE_INTEGER : undefined,
		});
		const credit = await createAccount(organizationId, ledgerId);
		const mutation = await makeCreate(organizationId, ledgerId, "pending", [
			{ accountId: debit, direction: "debit", amount: 1 },
			{ accountId: credit, direction: "credit", amount: 1 },
		]);

		const error = await runRepo(repository =>
			Effect.flip(
				repository.createTransaction(`invalid-${mutation.transaction.id.toString()}`, mutation)
			)
		);
		expect(error).toBeInstanceOf(TransactionValidationFailure);
		expect(
			await (
				await database()
			).db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, mutation.transaction.id.toString()))
		).toHaveLength(0);
	});

	it.each([
		{ label: "nonpositive Amount", amount: 0 },
		{ label: "unbalanced Entries", amount: 2 },
	])("revalidates $label inside PostgreSQL and rolls back its claim", async testCase => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
		const valid = await makeCreate(organizationId, ledgerId, "pending", [
			{ accountId: debit, direction: "debit", amount: 1 },
			{ accountId: credit, direction: "credit", amount: 1 },
		]);
		const invalid = {
			...valid,
			transaction: {
				...valid.transaction,
				entries: [
					valid.transaction.entries[0],
					{
						...valid.transaction.entries[1],
						amount: testCase.amount,
					},
				],
			},
		} as unknown as TransactionMutation;

		const error = await runRepo(repository =>
			Effect.flip(repository.createTransaction(`invalid-${valid.transaction.id.toString()}`, invalid))
		);
		expect(error).toBeInstanceOf(TransactionValidationFailure);
		expect(
			await (
				await database()
			).db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, valid.transaction.id.toString()))
		).toHaveLength(0);
	});

	it("classifies an Entry primary-key fault as unexpected persistence and rolls back", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
		const valid = await makeCreate(organizationId, ledgerId, "pending", [
			{ accountId: debit, direction: "debit", amount: 3 },
			{ accountId: credit, direction: "credit", amount: 3 },
		]);
		const duplicateEntryId = {
			...valid,
			transaction: {
				...valid.transaction,
				entries: [
					valid.transaction.entries[0],
					{ ...valid.transaction.entries[1], id: valid.transaction.entries[0]!.id },
				],
			},
		} as unknown as TransactionMutation;

		const error = await runRepo(repository =>
			Effect.flip(repository.createTransaction("duplicate-entry-write", duplicateEntryId))
		);
		expect(error).toBeInstanceOf(TransactionPersistenceFailure);
		expect(
			await (
				await database()
			).db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, valid.transaction.id.toString()))
		).toHaveLength(0);
		const [account] = await (
			await database()
		).db
			.select()
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.id, debit.toString()));
		expect(account).toMatchObject({ pendingDebits: 0, lockVersion: 0 });
	});

	it.each([
		{ label: "Pending with Posted Time", status: "pending", postedAt: "valid" },
		{ label: "Posted without Posted Time", status: "posted", postedAt: "missing" },
		{ label: "Posted with invalid Posted Time", status: "posted", postedAt: "invalid" },
		{ label: "Voided create", status: "voided", postedAt: "missing" },
	] as const)("rejects malformed $label lifecycle at the repository seam", async testCase => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
		const valid = await makeCreate(organizationId, ledgerId, "pending", [
			{ accountId: debit, direction: "debit", amount: 7 },
			{ accountId: credit, direction: "credit", amount: 7 },
		]);
		const postedAt =
			testCase.postedAt === "valid"
				? DateTime.fromISO("2026-08-15T12:30:00.000Z", { zone: "utc" })
				: testCase.postedAt === "invalid"
					? DateTime.invalid("test invalid")
					: undefined;
		const malformed = {
			...valid,
			transaction: { ...valid.transaction, status: testCase.status, postedAt },
		} as unknown as TransactionMutation;

		const error = await runRepo(repository =>
			Effect.flip(
				repository.createTransaction(`lifecycle-${valid.transaction.id.toString()}`, malformed)
			)
		);
		expect(error).toBeInstanceOf(TransactionValidationFailure);
		expect(
			await (
				await database()
			).db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, valid.transaction.id.toString()))
		).toHaveLength(0);
		expect(
			await (
				await database()
			).db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, valid.transaction.id.toString()))
		).toHaveLength(0);
		const accounts = await (
			await database()
		).db
			.select()
			.from(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			);
		expect(accounts).toEqual([
			expect.objectContaining({ pendingDebits: 0, pendingCredits: 0, lockVersion: 0 }),
			expect.objectContaining({ pendingDebits: 0, pendingCredits: 0, lockVersion: 0 }),
		]);
	});

	it("rolls back a completed Account update when a later Account update fails", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const accountIds = [
			await createAccount(organizationId, ledgerId),
			await createAccount(organizationId, ledgerId),
		].sort((left, right) => left.toString().localeCompare(right.toString()));
		const mutation = await makeCreate(organizationId, ledgerId, "pending", [
			{ accountId: accountIds[0]!, direction: "debit", amount: 11 },
			{ accountId: accountIds[1]!, direction: "credit", amount: 11 },
		]);
		const db = (await database()).db;
		await db.execute(sql.raw("DROP TRIGGER IF EXISTS t7_fail_later_update ON ledger_accounts"));
		await db.execute(sql.raw("DROP FUNCTION IF EXISTS t7_fail_later_update()"));
		await db.execute(sql.raw("DROP SEQUENCE IF EXISTS t7_account_update_attempts"));
		await db.execute(sql.raw("CREATE SEQUENCE t7_account_update_attempts"));
		await db.execute(
			sql.raw(`
			CREATE FUNCTION t7_fail_later_update() RETURNS trigger AS $$
			BEGIN
				IF NEW.organization_id = '${organizationId.toString()}' AND NEW.ledger_id = '${ledgerId.toString()}' THEN
					PERFORM nextval('t7_account_update_attempts');
					IF NEW.id = '${accountIds[1]!.toString()}' THEN
						RAISE EXCEPTION 'forced later Account update failure';
					END IF;
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql
		`)
		);
		await db.execute(
			sql.raw(`
			CREATE TRIGGER t7_fail_later_update
			BEFORE UPDATE ON ledger_accounts
			FOR EACH ROW EXECUTE FUNCTION t7_fail_later_update()
		`)
		);

		try {
			const error = await runRepo(repository =>
				Effect.flip(repository.createTransaction("partial-account-write", mutation))
			);
			expect(error).toBeInstanceOf(TransactionPersistenceFailure);
			const attempts = await db.execute<{ last_value: string; is_called: boolean }>(
				sql.raw("SELECT last_value, is_called FROM t7_account_update_attempts")
			);
			expect(attempts.rows[0]).toMatchObject({ last_value: "2", is_called: true });
			expect(
				await db
					.select()
					.from(LedgerTransactionsTable)
					.where(eq(LedgerTransactionsTable.id, mutation.transaction.id.toString()))
			).toHaveLength(0);
			expect(
				await db
					.select()
					.from(LedgerTransactionEntriesTable)
					.where(eq(LedgerTransactionEntriesTable.transactionId, mutation.transaction.id.toString()))
			).toHaveLength(0);
			const accounts = await db
				.select()
				.from(LedgerAccountsTable)
				.where(
					and(
						eq(LedgerAccountsTable.organizationId, organizationId.toString()),
						eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
					)
				);
			expect(accounts).toEqual([
				expect.objectContaining({ pendingDebits: 0, pendingCredits: 0, lockVersion: 0 }),
				expect.objectContaining({ pendingDebits: 0, pendingCredits: 0, lockVersion: 0 }),
			]);
		} finally {
			await db.execute(sql.raw("DROP TRIGGER IF EXISTS t7_fail_later_update ON ledger_accounts"));
			await db.execute(sql.raw("DROP FUNCTION IF EXISTS t7_fail_later_update()"));
			await db.execute(sql.raw("DROP SEQUENCE IF EXISTS t7_account_update_attempts"));
		}
	});

	it("elects one PostgreSQL winner for a concurrent Organization-scoped key", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
		const inputs = await Promise.all(
			[0, 1].map(() =>
				makeCreate(organizationId, ledgerId, "pending", [
					{ accountId: debit, direction: "debit", amount: 25 },
					{ accountId: credit, direction: "credit", amount: 25 },
				])
			)
		);
		const key = `t7-barrier-${newLedgerTransactionID().toString()}`;
		const db = (await database()).db;
		const barrierPool = new Pool({ connectionString: new Config().databaseUrl });
		const blocker = await barrierPool.connect();
		await db.execute(sql.raw("DROP TRIGGER IF EXISTS t7_create_barrier ON ledger_transactions"));
		await db.execute(sql.raw("DROP FUNCTION IF EXISTS t7_create_barrier()"));
		await db.execute(
			sql.raw(`
			CREATE FUNCTION t7_create_barrier() RETURNS trigger AS $$
			BEGIN
				IF NEW.idempotency_key LIKE 't7-barrier-%' THEN
					PERFORM pg_advisory_xact_lock(770007);
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql
		`)
		);
		await db.execute(
			sql.raw(`
			CREATE TRIGGER t7_create_barrier
			BEFORE INSERT ON ledger_transactions
			FOR EACH ROW EXECUTE FUNCTION t7_create_barrier()
		`)
		);
		await blocker.query("SELECT pg_advisory_lock(770007)");

		let results: Result.Result<Transaction, TransactionCreateRepositoryError>[] = [];
		let overlapping = false;
		try {
			const pending = inputs.map(mutation =>
				runRepo(repository => repository.createTransaction(key, mutation).pipe(Effect.result))
			);
			for (let attempt = 0; attempt < 100; attempt += 1) {
				const waiting = await blocker.query<{ count: number }>(`
					SELECT count(*)::integer AS count
					FROM pg_stat_activity
					WHERE wait_event = 'advisory'
					AND query LIKE 'insert into "ledger_transactions"%'
				`);
				if (waiting.rows[0]!.count === 2) {
					overlapping = true;
					break;
				}
				await delay(10);
			}
			await blocker.query("SELECT pg_advisory_unlock(770007)");
			results = await Promise.all(pending);
		} finally {
			await blocker.query("SELECT pg_advisory_unlock(770007)");
			blocker.release();
			await barrierPool.end();
			await db.execute(sql.raw("DROP TRIGGER IF EXISTS t7_create_barrier ON ledger_transactions"));
			await db.execute(sql.raw("DROP FUNCTION IF EXISTS t7_create_barrier()"));
		}
		expect(overlapping).toBe(true);
		expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
		const loser = results.find(result => result._tag === "Failure");
		expect(loser?._tag === "Failure" ? loser.failure : undefined).toBeInstanceOf(
			TransactionConcurrencyFailure
		);
		const [account] = await (
			await database()
		).db
			.select()
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.id, debit.toString()));
		expect(account).toMatchObject({ pendingDebits: 25, lockVersion: 1 });
		expect(
			await (
				await database()
			).db
				.select()
				.from(LedgerTransactionsTable)
				.where(
					and(
						eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
						eq(LedgerTransactionsTable.idempotencyKey, key)
					)
				)
				.then(rows => rows.length)
		).toBe(1);
	});

	it("allows the same idempotency key in different Organizations", async () => {
		const owners = await Promise.all([createLedger(), createLedger()]);
		const mutations = await Promise.all(
			owners.map(async owner => {
				const debit = await createAccount(owner.organizationId, owner.ledgerId);
				const credit = await createAccount(owner.organizationId, owner.ledgerId);
				return makeCreate(owner.organizationId, owner.ledgerId, "pending", [
					{ accountId: debit, direction: "debit", amount: 5 },
					{ accountId: credit, direction: "credit", amount: 5 },
				]);
			})
		);

		const created = await Promise.all(
			mutations.map(mutation =>
				runRepo(repository => repository.createTransaction("shared-create-key", mutation))
			)
		);
		expect(created).toHaveLength(2);
	});

	it.each(["40001", "40P01"])(
		"classifies PostgreSQL %s as retryable concurrency without repository retry",
		async code => {
			let attempts = 0;
			const db = {
				transaction: () => {
					attempts += 1;
					return Promise.reject(Object.assign(new Error("classified failure"), { code }));
				},
			} as unknown as DrizzleDatabase;
			const repository = new TransactionRepoLive(db);
			const mutation = await makeCreate(newOrgID(), newLedgerID(), "pending", [
				{ accountId: newLedgerAccountID(), direction: "debit", amount: 1 },
				{ accountId: newLedgerAccountID(), direction: "credit", amount: 1 },
			]);

			const error = await Effect.runPromise(
				Effect.flip(repository.createTransaction("classified", mutation))
			);
			expect(error).toBeInstanceOf(TransactionConcurrencyFailure);
			expect(error.retryable).toBe(true);
			expect(attempts).toBe(1);
		}
	);

	it("atomically replaces a Pending Transaction and applies one net update per Account", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const [shared, removed, added] = await Promise.all([
			createAccount(organizationId, ledgerId),
			createAccount(organizationId, ledgerId),
			createAccount(organizationId, ledgerId),
		]);
		const original = await makeCreate(organizationId, ledgerId, "pending", [
			{ accountId: shared, direction: "debit", amount: 40 },
			{ accountId: shared, direction: "debit", amount: 60 },
			{ accountId: removed, direction: "credit", amount: 100 },
		]);
		const created = await runRepo(repository =>
			repository.createTransaction(`replace-${original.transaction.id.toString()}`, original)
		);
		const replacementEntries = await Promise.all(
			[
				Entry.make({
					id: newLedgerTransactionEntryID(),
					accountId: shared,
					direction: "debit",
					amount: 25,
					currency: makeCurrency("EUR", 2),
				}),
				Entry.make({
					id: newLedgerTransactionEntryID(),
					accountId: added,
					direction: "credit",
					amount: 25,
					currency: makeCurrency("EUR", 2),
				}),
			].map(effect => Effect.runPromise(effect))
		);
		const mutation = await Effect.runPromise(
			created.replace(
				{ description: "replacement", metadata: { source: "replace" }, entries: replacementEntries },
				DateTime.fromISO("2026-08-15T13:00:00.000Z", { zone: "utc" })
			)
		);

		const replaced = await runRepo(repository => repository.replaceTransaction(mutation));
		const accounts = await (
			await database()
		).db
			.select()
			.from(LedgerAccountsTable)
			.where(inArray(LedgerAccountsTable.id, [shared, removed, added].map(String)));
		const byId = new Map(accounts.map(account => [account.id, account]));

		expect(replaced).toMatchObject({
			id: created.id,
			status: "pending",
			description: "replacement",
			metadata: { source: "replace" },
			created: created.created,
			postedAt: undefined,
		});
		expect(replaced.entries.map(entry => entry.id.toString())).toEqual(
			replacementEntries.map(entry => entry.id.toString())
		);
		expect(byId.get(shared.toString())).toMatchObject({ pendingDebits: 25, lockVersion: 2 });
		expect(byId.get(removed.toString())).toMatchObject({ pendingCredits: 0, lockVersion: 2 });
		expect(byId.get(added.toString())).toMatchObject({ pendingCredits: 25, lockVersion: 1 });
	});

	it("stores omitted replacement optionals as null", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
		const original = await makeCreate(organizationId, ledgerId, "pending", [
			{ accountId: debit, direction: "debit", amount: 9 },
			{ accountId: credit, direction: "credit", amount: 9 },
		]);
		const created = await runRepo(repository =>
			repository.createTransaction(`clear-${original.transaction.id.toString()}`, original)
		);
		const mutation = await Effect.runPromise(
			created.replace(
				{ entries: created.entries },
				DateTime.fromISO("2026-08-15T13:01:00.000Z", { zone: "utc" })
			)
		);

		const replaced = await runRepo(repository => repository.replaceTransaction(mutation));
		const [row] = await (
			await database()
		).db
			.select()
			.from(LedgerTransactionsTable)
			.where(eq(LedgerTransactionsTable.id, created.id.toString()));
		expect(replaced.description).toBeUndefined();
		expect(replaced.metadata).toBeUndefined();
		expect(row?.description).toBeNull();
		expect(row?.metadata).toBeNull();
	});

	it.each(["posted", "voided"] as const)(
		"rejects replacement of a %s Transaction without changing it",
		async status => {
			const owner = await createLedger();
			const transactionId = await createTransaction(owner.organizationId, owner.ledgerId, { status });
			const replacement = await makeCreate(owner.organizationId, owner.ledgerId, "pending", [
				{ accountId: newLedgerAccountID(), direction: "debit", amount: 1 },
				{ accountId: newLedgerAccountID(), direction: "credit", amount: 1 },
			]);
			const mutation = {
				...replacement,
				transaction: { ...replacement.transaction, id: transactionId },
			} as TransactionMutation;

			const error = await runRepo(repository => Effect.flip(repository.replaceTransaction(mutation)));
			expect(error).toBeInstanceOf(TransactionLifecycleConflict);
			const [row] = await (
				await database()
			).db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, transactionId.toString()));
			expect(row?.status).toBe(status);
		}
	);

	it.each(["missing", "cross-tenant"] as const)(
		"hides a %s Transaction during replacement",
		async scenario => {
			const owner = await createLedger();
			const other = await createLedger();
			const mutation = await makeCreate(owner.organizationId, owner.ledgerId, "pending", [
				{ accountId: newLedgerAccountID(), direction: "debit", amount: 1 },
				{ accountId: newLedgerAccountID(), direction: "credit", amount: 1 },
			]);
			const target =
				scenario === "missing"
					? newLedgerTransactionID()
					: await createTransaction(other.organizationId, other.ledgerId);
			const replacement = {
				...mutation,
				transaction: { ...mutation.transaction, id: target },
			} as TransactionMutation;

			const error = await runRepo(repository =>
				Effect.flip(repository.replaceTransaction(replacement))
			);
			expect(error).toBeInstanceOf(TransactionNotFound);
		}
	);

	it.each(["ownership", "currency", "balance", "amount", "safe-result"] as const)(
		"rolls back the exact original state after a replacement %s failure",
		async scenario => {
			const owner = await createLedger();
			const debit = await createAccount(owner.organizationId, owner.ledgerId);
			const credit = await createAccount(owner.organizationId, owner.ledgerId);
			const extra = await createAccount(owner.organizationId, owner.ledgerId, {
				pendingDebits: scenario === "safe-result" ? Number.MAX_SAFE_INTEGER : undefined,
			});
			const original = await makeCreate(owner.organizationId, owner.ledgerId, "pending", [
				{ accountId: debit, direction: "debit", amount: 1 },
				{ accountId: credit, direction: "credit", amount: 1 },
			]);
			const created = await runRepo(repository =>
				repository.createTransaction(`rollback-${original.transaction.id.toString()}`, original)
			);
			const validEntries = await Promise.all(
				[
					Entry.make({
						id: newLedgerTransactionEntryID(),
						accountId: extra,
						direction: "debit",
						amount: 2,
						currency: makeCurrency("EUR", 2),
					}),
					Entry.make({
						id: newLedgerTransactionEntryID(),
						accountId: credit,
						direction: "credit",
						amount: 2,
						currency: makeCurrency("EUR", 2),
					}),
				].map(effect => Effect.runPromise(effect))
			);
			const entries = [
				{
					...validEntries[0]!,
					accountId: scenario === "ownership" ? newLedgerAccountID() : validEntries[0]!.accountId,
					currency: scenario === "currency" ? makeCurrency("USD", 2) : validEntries[0]!.currency,
					amount: scenario === "amount" ? 0 : validEntries[0]!.amount,
				},
				{
					...validEntries[1]!,
					amount: scenario === "amount" ? 0 : scenario === "balance" ? 1 : validEntries[1]!.amount,
				},
			] as unknown as Transaction["entries"];
			const replacement = {
				transaction: { ...created, entries },
				deltas: [],
			} as unknown as TransactionMutation;
			const db = (await database()).db;
			const beforeTransaction = await db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, created.id.toString()));
			const beforeEntries = await db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, created.id.toString()));
			const beforeAccounts = await db
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.ledgerId, owner.ledgerId.toString()));

			const error = await runRepo(repository =>
				Effect.flip(repository.replaceTransaction(replacement))
			);
			expect(error).toBeInstanceOf(
				scenario === "ownership" ? AccountNotFound : TransactionValidationFailure
			);
			expect(
				await db
					.select()
					.from(LedgerTransactionsTable)
					.where(eq(LedgerTransactionsTable.id, created.id.toString()))
			).toEqual(beforeTransaction);
			expect(
				await db
					.select()
					.from(LedgerTransactionEntriesTable)
					.where(eq(LedgerTransactionEntriesTable.transactionId, created.id.toString()))
			).toEqual(beforeEntries);
			expect(
				await db
					.select()
					.from(LedgerAccountsTable)
					.where(eq(LedgerAccountsTable.ledgerId, owner.ledgerId.toString()))
			).toEqual(beforeAccounts);
		}
	);

	it("restores the original Transaction, Entries, and counters after an Entry write fails", async () => {
		const owner = await createLedger();
		const debit = await createAccount(owner.organizationId, owner.ledgerId);
		const credit = await createAccount(owner.organizationId, owner.ledgerId);
		const original = await makeCreate(owner.organizationId, owner.ledgerId, "pending", [
			{ accountId: debit, direction: "debit", amount: 8 },
			{ accountId: credit, direction: "credit", amount: 8 },
		]);
		const created = await runRepo(repository =>
			repository.createTransaction(`entry-rollback-${original.transaction.id.toString()}`, original)
		);
		const duplicate = { ...created.entries[1], id: created.entries[0]!.id } as Entry;
		const mutation = {
			transaction: { ...created, entries: [created.entries[0], duplicate] },
			deltas: [],
		} as unknown as TransactionMutation;
		const db = (await database()).db;
		const before = await Promise.all([
			db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, created.id.toString())),
			db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, created.id.toString())),
			db
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.ledgerId, owner.ledgerId.toString())),
		]);

		const error = await runRepo(repository => Effect.flip(repository.replaceTransaction(mutation)));
		expect(error).toBeInstanceOf(TransactionPersistenceFailure);
		const after = await Promise.all([
			db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, created.id.toString())),
			db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, created.id.toString())),
			db
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.ledgerId, owner.ledgerId.toString())),
		]);
		expect(after).toEqual(before);
	});

	it("restores the complete original state after a later Account update fails", async () => {
		const owner = await createLedger();
		const accountIds = [
			await createAccount(owner.organizationId, owner.ledgerId),
			await createAccount(owner.organizationId, owner.ledgerId),
		].sort((left, right) => left.toString().localeCompare(right.toString()));
		const original = await makeCreate(owner.organizationId, owner.ledgerId, "pending", [
			{ accountId: accountIds[0]!, direction: "debit", amount: 6 },
			{ accountId: accountIds[1]!, direction: "credit", amount: 6 },
		]);
		const created = await runRepo(repository =>
			repository.createTransaction(`late-rollback-${original.transaction.id.toString()}`, original)
		);
		const mutation = await Effect.runPromise(
			created.replace(
				{ entries: created.entries },
				DateTime.fromISO("2026-08-15T13:02:00.000Z", { zone: "utc" })
			)
		);
		const db = (await database()).db;
		const before = await Promise.all([
			db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, created.id.toString())),
			db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, created.id.toString())),
			db
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.ledgerId, owner.ledgerId.toString())),
		]);
		await db.execute(sql.raw("DROP TRIGGER IF EXISTS t8_fail_later_update ON ledger_accounts"));
		await db.execute(sql.raw("DROP FUNCTION IF EXISTS t8_fail_later_update()"));
		await db.execute(
			sql.raw(`
			CREATE FUNCTION t8_fail_later_update() RETURNS trigger AS $$
			BEGIN
				IF NEW.organization_id = '${owner.organizationId.toString()}'
					AND NEW.ledger_id = '${owner.ledgerId.toString()}'
					AND NEW.id = '${accountIds[1]!.toString()}' THEN
					RAISE EXCEPTION 'forced later T8 Account update failure';
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql
		`)
		);
		await db.execute(
			sql.raw(`
			CREATE TRIGGER t8_fail_later_update
			BEFORE UPDATE ON ledger_accounts
			FOR EACH ROW EXECUTE FUNCTION t8_fail_later_update()
		`)
		);

		try {
			const error = await runRepo(repository => Effect.flip(repository.replaceTransaction(mutation)));
			expect(error).toBeInstanceOf(TransactionPersistenceFailure);
			const after = await Promise.all([
				db
					.select()
					.from(LedgerTransactionsTable)
					.where(eq(LedgerTransactionsTable.id, created.id.toString())),
				db
					.select()
					.from(LedgerTransactionEntriesTable)
					.where(eq(LedgerTransactionEntriesTable.transactionId, created.id.toString())),
				db
					.select()
					.from(LedgerAccountsTable)
					.where(eq(LedgerAccountsTable.ledgerId, owner.ledgerId.toString())),
			]);
			expect(after).toEqual(before);
		} finally {
			await db.execute(sql.raw("DROP TRIGGER IF EXISTS t8_fail_later_update ON ledger_accounts"));
			await db.execute(sql.raw("DROP FUNCTION IF EXISTS t8_fail_later_update()"));
		}
	});

	it("caps replacement Accounts without capping the old and replacement lock union", async () => {
		const owner = await createLedger();
		const oldAccountIds = Array.from({ length: 101 }, () => newLedgerAccountID());
		const replacementAccountIds = Array.from({ length: 101 }, () => newLedgerAccountID());
		const db = (await database()).db;
		await db.insert(LedgerAccountsTable).values(
			[...oldAccountIds, ...replacementAccountIds].map(accountId => ({
				id: accountId.toString(),
				organizationId: owner.organizationId.toString(),
				ledgerId: owner.ledgerId.toString(),
				name: `Boundary ${accountId.toString()}`,
				normalBalance: "debit" as const,
				currencyCode: "EUR",
				minorUnitExponent: 2,
			}))
		);
		const createdAt = DateTime.fromISO("2026-08-15T12:00:00.000Z", { zone: "utc" });
		const original = await Effect.runPromise(
			Transaction.create({
				id: newLedgerTransactionID(),
				organizationId: owner.organizationId,
				ledgerId: owner.ledgerId,
				status: "pending",
				entries: await makeBalancedEntries(oldAccountIds),
				created: createdAt,
				updated: createdAt,
			})
		);
		const created = await runRepo(repository =>
			repository.createTransaction(`cap-union-${original.transaction.id.toString()}`, original)
		);
		const replacement = await Effect.runPromise(
			created.replace(
				{ entries: await makeBalancedEntries(replacementAccountIds) },
				DateTime.fromISO("2026-08-15T13:03:00.000Z", { zone: "utc" })
			)
		);

		const replaced = await runRepo(repository => repository.replaceTransaction(replacement));
		expect(replaced.entries).toHaveLength(101);
		const accountRows = await db
			.select()
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.ledgerId, owner.ledgerId.toString()));
		const byId = new Map(accountRows.map(account => [account.id, account]));
		expect(oldAccountIds.every(id => byId.get(id.toString())?.lockVersion === 2)).toBe(true);
		expect(replacementAccountIds.every(id => byId.get(id.toString())?.lockVersion === 1)).toBe(true);

		const tooMany = await Effect.runPromise(
			replaced.replace(
				{
					entries: await makeBalancedEntries(Array.from({ length: 201 }, () => newLedgerAccountID())),
				},
				DateTime.fromISO("2026-08-15T13:04:00.000Z", { zone: "utc" })
			)
		);
		const before = await Promise.all([
			db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, replaced.id.toString())),
			db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, replaced.id.toString())),
		]);
		const error = await runRepo(repository => Effect.flip(repository.replaceTransaction(tooMany)));
		expect(error).toBeInstanceOf(TransactionValidationFailure);
		const after = await Promise.all([
			db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, replaced.id.toString())),
			db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, replaced.id.toString())),
		]);
		expect(after).toEqual(before);
	});
});
