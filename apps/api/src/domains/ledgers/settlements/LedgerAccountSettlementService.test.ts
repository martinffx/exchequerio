import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Ledger } from "@/domains/ledgers/Ledger";
import { type LedgerService, LedgerServiceTag } from "@/domains/ledgers/LedgerService";
import { LedgerAccount } from "@/domains/ledgers/accounts/LedgerAccount";
import { type AccountService, AccountServiceTag } from "@/domains/ledgers/accounts/AccountService";
import type { LedgerTransaction } from "@/domains/ledgers/transactions/LedgerTransaction";
import { TransactionValidationFailure } from "@/domains/ledgers/transactions/LedgerTransactionErrors";
import {
	type TransactionService,
	TransactionServiceTag,
} from "@/domains/ledgers/transactions/LedgerTransactionService";
import { ConflictError } from "@/lib/errors";
import {
	type LedgerAccountID,
	type LedgerAccountSettlementID,
	type LedgerID,
	type OrgID,
	newLedgerAccountID,
	newLedgerAccountSettlementID,
	newLedgerID,
	newLedgerTransactionID,
	newOrgID,
} from "@/repo/entities/types";

import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import {
	type LedgerAccountSettlementRepo,
	LedgerAccountSettlementRepoTag,
} from "./LedgerAccountSettlementRepo";
import type {
	LedgerAccountSettlementRequest,
	SettlementStatus,
} from "./LedgerAccountSettlementSchema";
import {
	type LedgerAccountSettlementService,
	LedgerAccountSettlementServiceTag,
	ledgerAccountSettlementServiceLayer,
} from "./LedgerAccountSettlementService";

const organizationId = newOrgID();
const ledgerId = newLedgerID();
const settlementId = newLedgerAccountSettlementID();
const settledAccountId = newLedgerAccountID();
const contraAccountId = newLedgerAccountID();

const request = (overrides: Partial<LedgerAccountSettlementRequest> = {}) => ({
	transactionId: newLedgerTransactionID().toString(),
	settledAccountId: settledAccountId.toString(),
	contraAccountId: contraAccountId.toString(),
	status: "drafting" as const,
	description: "Monthly settlement",
	metadata: { caller: "value", settlementId: "caller-value" },
	...overrides,
});

const entity = (
	overrides: Partial<ConstructorParameters<typeof LedgerAccountSettlementEntity>[0]> = {}
) =>
	new LedgerAccountSettlementEntity({
		id: settlementId,
		organizationId,
		settledAccountId,
		contraAccountId,
		amount: 125,
		normalBalance: "debit",
		currency: "USD",
		status: "drafting",
		description: "Monthly settlement",
		metadata: { caller: "value", settlementId: "caller-value" },
		created: new Date("2026-08-01T00:00:00.000Z"),
		updated: new Date("2026-08-01T00:00:00.000Z"),
		...overrides,
	});

const account = (
	id: typeof settledAccountId,
	currency = "USD",
	normalBalance: "debit" | "credit" = "debit"
) =>
	LedgerAccount.fromCreateRequest(id, organizationId, ledgerId, {
		name: id.toString(),
		normalBalance,
		currencyCode: currency,
	});

const unexpected = () => Effect.die(new Error("Unexpected dependency call"));

const makeTest = (
	overrides: {
		repository?: Partial<LedgerAccountSettlementRepo>;
		ledger?: Partial<LedgerService>;
		account?: Partial<AccountService>;
		transaction?: Partial<TransactionService>;
	} = {}
) => {
	const repository: LedgerAccountSettlementRepo = {
		listSettlements: vi.fn(() => Effect.succeed([])),
		getSettlement: vi.fn(() => Effect.succeed(entity())),
		createSettlement: vi.fn(record => Effect.succeed(record)),
		updateSettlement: vi.fn(record => Effect.succeed(record)),
		deleteSettlement: vi.fn(() => Effect.void),
		addEntriesToSettlement: vi.fn(() => Effect.void),
		removeEntriesFromSettlement: vi.fn(() => Effect.void),
		getEntryIds: vi.fn(() => Effect.succeed([])),
		calculateAmount: vi.fn(() => Effect.succeed(125)),
		updateStatus: vi.fn(
			(_organizationId: OrgID, _settlementId: LedgerAccountSettlementID, status: SettlementStatus) =>
				Effect.succeed(entity({ status }))
		),
		...overrides.repository,
	};
	const ledger = {
		listLedgers: unexpected,
		getLedger: vi.fn(() =>
			Effect.succeed(Ledger.fromRequest(ledgerId, organizationId, { name: "Ledger" }))
		),
		createLedger: unexpected,
		updateLedger: unexpected,
		deleteLedger: unexpected,
		...overrides.ledger,
	} as unknown as LedgerService;
	const accounts = {
		listAccounts: unexpected,
		getAccount: vi.fn((_organizationId: OrgID, _ledgerId: LedgerID, id: LedgerAccountID) =>
			Effect.succeed(
				id.toString() === settledAccountId.toString()
					? account(settledAccountId)
					: account(contraAccountId, "USD", "credit")
			)
		),
		createAccount: unexpected,
		updateAccount: unexpected,
		deleteAccount: unexpected,
		...overrides.account,
	} as unknown as AccountService;
	const transaction: TransactionService = {
		listTransactions: unexpected,
		getTransaction: unexpected,
		createTransaction: vi.fn(() =>
			Effect.succeed({ id: newLedgerTransactionID(), status: "posted" } as LedgerTransaction)
		),
		updateTransaction: unexpected,
		postTransaction: unexpected,
		voidTransaction: unexpected,
		...overrides.transaction,
	};
	const layer = ledgerAccountSettlementServiceLayer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(LedgerAccountSettlementRepoTag, repository),
				Layer.succeed(LedgerServiceTag, ledger),
				Layer.succeed(AccountServiceTag, accounts),
				Layer.succeed(TransactionServiceTag, transaction)
			)
		)
	);
	const run = <A, E>(use: (service: LedgerAccountSettlementService) => Effect.Effect<A, E>) =>
		Effect.runPromise(
			LedgerAccountSettlementServiceTag.pipe(Effect.flatMap(use), Effect.provide(layer))
		);
	return { accounts, ledger, repository, run, transaction };
};

