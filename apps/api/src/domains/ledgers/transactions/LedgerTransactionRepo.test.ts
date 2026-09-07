import { TypeID } from "typeid-js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
import {
	TransactionSettlementConflict,
	TransactionLifecycleConflict,
	TransactionPersistenceFailure,
} from "./LedgerTransactionErrors";
import type { ResolvedTransactionCreateRequest } from "./LedgerTransactionSchema";

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
	).pipe(Effect.flatMap(transaction => repository.createTransaction(transaction)));

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
				.delete(LedgerTransactionEntriesTable)
				.where(inArray(LedgerTransactionEntriesTable.organizationId, organizationIds));
			await db
				.delete(LedgerTransactionsTable)
				.where(inArray(LedgerTransactionsTable.organizationId, organizationIds));
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
			repository.createTransaction(generated).pipe(Effect.flip)
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
			repository.updateTransaction(organizationId, ledgerId, id, { ...body, effectiveAt })
		);
		await runtime.runPromise(repository.updateTransaction(organizationId, ledgerId, id, body));
		await runtime.runPromise(
			repository.postTransaction(organizationId, ledgerId, id, DateTime.utc())
		);
		const loaded = Option.getOrThrow(
			await runtime.runPromise(repository.getTransaction(organizationId, ledgerId, id))
		);
		expect(loaded.toResponse().effectiveAt).toBe(effectiveAt);
		const balances = await accounts(organizationId, ledgerId, [debit]);
		expect(balances.get(debit.toString())?.postedAmount).toBe(100n);
		await expect(
			runtime.runPromise(repository.updateTransaction(organizationId, ledgerId, id, body))
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
			repository.updateTransaction(organizationId, ledgerId, transaction.id, {
				description: "Updated",
				ledgerEntries: [
					{ accountId: debit.toString(), direction: "debit", amount: "30", ...summary(debit) },
					{ accountId: debit.toString(), direction: "debit", amount: "10", ...summary(debit) },
					{ accountId: credit.toString(), direction: "credit", amount: "40", ...summary(credit) },
				],
			})
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
			repository.postTransaction(organizationId, ledgerId, pendingToPost.id, postedAt)
		);
		const postedAgain = await runtime.runPromise(
			repository.postTransaction(organizationId, ledgerId, pendingToPost.id, postedAt)
		);
		const pendingToVoid = await createPending();
		const voided = await runtime.runPromise(
			repository.voidTransaction(organizationId, ledgerId, pendingToVoid.id, DateTime.utc())
		);
		const voidedAgain = await runtime.runPromise(
			repository.voidTransaction(organizationId, ledgerId, pendingToVoid.id, DateTime.utc())
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
				repository.voidTransaction(organizationId, ledgerId, pendingToPost.id, DateTime.utc())
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
});
