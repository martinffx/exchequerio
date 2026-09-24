import { type LedgerAccountBalanceMonitorJobPayload } from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorJob";
import { Client, Pool, type PoolClient } from "pg";
import { TypeID } from "typeid-js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Config } from "@/config";
import { type Database, DatabaseTag, makeDatabaseLive } from "@/db";
import { AccountNotFound, LedgerAccountAssetMismatch } from "@/domains/ledgers/accounts";
import {
	newLedgerAccountID,
	newLedgerAccountSettlementID,
	newLedgerID,
	newLedgerTransactionEntryID,
	newLedgerTransactionID,
	newOrgID,
	type LedgerID,
	type OrgID,
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
	type AccountingMutation,
	LedgerTransactionRepoTag,
	ledgerTransactionRepoLayer,
} from "./LedgerTransactionRepo";
import {
	TransactionSettlementConflict,
	TransactionLifecycleConflict,
	TransactionPersistenceFailure,
} from "./LedgerTransactionErrors";
import { type ResolvedTransactionCreateRequest } from "./LedgerTransactionSchema";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const accountAssets = new Map<
	string,
	{ assetId: string; assetCode: string; minorUnitExponent: number }
>();
const summary = (accountId: { toString(): string }) =>
	accountAssets.get(accountId.toString()) ?? {
		assetId: "ast_00000000000000000000000001",
		assetCode: "EUR",
		minorUnitExponent: 2,
	};
type AccountId = ReturnType<typeof newLedgerAccountID>;

const request = (
	status: "pending" | "posted",
	entries: readonly Readonly<{
		accountId: AccountId;
		direction: "debit" | "credit";
		amount: string;
	}>[]
): ResolvedTransactionCreateRequest => ({
	status,
	description: "Repository transaction",
	metadata: { source: "test" },
	ledgerEntries: entries.map(entry => ({
		...entry,
		accountId: entry.accountId.toString(),
		...summary(entry.accountId),
	})),
});

const persist = (
	repository: LedgerTransactionRepo,
	organizationId: OrgID,
	ledgerId: LedgerID,
	transactionId: ReturnType<typeof newLedgerTransactionID>,
	transactionRequest: ResolvedTransactionCreateRequest
) =>
	LedgerTransaction.fromCreateRequest(
		transactionId,
		organizationId,
		ledgerId,
		transactionRequest,
		DateTime.utc(),
		transactionRequest.ledgerEntries.map(() => newLedgerTransactionEntryID())
	).pipe(
		Effect.flatMap(transaction =>
			repository.createTransaction(transaction).pipe(Effect.map(result => result.transaction))
		)
	);

