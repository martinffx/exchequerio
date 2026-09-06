import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { DatabaseTag, makeDatabaseLive } from "@/db";
import { AccountNotFound, LedgerAccountCurrencyMismatch } from "@/domains/ledgers/accounts";
import {
	newLedgerAccountID,
	newLedgerAccountSettlementID,
	newLedgerID,
	newLedgerTransactionEntryID,
	newLedgerTransactionID,
	newOrgID,
	type LedgerID,
	type OrgID,
} from "@/repo/entities/types";
import {
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
import {
	TransactionSettlementConflict,
	TransactionLifecycleConflict,
	TransactionPersistenceFailure,
} from "./LedgerTransactionErrors";
import type { TransactionCreateRequest } from "./LedgerTransactionSchema";

type AccountId = ReturnType<typeof newLedgerAccountID>;

const request = (
	status: "pending" | "posted",
	entries: readonly Readonly<{
		accountId: AccountId;
		direction: "debit" | "credit";
		amount: number;
	}>[]
): TransactionCreateRequest => ({
	status,
	description: "Repository transaction",
	metadata: { source: "test" },
	ledgerEntries: entries.map(entry => ({
		...entry,
		accountId: entry.accountId.toString(),
		currencyCode: "EUR",
	})),
});

const persist = (
	repository: LedgerTransactionRepo,
	organizationId: OrgID,
	ledgerId: LedgerID,
	transactionId: ReturnType<typeof newLedgerTransactionID>,
	transactionRequest: TransactionCreateRequest
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

	const runRepo = <A, E>(use: (repository: LedgerTransactionRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(LedgerTransactionRepoTag.pipe(Effect.flatMap(use)));

	const database = () => runtime.runPromise(DatabaseTag.pipe(Effect.map(value => value.db)));

	const createLedger = async () => {
		const organizationId = newOrgID();
		const ledgerId = newLedgerID();
		const db = await database();
		organizationIds.push(organizationId.toString());
		await db.insert(OrganizationsTable).values({
			id: organizationId.toString(),
			name: `Organization ${organizationId.toString()}`,
		});
		await db.insert(LedgersTable).values({
			id: ledgerId.toString(),
			organizationId: organizationId.toString(),
			name: `Ledger ${ledgerId.toString()}`,
		});
		return { organizationId, ledgerId };
	};

	const createAccount = async (
		organizationId: OrgID,
		ledgerId: LedgerID,
		normalBalance: "debit" | "credit",
		currencyCode = "EUR"
	) => {
		const id = newLedgerAccountID();
		const db = await database();
		await db.insert(LedgerAccountsTable).values({
			id: id.toString(),
			organizationId: organizationId.toString(),
			ledgerId: ledgerId.toString(),
			name: `Account ${id.toString()}`,
			normalBalance,
			currencyCode,
		});
		return id;
	};

	const accounts = async (
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountIds: readonly AccountId[]
	) => {
		const db = await database();
		const rows = await db
			.select()
			.from(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					inArray(
						LedgerAccountsTable.id,
						accountIds.map(accountId => accountId.toString())
					)
				)
			);
		return new Map(rows.map(account => [account.id, account]));
	};

	afterAll(async () => {
		if (organizationIds.length > 0) {
			const db = await database();
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
					{ accountId: newLedgerAccountID(), direction: "debit", amount: 10 },
					{ accountId: newLedgerAccountID(), direction: "credit", amount: 10 },
				])
			)
		);
		const generated = Effect.runSync(
			LedgerTransaction.create({
				...ordinary,
				settlementId: newLedgerAccountSettlementID(),
			})
		);
		const failure = await runRepo(repo => repo.createTransaction(generated).pipe(Effect.flip));
		expect(failure).toBeInstanceOf(TransactionSettlementConflict);
	});

	it("persists pending effective-time edits and preserves them through posting", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const body = request("pending", [
			{ accountId: debit, direction: "debit", amount: 100 },
			{ accountId: credit, direction: "credit", amount: 100 },
		]);
		const id = newLedgerTransactionID();
		await runRepo(repo => persist(repo, organizationId, ledgerId, id, body));
		const effectiveAt = "2027-01-01T00:00:00.000Z";
		await runRepo(repo =>
			repo.updateTransaction(organizationId, ledgerId, id, { ...body, effectiveAt })
		);
		await runRepo(repo => repo.updateTransaction(organizationId, ledgerId, id, body));
		await runRepo(repo => repo.postTransaction(organizationId, ledgerId, id, DateTime.utc()));
		const loaded = Option.getOrThrow(
			await runRepo(repo => repo.getTransaction(organizationId, ledgerId, id))
		);
		expect(loaded.toResponse().effectiveAt).toBe(effectiveAt);
		const balances = await accounts(organizationId, ledgerId, [debit]);
		expect(balances.get(debit.toString())?.postedAmount).toBe(100);
		await expect(
			runRepo(repo => repo.updateTransaction(organizationId, ledgerId, id, body))
		).rejects.toBeInstanceOf(TransactionLifecycleConflict);
	});

	it.each([
		{ status: "pending" as const, posted: false },
		{ status: "posted" as const, posted: true },
	])("creates a balanced $status Transaction atomically", async ({ status, posted }) => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");

		const transaction = await runRepo(repository =>
			persist(
				repository,
				organizationId,
				ledgerId,
				newLedgerTransactionID(),
				request(status, [
					{ accountId: debit, direction: "debit", amount: 60 },
					{ accountId: debit, direction: "debit", amount: 40 },
					{ accountId: credit, direction: "credit", amount: 100 },
				])
			)
		);
		const byId = await accounts(organizationId, ledgerId, [debit, credit]);

		expect(transaction.status).toBe(status);
		expect(transaction.lockVersion).toBe(1);
		expect(transaction.postedAt === undefined).toBe(!posted);
		expect(Option.getOrThrow(transaction.entries).map(entry => entry.currency)).toEqual([
			"EUR",
			"EUR",
			"EUR",
		]);
		expect(byId.get(debit.toString())).toMatchObject({
			pendingAmount: 100,
			postedAmount: posted ? 100 : 0,
			availableAmount: posted ? 100 : 0,
			pendingDebits: 100,
			postedDebits: posted ? 100 : 0,
			availableDebits: posted ? 100 : 0,
			lockVersion: 2,
		});
		expect(byId.get(credit.toString())).toMatchObject({
			pendingAmount: 100,
			postedAmount: posted ? 100 : 0,
			availableAmount: posted ? 100 : 0,
			pendingCredits: 100,
			postedCredits: posted ? 100 : 0,
			availableCredits: posted ? 100 : 0,
			lockVersion: 2,
		});
	});

	it("returns tenant-scoped reads in newest-first order", async () => {
		const owner = await createLedger();
		const other = await createLedger();
		const debit = await createAccount(owner.organizationId, owner.ledgerId, "debit");
		const credit = await createAccount(owner.organizationId, owner.ledgerId, "credit");
		const first = await runRepo(repository =>
			persist(
				repository,
				owner.organizationId,
				owner.ledgerId,
				newLedgerTransactionID(),
				request("pending", [
					{ accountId: debit, direction: "debit", amount: 10 },
					{ accountId: credit, direction: "credit", amount: 10 },
				])
			)
		);
		await new Promise(resolve => setTimeout(resolve, 2));
		const second = await runRepo(repository =>
			persist(
				repository,
				owner.organizationId,
				owner.ledgerId,
				newLedgerTransactionID(),
				request("pending", [
					{ accountId: debit, direction: "debit", amount: 20 },
					{ accountId: credit, direction: "credit", amount: 20 },
				])
			)
		);

		const listed = await runRepo(repository =>
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
			await runRepo(repository =>
				repository.getTransaction(other.organizationId, owner.ledgerId, first.id)
			)
		).toEqual(Option.none());
		expect(
			Option.getOrThrow(
				await runRepo(repository =>
					repository.getTransaction(owner.organizationId, owner.ledgerId, first.id)
				)
			).metadata
		).toEqual({ source: "test" });
	});

	it("rejects a missing Account before opening the write transaction", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const missing = newLedgerAccountID();
		const error = await runRepo(repository =>
			Effect.flip(
				persist(
					repository,
					organizationId,
					ledgerId,
					newLedgerTransactionID(),
					request("pending", [
						{ accountId: debit, direction: "debit", amount: 1 },
						{ accountId: missing, direction: "credit", amount: 1 },
					])
				)
			)
		);

		expect(error).toBeInstanceOf(AccountNotFound);
		expect((await accounts(organizationId, ledgerId, [debit])).get(debit.toString())).toMatchObject({
			pendingDebits: 0,
			lockVersion: 1,
		});
		expect(
			await runRepo(repository =>
				repository.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
			)
		).toHaveLength(0);
	});

	it("rolls back Transaction, Entry, and Account writes when persistence fails mid-transaction", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const transactionId = newLedgerTransactionID();
		const db = await database();
		const suffix = crypto.randomUUID().replaceAll("-", "");
		const functionName = `fail_account_update_${suffix}`;
		const triggerName = `fail_account_update_${suffix}`;

		await db.execute(
			sql.raw(`
			CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
			BEGIN
				IF NEW.id = '${credit.toString()}' THEN
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
			const error = await runRepo(repository =>
				Effect.flip(
					persist(
						repository,
						organizationId,
						ledgerId,
						transactionId,
						request("pending", [
							{ accountId: debit, direction: "debit", amount: 10 },
							{ accountId: credit, direction: "credit", amount: 10 },
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
				.where(eq(LedgerTransactionsTable.id, transactionId.toString()))
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, transactionId.toString()))
		).toHaveLength(0);
		for (const account of (await accounts(organizationId, ledgerId, [debit, credit])).values()) {
			expect(account).toMatchObject({ pendingAmount: 0, lockVersion: 1 });
		}
	});

	it("supports balanced multi-Currency Transactions and negative balances", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const eurDebit = await createAccount(organizationId, ledgerId, "debit", "EUR");
		const eurCredit = await createAccount(organizationId, ledgerId, "debit", "EUR");
		const usdDebit = await createAccount(organizationId, ledgerId, "debit", "USD");
		const usdCredit = await createAccount(organizationId, ledgerId, "debit", "USD");

		await runRepo(repository =>
			persist(repository, organizationId, ledgerId, newLedgerTransactionID(), {
				status: "posted",
				ledgerEntries: [
					{ accountId: eurDebit.toString(), direction: "debit", amount: 10, currencyCode: "EUR" },
					{ accountId: eurCredit.toString(), direction: "credit", amount: 10, currencyCode: "EUR" },
					{ accountId: usdDebit.toString(), direction: "debit", amount: 20, currencyCode: "USD" },
					{ accountId: usdCredit.toString(), direction: "credit", amount: 20, currencyCode: "USD" },
				],
			})
		);

		const byId = await accounts(organizationId, ledgerId, [eurDebit, eurCredit, usdDebit, usdCredit]);
		expect(byId.get(eurDebit.toString())?.postedAmount).toBe(10);
		expect(byId.get(eurCredit.toString())?.postedAmount).toBe(-10);
		expect(byId.get(usdDebit.toString())?.postedAmount).toBe(20);
		expect(byId.get(usdCredit.toString())?.postedAmount).toBe(-20);
	});

	it("replaces a pending Transaction and records each affected Account once", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const transaction = await runRepo(repository =>
			persist(
				repository,
				organizationId,
				ledgerId,
				newLedgerTransactionID(),
				request("pending", [
					{ accountId: debit, direction: "debit", amount: 100 },
					{ accountId: credit, direction: "credit", amount: 100 },
				])
			)
		);
		const originalEntryIds = Option.getOrThrow(transaction.entries).map(entry => entry.id.toString());

		const updated = await runRepo(repository =>
			repository.updateTransaction(organizationId, ledgerId, transaction.id, {
				description: "Updated",
				ledgerEntries: [
					{ accountId: debit.toString(), direction: "debit", amount: 30, currencyCode: "EUR" },
					{ accountId: debit.toString(), direction: "debit", amount: 10, currencyCode: "EUR" },
					{ accountId: credit.toString(), direction: "credit", amount: 40, currencyCode: "EUR" },
				],
			})
		);
		const byId = await accounts(organizationId, ledgerId, [debit, credit]);
		const updatedEntryIds = Option.getOrThrow(updated.entries).map(entry => entry.id.toString());

		expect(updated.description).toBe("Updated");
		expect(updated.lockVersion).toBe(2);
		expect(updatedEntryIds).not.toEqual(originalEntryIds);
		expect(byId.get(debit.toString())).toMatchObject({ pendingAmount: 40, lockVersion: 3 });
		expect(byId.get(credit.toString())).toMatchObject({ pendingAmount: 40, lockVersion: 3 });
	});

	it("posts and voids pending Transactions exactly once", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const createPending = () =>
			runRepo(repository =>
				persist(
					repository,
					organizationId,
					ledgerId,
					newLedgerTransactionID(),
					request("pending", [
						{ accountId: debit, direction: "debit", amount: 25 },
						{ accountId: credit, direction: "credit", amount: 25 },
					])
				)
			);

		const pendingToPost = await createPending();
		const postedAt = DateTime.utc();
		const posted = await runRepo(repository =>
			repository.postTransaction(organizationId, ledgerId, pendingToPost.id, postedAt)
		);
		const postedAgain = await runRepo(repository =>
			repository.postTransaction(organizationId, ledgerId, pendingToPost.id, postedAt)
		);
		const pendingToVoid = await createPending();
		const voided = await runRepo(repository =>
			repository.voidTransaction(organizationId, ledgerId, pendingToVoid.id, DateTime.utc())
		);
		const voidedAgain = await runRepo(repository =>
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
			pendingAmount: 25,
			postedAmount: 25,
			availableAmount: 25,
			lockVersion: 5,
		});
		expect(byId.get(credit.toString())).toMatchObject({
			pendingAmount: 25,
			postedAmount: 25,
			availableAmount: 25,
			lockVersion: 5,
		});
		const error = await runRepo(repository =>
			Effect.flip(
				repository.voidTransaction(organizationId, ledgerId, pendingToPost.id, DateTime.utc())
			)
		);
		expect(error).toBeInstanceOf(TransactionLifecycleConflict);
	});

	it("rejects an Entry Currency that does not match its Account", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const transactionRequest = request("pending", [
			{ accountId: debit, direction: "debit", amount: 10 },
			{ accountId: credit, direction: "credit", amount: 10 },
		]);
		transactionRequest.ledgerEntries[0]!.currencyCode = "USD";
		transactionRequest.ledgerEntries[1]!.currencyCode = "USD";

		const error = await runRepo(repository =>
			Effect.flip(
				persist(repository, organizationId, ledgerId, newLedgerTransactionID(), transactionRequest)
			)
		);

		expect(error).toBeInstanceOf(LedgerAccountCurrencyMismatch);
		expect(
			await runRepo(repository =>
				repository.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
			)
		).toHaveLength(0);
	});
});