afterEach(() => {
	vi.useRealTimers();
});

describe("LedgerAccountSettlementService", () => {
	it("verifies the Ledger before listing Settlements", async () => {
		const calls: string[] = [];
		const test = makeTest({
			ledger: {
				getLedger: vi.fn(() =>
					Effect.sync(() => {
						calls.push("ledger");
						return Ledger.fromRequest(ledgerId, organizationId, { name: "Ledger" });
					})
				),
			},
			repository: {
				listSettlements: vi.fn(() =>
					Effect.sync(() => {
						calls.push("repository");
						return [entity()];
					})
				),
			},
		});

		expect(
			await test.run(service => service.listLedgerAccountSettlements(organizationId, ledgerId, 5, 10))
		).toHaveLength(1);
		expect(calls).toEqual(["ledger", "repository"]);
	});

	it("loads both Accounts and creates with the settled Account currency and Normal Balance", async () => {
		const test = makeTest();
		const result = await test.run(service =>
			service.createLedgerAccountSettlement(organizationId, ledgerId, request())
		);

		expect(test.accounts.getAccount).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({ currency: "USD", normalBalance: "debit", amount: 0 });
		expect(test.repository.createSettlement).toHaveBeenCalledOnce();
	});

	it("starts both Account lookups before either lookup completes", async () => {
		const started: string[] = [];
		let release!: () => void;
		const blocked = new Promise<void>(resolve => {
			release = resolve;
		});
		const test = makeTest({
			account: {
				getAccount: vi.fn((_organizationId: OrgID, _ledgerId: LedgerID, id: LedgerAccountID) =>
					Effect.promise(async () => {
						started.push(id.toString());
						await blocked;
						return id.toString() === settledAccountId.toString()
							? account(settledAccountId)
							: account(contraAccountId, "USD", "credit");
					})
				),
			},
		});

		const result = test.run(service =>
			service.createLedgerAccountSettlement(organizationId, ledgerId, request())
		);
		try {
			await vi.waitFor(() => expect(started).toHaveLength(2));
		} finally {
			release();
		}
		await expect(result).resolves.toMatchObject({ currency: "USD", normalBalance: "debit" });
	});

	it("rejects mismatched Account currencies before persistence", async () => {
		const test = makeTest({
			account: {
				getAccount: vi.fn((_organizationId: OrgID, _ledgerId: LedgerID, id: LedgerAccountID) =>
					Effect.succeed(
						id.toString() === settledAccountId.toString()
							? account(settledAccountId)
							: account(contraAccountId, "EUR", "credit")
					)
				),
			},
		});

		await expect(
			test.run(service => service.createLedgerAccountSettlement(organizationId, ledgerId, request()))
		).rejects.toThrow(ConflictError);
		expect(test.repository.createSettlement).not.toHaveBeenCalled();
	});

	it("validates Accounts before loading an update and replaces Created Time", async () => {
		const calls: string[] = [];
		const now = new Date("2026-08-29T12:00:00.000Z");
		vi.useFakeTimers();
		vi.setSystemTime(now);
		const test = makeTest({
			account: {
				getAccount: vi.fn((_organizationId: OrgID, _ledgerId: LedgerID, id: LedgerAccountID) =>
					Effect.sync(() => {
						calls.push("account");
						return id.toString() === settledAccountId.toString()
							? account(settledAccountId)
							: account(contraAccountId, "USD", "credit");
					})
				),
			},
			repository: {
				getSettlement: vi.fn(() =>
					Effect.sync(() => {
						calls.push("settlement");
						return entity();
					})
				),
			},
		});

		const result = await test.run(service =>
			service.updateLedgerAccountSettlement(organizationId, ledgerId, settlementId, request())
		);
		expect(calls).toEqual(["account", "account", "settlement"]);
		expect(result.created).toEqual(now);
		expect(result.updated).toEqual(now);
	});

	it.each([
		["drafting", "processing"],
		["processing", "drafting"],
		["pending", "drafting"],
		["posted", "archiving"],
		["archiving", "archived"],
	] as const)("preserves the %s to %s lifecycle edge", async (current, target) => {
		const test = makeTest({
			repository: { getSettlement: vi.fn(() => Effect.succeed(entity({ status: current }))) },
		});

		expect(
			await test.run(service =>
				service.transitionSettlementStatus(organizationId, ledgerId, settlementId, target)
			)
		).toMatchObject({ status: target });
	});

	it("rejects invalid lifecycle transitions", async () => {
		const test = makeTest();
		await expect(
			test.run(service =>
				service.transitionSettlementStatus(organizationId, ledgerId, settlementId, "posted")
			)
		).rejects.toThrow(ConflictError);
		expect(test.repository.updateStatus).not.toHaveBeenCalled();
	});

	it("attempts the drafting-only amount write and stops when it fails", async () => {
		const test = makeTest({
			repository: {
				getSettlement: vi.fn(() => Effect.succeed(entity({ status: "processing" }))),
				updateSettlement: vi.fn(() => Effect.fail(new ConflictError("drafting only"))),
			},
		});

		await expect(
			test.run(service =>
				service.transitionSettlementStatus(organizationId, ledgerId, settlementId, "pending")
			)
		).rejects.toThrow(ConflictError);
		expect(test.repository.calculateAmount).toHaveBeenCalledWith(settlementId);
		expect(test.repository.updateStatus).not.toHaveBeenCalled();
	});

	it("creates the Posted Transaction before linking and preserves posting fields", async () => {
		const calls: string[] = [];
		const transactionId = newLedgerTransactionID();
		const test = makeTest({
			repository: {
				getSettlement: vi.fn(() => Effect.succeed(entity({ status: "pending" }))),
				updateSettlement: vi.fn((record: LedgerAccountSettlementEntity) =>
					Effect.sync(() => {
						calls.push("link");
						return record;
					})
				),
				updateStatus: vi.fn(
					(_organizationId: OrgID, _id: LedgerAccountSettlementID, status: SettlementStatus) =>
						Effect.sync(() => {
							calls.push("status");
							return entity({ status });
						})
				),
			},
			transaction: {
				createTransaction: vi.fn((_organizationId, _ledgerId, _key, _request) =>
					Effect.sync(() => {
						calls.push("transaction");
						return { id: transactionId, status: "posted" } as LedgerTransaction;
					})
				),
			},
		});

		await test.run(service =>
			service.transitionSettlementStatus(organizationId, ledgerId, settlementId, "posted")
		);
		expect(calls).toEqual(["transaction", "link", "status"]);
		expect(test.transaction.createTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			`settlement:${settlementId.toString()}`,
			expect.objectContaining({
				status: "posted",
				description: "Monthly settlement",
				metadata: { caller: "value", settlementId: settlementId.toString() },
				ledgerEntries: [
					expect.objectContaining({
						accountId: settledAccountId.toString(),
						direction: "credit",
						amount: 125,
						currencyCode: "USD",
					}),
					expect.objectContaining({
						accountId: contraAccountId.toString(),
						direction: "debit",
						amount: 125,
						currencyCode: "USD",
					}),
				],
			})
		);
	});

	it("keeps a created Transaction committed when linking fails", async () => {
		const test = makeTest({
			repository: {
				getSettlement: vi.fn(() => Effect.succeed(entity({ status: "pending" }))),
				updateSettlement: vi.fn(() => Effect.fail(new ConflictError("drafting only"))),
			},
		});
		await expect(
			test.run(service =>
				service.transitionSettlementStatus(organizationId, ledgerId, settlementId, "posted")
			)
		).rejects.toThrow(ConflictError);
		expect(test.transaction.createTransaction).toHaveBeenCalledOnce();
		expect(test.repository.updateStatus).not.toHaveBeenCalled();
	});

	it("does not link or change status when Transaction creation fails or is not Posted", async () => {
		for (const createTransaction of [
			vi.fn(() => Effect.fail(new TransactionValidationFailure("transaction failed"))),
			vi.fn(() =>
				Effect.succeed({ id: newLedgerTransactionID(), status: "pending" } as LedgerTransaction)
			),
		]) {
			const test = makeTest({
				repository: {
					getSettlement: vi.fn(() => Effect.succeed(entity({ status: "pending" }))),
				},
				transaction: { createTransaction },
			});
			await expect(
				test.run(service =>
					service.transitionSettlementStatus(organizationId, ledgerId, settlementId, "posted")
				)
			).rejects.toThrow();
			expect(test.repository.updateSettlement).not.toHaveBeenCalled();
			expect(test.repository.updateStatus).not.toHaveBeenCalled();
		}
	});

	it("rolls Pending back with only the existing status update", async () => {
		const test = makeTest({
			repository: { getSettlement: vi.fn(() => Effect.succeed(entity({ status: "pending" }))) },
		});
		await test.run(service =>
			service.transitionSettlementStatus(organizationId, ledgerId, settlementId, "drafting")
		);
		expect(test.repository.updateStatus).toHaveBeenCalledOnce();
		expect(test.repository.removeEntriesFromSettlement).not.toHaveBeenCalled();
	});
});
