import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { DateTime } from "luxon";
import { afterAll, describe, expect, it } from "vitest";

import { Config } from "@/config";
import { makeDatabaseLive } from "@/db";
import { type LedgerRepo, LedgerRepoTag, ledgerRepoLayer } from "@/ledgers/LedgerRepo";
import { Ledger } from "@/ledgers/domain/Ledger";
import { AccountNotFound } from "@/ledgers/accounts";
import { type AccountRepo, AccountRepoTag, accountRepoLayer } from "@/ledgers/accounts/AccountRepo";
import { Account } from "@/ledgers/accounts/domain/Account";
import {
	type OrganizationRepo,
	OrganizationRepoTag,
	organizationRepoLayer,
} from "@/organizations/OrganizationRepo";
import { Organization } from "@/organizations/domain/Organization";
import {
	newLedgerAccountID,
	newLedgerID,
	newLedgerTransactionID,
	newOrgID,
	type LedgerID,
	type OrgID,
} from "@/repo/entities/types";
import { type TransactionRepo, TransactionRepoTag, transactionRepoLayer } from "./TransactionRepo";
import { TransactionLifecycleConflict, TransactionValidationFailure } from "./TransactionErrors";
import type { TransactionCreateRequest } from "./TransactionSchema";

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

describe("TransactionRepoLive", () => {
	const databaseLayer = makeDatabaseLive(new Config().databaseUrl);
	const layer = Layer.mergeAll(
		organizationRepoLayer,
		ledgerRepoLayer,
		accountRepoLayer,
		transactionRepoLayer
	).pipe(Layer.provide(databaseLayer));
	const runtime: ManagedRuntime.ManagedRuntime<
		OrganizationRepo | LedgerRepo | AccountRepo | TransactionRepo,
		never
	> = ManagedRuntime.make(layer);

	const runRepo = <A, E>(use: (repository: TransactionRepo) => Effect.Effect<A, E>) =>
		runtime.runPromise(TransactionRepoTag.pipe(Effect.flatMap(use)));
	const createLedger = async () => {
		const organizationId = newOrgID();
		const ledgerId = newLedgerID();
		await runtime.runPromise(
			OrganizationRepoTag.use(repository =>
				repository.createOrganization(
					Organization.fromRequest(organizationId, {
						name: `Organization ${organizationId.toString()}`,
					})
				)
			)
		);
		await runtime.runPromise(
			LedgerRepoTag.use(repository =>
				repository.createLedger(
					Ledger.fromRequest(ledgerId, organizationId, {
						name: `Ledger ${ledgerId.toString()}`,
					})
				)
			)
		);
		return { organizationId, ledgerId };
	};

	const createAccount = async (
		organizationId: OrgID,
		ledgerId: LedgerID,
		overrides: Readonly<{ currencyCode?: string; minorUnitExponent?: number }> = {}
	) => {
		const id = newLedgerAccountID();
		await runtime.runPromise(
			AccountRepoTag.use(repository =>
				repository.createAccount(
					Account.fromRequest(id, organizationId, ledgerId, {
						name: `Account ${id.toString()}`,
						normalBalance: "debit",
						currencyCode: overrides.currencyCode ?? "EUR",
						minorUnitExponent: overrides.minorUnitExponent ?? 2,
					})
				)
			)
		);
		return id;
	};

	const accounts = async (
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountIds: readonly AccountId[]
	) =>
		new Map(
			await Promise.all(
				accountIds.map(async accountId => {
					const account = Option.getOrThrow(
						await runtime.runPromise(
							AccountRepoTag.use(repository => repository.getAccount(organizationId, ledgerId, accountId))
						)
					);
					return [accountId.toString(), account] as const;
				})
			)
		);

	afterAll(() => runtime.dispose());

	it.each([
		{ status: "pending" as const, posted: false },
		{ status: "posted" as const, posted: true },
	])("creates a balanced $status Transaction atomically", async ({ status, posted }) => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);

		const transaction = await runRepo(repository =>
			repository.createTransaction(
				organizationId,
				ledgerId,
				newLedgerTransactionID(),
				request(status, [
					{ accountId: debit, direction: "debit", amount: 100 },
					{ accountId: credit, direction: "credit", amount: 100 },
				])
			)
		);
		const byId = await accounts(organizationId, ledgerId, [debit, credit]);

		expect(transaction.status).toBe(status);
		expect(transaction.lockVersion).toBe(1);
		expect(transaction.postedAt === undefined).toBe(!posted);
		expect(Option.getOrThrow(transaction.entries).map(entry => entry.currency)).toEqual([
			{ code: "EUR", minorUnitExponent: 2 },
			{ code: "EUR", minorUnitExponent: 2 },
		]);
		expect(byId.get(debit.toString())).toMatchObject({
			pendingDebits: 100,
			postedDebits: posted ? 100 : 0,
			lockVersion: 2,
		});
		expect(byId.get(credit.toString())).toMatchObject({
			pendingCredits: 100,
			postedCredits: posted ? 100 : 0,
			lockVersion: 2,
		});
	});

	it("returns complete tenant-scoped reads in newest-first order", async () => {
		const owner = await createLedger();
		const other = await createLedger();
		const debit = await createAccount(owner.organizationId, owner.ledgerId);
		const credit = await createAccount(owner.organizationId, owner.ledgerId);
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
		const debit = await createAccount(organizationId, ledgerId);
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
		expect(
			(await accounts(organizationId, ledgerId, [debit])).get(debit.toString())?.pendingDebits
		).toBe(0);
		expect(
			await runRepo(repository =>
				repository.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
			)
		).toHaveLength(0);
	});

	it("updates a Pending Transaction and applies only the net effect", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
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

		const updated = await runRepo(repository =>
			repository.updateTransaction(organizationId, ledgerId, transaction.id, {
				description: "Updated",
				ledgerEntries: [
					{ accountId: debit.toString(), direction: "debit", amount: 40, currencyCode: "EUR" },
					{ accountId: credit.toString(), direction: "credit", amount: 40, currencyCode: "EUR" },
				],
			})
		);
		const byId = await accounts(organizationId, ledgerId, [debit, credit]);

		expect(updated.description).toBe("Updated");
		expect(updated.lockVersion).toBe(2);
		expect(byId.get(debit.toString())).toMatchObject({ pendingDebits: 40, lockVersion: 3 });
		expect(byId.get(credit.toString())).toMatchObject({ pendingCredits: 40, lockVersion: 3 });
	});

	it("posts and voids Pending Transactions exactly once", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
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
		const posted = await createPending();
		const postedAt = DateTime.utc();
		await runRepo(repository =>
			repository.postTransaction(organizationId, ledgerId, posted.id, postedAt)
		);
		await runRepo(repository =>
			repository.postTransaction(organizationId, ledgerId, posted.id, postedAt)
		);
		const voided = await createPending();
		await runRepo(repository =>
			repository.voidTransaction(organizationId, ledgerId, voided.id, DateTime.utc())
		);
		await runRepo(repository =>
			repository.voidTransaction(organizationId, ledgerId, voided.id, DateTime.utc())
		);
		const byId = await accounts(organizationId, ledgerId, [debit, credit]);

		expect(byId.get(debit.toString())).toMatchObject({
			pendingDebits: 25,
			postedDebits: 25,
			lockVersion: 5,
		});
		expect(byId.get(credit.toString())).toMatchObject({
			pendingCredits: 25,
			postedCredits: 25,
			lockVersion: 5,
		});
		const error = await runRepo(repository =>
			Effect.flip(repository.voidTransaction(organizationId, ledgerId, posted.id, DateTime.utc()))
		);
		expect(error).toBeInstanceOf(TransactionLifecycleConflict);
	});

	it("rejects an Entry Currency that does not match its Account", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
		const transactionRequest = request("pending", [
			{ accountId: debit, direction: "debit", amount: 10 },
			{ accountId: credit, direction: "credit", amount: 10 },
		]);
		transactionRequest.ledgerEntries[0]!.currencyCode = "USD";

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

		expect(error).toBeInstanceOf(TransactionValidationFailure);
		expect(
			await runRepo(repository =>
				repository.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
			)
		).toHaveLength(0);
	});

	it("rejects unsafe resulting counters without persisting the Transaction", async () => {
		const { organizationId, ledgerId } = await createLedger();
		const debit = await createAccount(organizationId, ledgerId);
		const credit = await createAccount(organizationId, ledgerId);
		await runRepo(repository =>
			repository.createTransaction(
				organizationId,
				ledgerId,
				newLedgerTransactionID(),
				request("pending", [
					{ accountId: debit, direction: "debit", amount: Number.MAX_SAFE_INTEGER },
					{ accountId: credit, direction: "credit", amount: Number.MAX_SAFE_INTEGER },
				])
			)
		);
		const error = await runRepo(repository =>
			Effect.flip(
				repository.createTransaction(
					organizationId,
					ledgerId,
					newLedgerTransactionID(),
					request("pending", [
						{ accountId: debit, direction: "debit", amount: 1 },
						{ accountId: credit, direction: "credit", amount: 1 },
					])
				)
			)
		);

		expect(error).toBeInstanceOf(TransactionValidationFailure);
		expect(
			await runRepo(repository =>
				repository.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
			)
		).toHaveLength(1);
	});
});