describe("LedgerTransactionRepoLive", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const layer = Layer.merge(
		databaseLayer,
		ledgerTransactionRepoLayer.pipe(Layer.provide(databaseLayer))
	);
	const runtime = ManagedRuntime.make(layer);
	const organizationIds: string[] = [];

	let repository: LedgerTransactionRepo;
	let database: Database["db"];

	beforeAll(async () => {
		repository = await runtime.runPromise(LedgerTransactionRepoTag);
		database = (await runtime.runPromise(DatabaseTag)).db;
	});

	const createLedger = async () => {
		const organizationId = newOrgID();
		const ledgerId = newLedgerID();
		const db = database;
		organizationIds.push(organizationId.toUUID());
		await db.insert(OrganizationsTable).values({
			id: organizationId.toUUID(),
			name: `Organization ${organizationId.toUUID()}`,
		});
		await db.insert(LedgersTable).values({
			id: ledgerId.toUUID(),
			organizationId: organizationId.toUUID(),
			name: `Ledger ${ledgerId.toUUID()}`,
		});
		return { organizationId, ledgerId };
	};

	const createAccount = async (
		organizationId: OrgID,
		ledgerId: LedgerID,
		normalBalance: "debit" | "credit",
		assetCode = "EUR"
	) => {
		const id = newLedgerAccountID();
		const db = database;
		const [asset] = await db
			.insert(AssetsTable)
			.values({
				id: newOrgID().toUUID(),
				organizationId: organizationId.toUUID(),
				code: assetCode,
				name: assetCode,
				minorUnitExponent: 2,
			})
			.onConflictDoUpdate({
				target: [AssetsTable.organizationId, AssetsTable.code],
				set: { name: assetCode },
			})
			.returning();
		accountAssets.set(id.toString(), {
			assetId: TypeID.fromUUID("ast", asset!.id).toString(),
			assetCode: asset!.code,
			minorUnitExponent: asset!.minorUnitExponent,
		});
		await db.insert(LedgerAccountsTable).values({
			id: id.toUUID(),
			organizationId: organizationId.toUUID(),
			ledgerId: ledgerId.toUUID(),
			name: `Account ${id.toUUID()}`,
			normalBalance,
			assetId: asset!.id,
		});
		return id;
	};

	const accounts = async (
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountIds: readonly AccountId[]
	) => {
		const db = database;
		const rows = await db
			.select()
			.from(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, organizationId.toUUID()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toUUID()),
					inArray(
						LedgerAccountsTable.id,
						accountIds.map(accountId => accountId.toUUID())
					)
				)
			);
		return new Map(rows.map(account => [TypeID.fromUUID("lat", account.id).toString(), account]));
	};

	afterAll(async () => {
		if (organizationIds.length > 0) {
			const db = database;
			await db
				.delete(LedgerAccountBalanceMonitorsTable)
				.where(inArray(LedgerAccountBalanceMonitorsTable.organizationId, organizationIds));
			await db
				.delete(LedgerTransactionEntriesTable)
				.where(inArray(LedgerTransactionEntriesTable.organizationId, organizationIds));
			await db
				.delete(LedgerTransactionsTable)
				.where(inArray(LedgerTransactionsTable.organizationId, organizationIds));
			await db
				.delete(LedgerAccountSettlementsTable)
				.where(inArray(LedgerAccountSettlementsTable.organizationId, organizationIds));
			await db
				.delete(LedgerAccountsTable)
				.where(inArray(LedgerAccountsTable.organizationId, organizationIds));
			await db.delete(LedgersTable).where(inArray(LedgersTable.organizationId, organizationIds));
			await db.delete(AssetsTable).where(inArray(AssetsTable.organizationId, organizationIds));
			await db.delete(OrganizationsTable).where(inArray(OrganizationsTable.id, organizationIds));
		}
		await runtime.dispose();
	});

	it("rejects generated accounting through generic creation before any database writes", async () => {
		const ordinary = Effect.runSync(
			LedgerTransaction.fromCreateRequest(
				newLedgerTransactionID(),
				newOrgID(),
				newLedgerID(),
				request("pending", [
					{ accountId: newLedgerAccountID(), direction: "debit", amount: "10" },
					{ accountId: newLedgerAccountID(), direction: "credit", amount: "10" },
				])
			)
		);
		const generated = Effect.runSync(
			LedgerTransaction.create({
				...ordinary,
				settlementId: newLedgerAccountSettlementID(),
			})
		);
		const failure = await runtime.runPromise(
			repository
				.createTransaction(generated)
				.pipe(Effect.map(result => result.transaction))
				.pipe(Effect.flip)
		);
		expect(failure).toBeInstanceOf(TransactionSettlementConflict);
	});

	it("persists pending effective-time edits and preserves them through posting", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const body = request("pending", [
			{ accountId: debit, direction: "debit", amount: "100" },
			{ accountId: credit, direction: "credit", amount: "100" },
		]);
		const id = newLedgerTransactionID();
		await runtime.runPromise(persist(repository, organizationId, ledgerId, id, body));
		const effectiveAt = "2027-01-01T00:00:00.000Z";
		await runtime.runPromise(
			repository
				.updateTransaction(organizationId, ledgerId, id, { ...body, effectiveAt })
				.pipe(Effect.map(result => result.transaction))
		);
		await runtime.runPromise(
			repository
				.updateTransaction(organizationId, ledgerId, id, body)
				.pipe(Effect.map(result => result.transaction))
		);
		await runtime.runPromise(
			repository
				.postTransaction(organizationId, ledgerId, id, DateTime.utc())
				.pipe(Effect.map(result => result.transaction))
		);
		const loaded = Option.getOrThrow(
			await runtime.runPromise(repository.getTransaction(organizationId, ledgerId, id))
		);
		expect(loaded.toResponse().effectiveAt).toBe(effectiveAt);
		const balances = await accounts(organizationId, ledgerId, [debit]);
		expect(balances.get(debit.toString())?.postedAmount).toBe(100n);
		await expect(
			runtime.runPromise(
				repository
					.updateTransaction(organizationId, ledgerId, id, body)
					.pipe(Effect.map(result => result.transaction))
			)
		).rejects.toBeInstanceOf(TransactionLifecycleConflict);
	});

	it.each([
		{ status: "pending" as const, posted: false },
		{ status: "posted" as const, posted: true },
	])("creates a balanced $status Transaction atomically", async ({ status, posted }) => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");

		const transaction = await runtime.runPromise(
			persist(
				repository,
				organizationId,
				ledgerId,
				newLedgerTransactionID(),
				request(status, [
					{ accountId: debit, direction: "debit", amount: "60" },
					{ accountId: debit, direction: "debit", amount: "40" },
					{ accountId: credit, direction: "credit", amount: "100" },
				])
			)
		);
		const byId = await accounts(organizationId, ledgerId, [debit, credit]);

		expect(transaction.status).toBe(status);
		expect(transaction.lockVersion).toBe(1);
		expect(transaction.postedAt === undefined).toBe(!posted);
		expect(Option.getOrThrow(transaction.entries).map(entry => entry.assetCode)).toEqual([
			"EUR",
			"EUR",
			"EUR",
		]);
		expect(byId.get(debit.toString())).toMatchObject({
			pendingAmount: 100n,
			postedAmount: posted ? 100n : 0n,
			availableAmount: posted ? 100n : 0n,
			pendingDebits: 100n,
			postedDebits: posted ? 100n : 0n,
			availableDebits: posted ? 100n : 0n,
			lockVersion: 2,
		});
		expect(byId.get(credit.toString())).toMatchObject({
			pendingAmount: 100n,
			postedAmount: posted ? 100n : 0n,
			availableAmount: posted ? 100n : 0n,
			pendingCredits: 100n,
			postedCredits: posted ? 100n : 0n,
			availableCredits: posted ? 100n : 0n,
			lockVersion: 2,
		});
	});

	it("returns tenant-scoped reads in newest-first order", async () => {
		const owner = await createLedger();
		const other = await createLedger();
		const debit = await createAccount(owner.organizationId, owner.ledgerId, "debit");
		const credit = await createAccount(owner.organizationId, owner.ledgerId, "credit");
		const first = await runtime.runPromise(
			persist(
				repository,
				owner.organizationId,
				owner.ledgerId,
				newLedgerTransactionID(),
				request("pending", [
					{ accountId: debit, direction: "debit", amount: "10" },
					{ accountId: credit, direction: "credit", amount: "10" },
				])
			)
		);
		await new Promise(resolve => setTimeout(resolve, 2));
		const second = await runtime.runPromise(
			persist(
				repository,
				owner.organizationId,
				owner.ledgerId,
				newLedgerTransactionID(),
				request("pending", [
					{ accountId: debit, direction: "debit", amount: "20" },
					{ accountId: credit, direction: "credit", amount: "20" },
				])
			)
		);

		const listed = await runtime.runPromise(
			repository.listTransactions(owner.organizationId, owner.ledgerId, {
				offset: 0,
				limit: 20,
			})
		);

		expect(listed.map(transaction => transaction.id.toString())).toEqual([
			second.id.toString(),
			first.id.toString(),
		]);
		expect(listed.every(transaction => Option.isNone(transaction.entries))).toBe(true);
		expect(
			await runtime.runPromise(
				repository.getTransaction(other.organizationId, owner.ledgerId, first.id)
			)
		).toEqual(Option.none());
		expect(
			Option.getOrThrow(
				await runtime.runPromise(
					repository.getTransaction(owner.organizationId, owner.ledgerId, first.id)
				)
			).metadata
		).toEqual({ source: "test" });
	});

	it("rejects a missing Account before opening the write transaction", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const missing = newLedgerAccountID();
		accountAssets.set(missing.toString(), summary(debit));
		const error = await runtime.runPromise(
			Effect.flip(
				persist(
					repository,
					organizationId,
					ledgerId,
					newLedgerTransactionID(),
					request("pending", [
						{ accountId: debit, direction: "debit", amount: "1" },
						{ accountId: missing, direction: "credit", amount: "1" },
					])
				)
			)
		);

		expect(error).toBeInstanceOf(AccountNotFound);
		expect((await accounts(organizationId, ledgerId, [debit])).get(debit.toString())).toMatchObject({
			pendingDebits: 0n,
			lockVersion: 1,
		});
		expect(
			await runtime.runPromise(
				repository.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
			)
		).toHaveLength(0);
	});

	it("rolls back Transaction, Entry, and Account writes when persistence fails mid-transaction", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const transactionId = newLedgerTransactionID();
		const db = database;
		const suffix = crypto.randomUUID().replaceAll("-", "");
		const functionName = `fail_account_update_${suffix}`;
		const triggerName = `fail_account_update_${suffix}`;

		await db.execute(
			sql.raw(`
			CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
			BEGIN
				IF NEW.id = '${credit.toUUID()}' THEN
					RAISE EXCEPTION 'forced Account update failure';
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql;
			CREATE TRIGGER ${triggerName}
			BEFORE UPDATE ON ledger_accounts
			FOR EACH ROW EXECUTE FUNCTION ${functionName}();
		`)
		);

		try {
			const error = await runtime.runPromise(
				Effect.flip(
					persist(
						repository,
						organizationId,
						ledgerId,
						transactionId,
						request("pending", [
							{ accountId: debit, direction: "debit", amount: "10" },
							{ accountId: credit, direction: "credit", amount: "10" },
						])
					)
				)
			);
			expect(error).toBeInstanceOf(TransactionPersistenceFailure);
		} finally {
			await db.execute(sql.raw(`DROP TRIGGER ${triggerName} ON ledger_accounts`));
			await db.execute(sql.raw(`DROP FUNCTION ${functionName}()`));
		}

		expect(
			await db
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, transactionId.toUUID()))
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, transactionId.toUUID()))
		).toHaveLength(0);
		for (const account of (await accounts(organizationId, ledgerId, [debit, credit])).values()) {
			expect(account).toMatchObject({ pendingAmount: 0n, lockVersion: 1 });
		}
	});

	it("supports balanced multi-Asset Transactions and negative balances", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const eurDebit = await createAccount(organizationId, ledgerId, "debit", "EUR");
		const eurCredit = await createAccount(organizationId, ledgerId, "debit", "EUR");
		const usdDebit = await createAccount(organizationId, ledgerId, "debit", "USD");
		const usdCredit = await createAccount(organizationId, ledgerId, "debit", "USD");

		await runtime.runPromise(
			persist(repository, organizationId, ledgerId, newLedgerTransactionID(), {
				status: "posted",
				ledgerEntries: [
					{ accountId: eurDebit.toString(), direction: "debit", amount: "10", ...summary(eurDebit) },
					{ accountId: eurCredit.toString(), direction: "credit", amount: "10", ...summary(eurCredit) },
					{ accountId: usdDebit.toString(), direction: "debit", amount: "20", ...summary(usdDebit) },
					{ accountId: usdCredit.toString(), direction: "credit", amount: "20", ...summary(usdCredit) },
				],
			})
		);

		const byId = await accounts(organizationId, ledgerId, [eurDebit, eurCredit, usdDebit, usdCredit]);
		expect(byId.get(eurDebit.toString())?.postedAmount).toBe(10n);
		expect(byId.get(eurCredit.toString())?.postedAmount).toBe(-10n);
		expect(byId.get(usdDebit.toString())?.postedAmount).toBe(20n);
		expect(byId.get(usdCredit.toString())?.postedAmount).toBe(-20n);
	});

	it("replaces a pending Transaction and records each affected Account once", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const transaction = await runtime.runPromise(
			persist(
				repository,
				organizationId,
				ledgerId,
				newLedgerTransactionID(),
				request("pending", [
					{ accountId: debit, direction: "debit", amount: "100" },
					{ accountId: credit, direction: "credit", amount: "100" },
				])
			)
		);
		const originalEntryIds = Option.getOrThrow(transaction.entries).map(entry => entry.id.toString());

		const updated = await runtime.runPromise(
			repository
				.updateTransaction(organizationId, ledgerId, transaction.id, {
					description: "Updated",
					ledgerEntries: [
						{ accountId: debit.toString(), direction: "debit", amount: "30", ...summary(debit) },
						{ accountId: debit.toString(), direction: "debit", amount: "10", ...summary(debit) },
						{ accountId: credit.toString(), direction: "credit", amount: "40", ...summary(credit) },
					],
				})
				.pipe(Effect.map(result => result.transaction))
		);
		const byId = await accounts(organizationId, ledgerId, [debit, credit]);
		const updatedEntryIds = Option.getOrThrow(updated.entries).map(entry => entry.id.toString());

		expect(updated.description).toBe("Updated");
		expect(updated.lockVersion).toBe(2);
		expect(updatedEntryIds).not.toEqual(originalEntryIds);
		expect(byId.get(debit.toString())).toMatchObject({ pendingAmount: 40n, lockVersion: 3 });
		expect(byId.get(credit.toString())).toMatchObject({ pendingAmount: 40n, lockVersion: 3 });
	});

	it("posts and voids pending Transactions exactly once", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const createPending = () =>
			runtime.runPromise(
				persist(
					repository,
					organizationId,
					ledgerId,
					newLedgerTransactionID(),
					request("pending", [
						{ accountId: debit, direction: "debit", amount: "25" },
						{ accountId: credit, direction: "credit", amount: "25" },
					])
				)
			);

		const pendingToPost = await createPending();
		const postedAt = DateTime.utc();
		const posted = await runtime.runPromise(
			repository
				.postTransaction(organizationId, ledgerId, pendingToPost.id, postedAt)
				.pipe(Effect.map(result => result.transaction))
		);
		const postedAgain = await runtime.runPromise(
			repository
				.postTransaction(organizationId, ledgerId, pendingToPost.id, postedAt)
				.pipe(Effect.map(result => result.transaction))
		);
		const pendingToVoid = await createPending();
		const voided = await runtime.runPromise(
			repository
				.voidTransaction(organizationId, ledgerId, pendingToVoid.id, DateTime.utc())
				.pipe(Effect.map(result => result.transaction))
		);
		const voidedAgain = await runtime.runPromise(
			repository
				.voidTransaction(organizationId, ledgerId, pendingToVoid.id, DateTime.utc())
				.pipe(Effect.map(result => result.transaction))
		);
		const byId = await accounts(organizationId, ledgerId, [debit, credit]);

		expect(posted.status).toBe("posted");
		expect(postedAgain.lockVersion).toBe(posted.lockVersion);
		expect(Option.getOrThrow(posted.entries).every(entry => entry.status === "posted")).toBe(true);
		expect(voided.status).toBe("voided");
		expect(voidedAgain.lockVersion).toBe(voided.lockVersion);
		expect(Option.getOrThrow(voided.entries).every(entry => entry.status === "voided")).toBe(true);
		expect(byId.get(debit.toString())).toMatchObject({
			pendingAmount: 25n,
			postedAmount: 25n,
			availableAmount: 25n,
			lockVersion: 5,
		});
		expect(byId.get(credit.toString())).toMatchObject({
			pendingAmount: 25n,
			postedAmount: 25n,
			availableAmount: 25n,
			lockVersion: 5,
		});
		const error = await runtime.runPromise(
			Effect.flip(
				repository
					.voidTransaction(organizationId, ledgerId, pendingToPost.id, DateTime.utc())
					.pipe(Effect.map(result => result.transaction))
			)
		);
		expect(error).toBeInstanceOf(TransactionLifecycleConflict);
	});

	it("rejects an Entry Asset that does not match its Account", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const transactionRequest = request("pending", [
			{ accountId: debit, direction: "debit", amount: "10" },
			{ accountId: credit, direction: "credit", amount: "10" },
		]);
		transactionRequest.ledgerEntries[0]!.assetId = "ast_00000000000000000000000002";
		transactionRequest.ledgerEntries[1]!.assetId = "ast_00000000000000000000000002";

		const error = await runtime.runPromise(
			Effect.flip(
				persist(repository, organizationId, ledgerId, newLedgerTransactionID(), transactionRequest)
			)
		);

		expect(error).toBeInstanceOf(LedgerAccountAssetMismatch);
		expect(
			await runtime.runPromise(
				repository.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
			)
		).toHaveLength(0);
	});

	describe("balance monitor capture", () => {
		const jobs: LedgerAccountBalanceMonitorJobPayload[] = [];
		const capture = (result: AccountingMutation) => {
			jobs.push(...result.monitorJobs);
			return result.transaction;
		};
		const fixture = async (monitored = true) => {
			const { organizationId, ledgerId } = await createLedger();
			const debit = await createAccount(organizationId, ledgerId, "debit");
			const credit = await createAccount(organizationId, ledgerId, "credit");
			const assetId = TypeID.fromString(summary(debit).assetId);
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
			if (monitored) await database.insert(LedgerAccountBalanceMonitorsTable).values(monitor);
			const entries = (amount: number | string) =>
				request("pending", [
					{ accountId: debit, direction: "debit", amount: String(amount) },
					{ accountId: credit, direction: "credit", amount: String(amount) },
				]).ledgerEntries;
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
				await database.insert(LedgerAccountSettlementsTable).values({
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
				await database
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
			"uses the monitors committed while the balance update waits (enabled=%s)",
			async enabled => {
				const f = await fixture(!enabled);
				const client = new Client({ connectionString: new Config().databaseUrl });
				await client.connect();
				let pending: ReturnType<typeof f.create> | undefined;
				try {
					await client.query("BEGIN");
					const backend = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
					await client.query("SELECT id FROM ledger_accounts WHERE id = $1 FOR UPDATE", [
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
			const [account] = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, f.debit.toUUID()));
			expect(account!.postedAmount).toBe(100n);
		});
		it("keeps captured configuration after a monitor is edited and deleted", async () => {
			const f = await fixture();
			await f.create("posted");
			await database
				.update(LedgerAccountBalanceMonitorsTable)
				.set({
					webhookUrl: "https://example.com/new",
					webhookSigningSecret: "new-ciphertext",
					lockVersion: 2,
				})
				.where(eq(LedgerAccountBalanceMonitorsTable.id, f.monitor.id));
			await database
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
			await database
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
			const [account] = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, f.debit.toUUID()));
			expect(account!.postedAmount).toBe(9223372036854775807n);
		});
	});
});

