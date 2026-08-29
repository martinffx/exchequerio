import { and, eq, inArray } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { DatabaseTag, makeDatabaseLive } from "@/db";
import { AccountNotFound, LedgerAccountCurrencyMismatch } from "@/domains/ledgers/accounts";
import {
	newLedgerAccountID,
	newLedgerID,
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

import {
	type LedgerTransactionRepo,
	LedgerTransactionRepoTag,
	ledgerTransactionRepoLayer,
} from "./LedgerTransactionRepo";
import { TransactionLifecycleConflict } from "./LedgerTransactionErrors";
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

	it.each([
		{ status: "pending" as const, posted: false },
		{ status: "posted" as const, posted: true },
	])("creates a balanced $status Transaction atomically", async ({ status, posted }) => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");

		const transaction = await runRepo(repository =>
			repository.createTransaction(
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
			repository.createTransaction(
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
			repository.createTransaction(
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

	it("rolls back when an Account is missing", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const missing = newLedgerAccountID();
		const error = await runRepo(repository =>
			Effect.flip(
				repository.createTransaction(
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

	it("replaces a pending Transaction and records each affected Account once", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId, "debit");
		const credit = await createAccount(organizationId, ledgerId, "credit");
		const transaction = await runRepo(repository =>
			repository.createTransaction(
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
				repository.createTransaction(
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
				repository.createTransaction(
					organizationId,
					ledgerId,
					newLedgerTransactionID(),
					transactionRequest
				)
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