describe("Migration compatibility", () => {
	const migrationsDirectory = join(import.meta.dirname, "../../../../migrations");
	const migrationNames = [
		"20251206175734_normal_retro_girl",
		"20251207122110_narrow_tigra",
		"20251210214057_damp_deathbird",
		"20260806203446_blue_kid_colt",
		"20260809203355_worthless_chimera",
		"20260826080418_transactions_effect",
	];

	const executeMigration = async (client: PoolClient, name: string) => {
		const migration = await readFile(join(migrationsDirectory, name, "migration.sql"), "utf8");
		for (const statement of migration.split("--> statement-breakpoint")) {
			if (statement.trim()) await client.query(statement);
		}
	};

	const withLegacyDatabase = async (run: (client: PoolClient) => Promise<void>) => {
		const configuredUrl = new URL(new Config().databaseUrl);
		const databaseName = `exchequer_migration_${crypto.randomUUID().replaceAll("-", "")}`;
		const adminUrl = new URL(configuredUrl);
		adminUrl.pathname = "/postgres";
		adminUrl.search = "";
		const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
		const databaseUrl = new URL(configuredUrl);
		databaseUrl.pathname = `/${databaseName}`;
		const pool = new Pool({ connectionString: databaseUrl.toString(), max: 1 });

		try {
			await admin.query(`CREATE DATABASE "${databaseName}"`);
			const client = await pool.connect();
			try {
				for (const migration of migrationNames.slice(0, -1)) await executeMigration(client, migration);
				await run(client);
			} finally {
				client.release();
			}
		} finally {
			await pool.end();
			await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
			await admin.end();
		}
	};

	const applyTransactionMigration = async (client: PoolClient) => {
		await client.query("BEGIN");
		try {
			await executeMigration(client, migrationNames.at(-1)!);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		}
	};

	describe("transaction Effect migration", () => {
		it("backfills restored effective time from creation time without inventing historical dates", async () => {
			await withLegacyDatabase(async client => {
				await applyTransactionMigration(client);
				await client.query(`
				INSERT INTO organizations_table (id, name) VALUES ('org-time', 'Time');
				INSERT INTO ledgers (id, organization_id, name) VALUES ('ledger-time', 'org-time', 'Time');
				INSERT INTO ledger_transactions (id, ledger_id, organization_id, status, created)
				VALUES ('transaction-time', 'ledger-time', 'org-time', 'pending', '2026-08-01T12:00:00Z');
			`);
				await executeMigration(client, "20260906074715_transaction-effective-time");
				const result = await client.query<{ matches: boolean }>(
					"SELECT effective_at = created AS matches FROM ledger_transactions WHERE id = 'transaction-time'"
				);
				expect(result.rows).toEqual([{ matches: true }]);
				await expect(
					client.query("UPDATE ledger_transactions SET effective_at = NULL")
				).rejects.toMatchObject({ code: "23502" });
			});
		}, 30_000);

		it("migrates an empty Transaction schema", async () => {
			await withLegacyDatabase(async client => {
				await applyTransactionMigration(client);

				const columns = await client.query<{ table_name: string; column_name: string }>(`
				SELECT table_name, column_name
				FROM information_schema.columns
				WHERE table_schema = 'public'
				AND (table_name, column_name) IN (
					('ledger_transactions', 'posted_at'),
					('ledger_transactions', 'lock_version'),
					('ledger_transaction_entries', 'ledger_id')
				)
				ORDER BY table_name, column_name
			`);
				expect(columns.rows).toEqual([
					{ table_name: "ledger_transaction_entries", column_name: "ledger_id" },
					{ table_name: "ledger_transactions", column_name: "lock_version" },
					{ table_name: "ledger_transactions", column_name: "posted_at" },
				]);

				const removedColumns = await client.query<{ count: number }>(`
				SELECT count(*)::int AS count
				FROM information_schema.columns
				WHERE table_schema = 'public'
				AND (table_name, column_name) IN (
					('ledger_accounts', 'minor_unit_exponent'),
					('ledger_transaction_entries', 'currency_exponent'),
					('ledger_transactions', 'idempotency_key')
				)
			`);
				expect(removedColumns.rows[0]).toEqual({ count: 0 });

				const lifecycle = await client.query<{ values: string[] }>(`
				SELECT array_agg(enumlabel::text ORDER BY enumsortorder) AS values
				FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
				WHERE pg_type.typname = 'ledger_transaction_status'
			`);
				expect(lifecycle.rows[0]).toEqual({ values: ["pending", "posted", "voided"] });
			});
		}, 30_000);

		it.each([
			["a Transaction", false],
			["a Transaction Entry", true],
		])(
			"rejects a legacy database containing %s before changing the schema",
			async (_case, withEntry) => {
				await withLegacyDatabase(async client => {
					await seedLegacyTransaction(client, withEntry);

					await expect(applyTransactionMigration(client)).rejects.toThrow(
						"transactions Effect migration requires empty ledger_transactions and ledger_transaction_entries tables"
					);

					const columns = await client.query<{ column_name: string }>(`
				SELECT column_name
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'ledger_transactions'
			`);
					const names = columns.rows.map(row => row.column_name);
					expect(names).toContain("effective_at");
					expect(names).toContain("idempotency_key");
					expect(names).not.toContain("posted_at");
					expect(
						(await client.query("SELECT count(*)::int AS count FROM ledger_transactions")).rows[0]
					).toEqual({ count: 1 });
				});
			},
			30_000
		);
	});
});

const seedLegacyTransaction = async (client: PoolClient, withEntry: boolean) => {
	await client.query(`
	INSERT INTO organizations_table (id, name) VALUES ('org-1', 'One');
	INSERT INTO ledgers (id, organization_id, name) VALUES ('ledger-1', 'org-1', 'One');
	INSERT INTO ledger_accounts (
		id, organization_id, ledger_id, name, normal_balance, currency_code, minor_unit_exponent
	) VALUES ('account-1', 'org-1', 'ledger-1', 'Cash', 'debit', 'USD', 2);
	INSERT INTO ledger_transactions (
		id, ledger_id, organization_id, status, effective_at
	) VALUES ('transaction-1', 'ledger-1', 'org-1', 'pending', '2026-08-01');
`);
	if (withEntry) {
		await client.query(`
		INSERT INTO ledger_transaction_entries (
			id, transaction_id, account_id, organization_id, direction, amount,
			currency, currency_exponent, status
		) VALUES (
			'entry-1', 'transaction-1', 'account-1', 'org-1', 'debit', 1,
			'USD', 2, 'pending'
		);
	`);
	}
};
