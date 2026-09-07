import { NotFoundError } from "@/lib/errors";
import { AssetServiceTag, type AssetService } from "@/domains/assets/AssetService";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { Settings } from "luxon";
import { TypeID } from "typeid-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountVersionConflict } from "@/domains/ledgers/accounts";
import { type LedgerService, LedgerServiceTag } from "@/domains/ledgers/LedgerService";
import {
	newLedgerAccountID,
	newLedgerTransactionID,
	type LedgerAccountID,
	type LedgerID,
	type OrgID,
} from "@/lib/ids";

import { LedgerTransaction } from "./LedgerTransaction";
import {
	TransactionConcurrencyFailure,
	TransactionPersistenceFailure,
	TransactionPersistenceDecodingFailure,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
	TransactionVersionConflict,
} from "./LedgerTransactionErrors";
import {
	IdempotencyPending,
	type IdempotencyService,
	IdempotencyServiceTag,
	IdempotencyUnavailable,
} from "@/lib/IdempotencyService";
import { type LedgerTransactionRepo, LedgerTransactionRepoTag } from "./LedgerTransactionRepo";
import type { TransactionCreateRequest, TransactionUpdateRequest } from "./LedgerTransactionSchema";
import {
	type TransactionService,
	TransactionServiceTag,
	transactionServiceLayer,
} from "./LedgerTransactionService";

const organizationId = new TypeID("org") as OrgID;
const ledgerId = new TypeID("lgr") as LedgerID;
const debitAccountId = new TypeID("lat") as LedgerAccountID;
const creditAccountId = new TypeID("lat") as LedgerAccountID;
const transactionId = newLedgerTransactionID();
const idempotencyKey = "create-42";

const createRequest: TransactionCreateRequest = {
	status: "pending",
	description: "Transfer",
	ledgerEntries: [
		{ accountId: debitAccountId.toString(), direction: "debit", amount: "100", assetCode: "EUR" },
		{ accountId: creditAccountId.toString(), direction: "credit", amount: "100", assetCode: "EUR" },
	],
};

const updateRequest: TransactionUpdateRequest = {
	description: "Updated",
	ledgerEntries: createRequest.ledgerEntries,
};

const transaction = (() => {
	const previousNow = Settings.now;
	Settings.now = () => Date.parse("2026-08-15T08:00:00.000Z");
	try {
		return Effect.runSync(
			LedgerTransaction.fromCreateRequest(transactionId, organizationId, ledgerId, {
				...createRequest,
				ledgerEntries: createRequest.ledgerEntries.map(entry => ({
					...entry,
					assetId: "ast_00000000000000000000000001",
					assetCode: "EUR",
					minorUnitExponent: 2,
				})),
			})
		);
	} finally {
		Settings.now = previousNow;
	}
})();
const some = Option.some;
const foundTransaction = some(transaction);

afterEach(() => vi.restoreAllMocks());

const repository = {
	getSettlementTransaction: vi.fn<LedgerTransactionRepo["getSettlementTransaction"]>(() =>
		Effect.succeed(foundTransaction)
	),
	createSettlementTransaction: vi.fn<LedgerTransactionRepo["createSettlementTransaction"]>(() =>
		Effect.succeed(transaction)
	),
	postSettlementTransaction: vi.fn<LedgerTransactionRepo["postSettlementTransaction"]>(() =>
		Effect.succeed(transaction)
	),
	voidSettlementTransaction: vi.fn<LedgerTransactionRepo["voidSettlementTransaction"]>(() =>
		Effect.succeed(transaction)
	),
	listTransactions: vi.fn<LedgerTransactionRepo["listTransactions"]>(() =>
		Effect.succeed([transaction])
	),
	getTransaction: vi.fn<LedgerTransactionRepo["getTransaction"]>(() =>
		Effect.succeed(foundTransaction)
	),
	createTransaction: vi.fn<LedgerTransactionRepo["createTransaction"]>(() =>
		Effect.succeed(transaction)
	),
	updateTransaction: vi.fn<LedgerTransactionRepo["updateTransaction"]>(() =>
		Effect.succeed(transaction)
	),
	postTransaction: vi.fn<LedgerTransactionRepo["postTransaction"]>(() =>
		Effect.succeed(transaction)
	),
	voidTransaction: vi.fn<LedgerTransactionRepo["voidTransaction"]>(() =>
		Effect.succeed(transaction)
	),
} satisfies LedgerTransactionRepo;
const idempotency = {
	claim: vi.fn<IdempotencyService["claim"]>(() => Effect.succeed(Option.none())),
	complete: vi.fn<IdempotencyService["complete"]>(() => Effect.void),
	release: vi.fn<IdempotencyService["release"]>(() => Effect.void),
} satisfies IdempotencyService;
const ledgerService = {
	getLedger: vi.fn<LedgerService["getLedger"]>(() => Effect.succeed({} as never)),
} as unknown as LedgerService;
const assets = {
	resolveAssets: vi.fn<AssetService["resolveAssets"]>((_org, selectors) =>
		Effect.succeed(
			selectors.map(() => ({
				assetId: "ast_00000000000000000000000001",
				assetCode: "EUR",
				minorUnitExponent: 2,
			}))
		)
	),
};
const dependencies = Layer.mergeAll(
	Layer.succeed(AssetServiceTag, assets as unknown as AssetService),
	Layer.succeed(LedgerTransactionRepoTag, repository),
	Layer.succeed(IdempotencyServiceTag, idempotency),
	Layer.succeed(LedgerServiceTag, ledgerService)
);
const layer = transactionServiceLayer.pipe(Layer.provide(dependencies));
const runtime = ManagedRuntime.make(layer);
let service: TransactionService;
beforeAll(async () => {
	service = await runtime.runPromise(TransactionServiceTag);
});
beforeEach(() => {
	vi.resetAllMocks();
});
afterAll(() => runtime.dispose());

describe("TransactionService", () => {
	it("creates a Transaction entity under an action-scoped idempotency claim", async () => {
		await runtime.runPromise(
			service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
		);

		expect(idempotency.claim).toHaveBeenCalledWith(
			organizationId,
			"transactions.create",
			idempotencyKey
		);
		expect(repository.createTransaction).toHaveBeenCalledWith(expect.any(LedgerTransaction));
	});

	it("reloads a Transaction using the stored idempotency ID", async () => {
		idempotency.claim.mockReturnValue(
			Effect.succeed(Option.fromUndefinedOr(transactionId.toString()))
		);

		const found = await runtime.runPromise(
			service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
		);

		expect(found).toBe(transaction);
		expect(assets.resolveAssets).not.toHaveBeenCalled();
		expect(repository.getTransaction).toHaveBeenCalledWith(organizationId, ledgerId, transactionId);
		expect(repository.createTransaction).not.toHaveBeenCalled();
	});

	it("propagates shared pending and unavailable idempotency failures", async () => {
		for (const failure of [
			new IdempotencyPending(),
			new IdempotencyUnavailable(new Error("offline")),
		]) {
			idempotency.claim.mockReturnValueOnce(Effect.fail(failure));
			await expect(
				runtime.runPromise(
					service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
				)
			).rejects.toBe(failure);
		}
	});

	it("completes the claim only after creation and preserves it if completion fails", async () => {
		const failure = new IdempotencyUnavailable(new Error("offline"));
		idempotency.complete.mockReturnValueOnce(Effect.fail(failure));
		await expect(
			runtime.runPromise(
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).rejects.toBe(failure);
		expect(idempotency.complete).toHaveBeenCalledWith(
			organizationId,
			"transactions.create",
			idempotencyKey,
			transaction.id.toString()
		);
		expect(idempotency.release).not.toHaveBeenCalled();
	});
	it("releases a rejected write without hiding its error when release fails", async () => {
		const failure = new TransactionValidationFailure("invalid accounts");
		repository.createTransaction.mockReturnValueOnce(Effect.fail(failure));
		idempotency.release.mockReturnValueOnce(
			Effect.fail(new IdempotencyUnavailable(new Error("offline")))
		);
		await expect(
			runtime.runPromise(
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).rejects.toBe(failure);
		expect(idempotency.release).toHaveBeenCalledWith(
			organizationId,
			"transactions.create",
			idempotencyKey
		);
		expect(idempotency.complete).not.toHaveBeenCalled();
	});
	it.each([
		new TransactionPersistenceFailure(new Error("commit outcome unknown")),
		new TransactionPersistenceDecodingFailure(new Error("unreadable result")),
		new TransactionRepositoryUnavailable(new Error("disconnected")),
	])("retains claims on uncertain writes: %s", async failure => {
		repository.createTransaction.mockReturnValueOnce(Effect.fail(failure));
		repository.updateTransaction.mockReturnValueOnce(Effect.fail(failure));
		repository.postTransaction.mockReturnValueOnce(Effect.fail(failure));
		repository.voidTransaction.mockReturnValueOnce(Effect.fail(failure));
		for (const use of [
			(s: TransactionService) =>
				s.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest),
			(s: TransactionService) =>
				s.updateTransaction(organizationId, ledgerId, transactionId, idempotencyKey, updateRequest),
			(s: TransactionService) =>
				s.postTransaction(organizationId, ledgerId, transactionId, idempotencyKey),
			(s: TransactionService) =>
				s.voidTransaction(organizationId, ledgerId, transactionId, idempotencyKey),
		])
			await expect(runtime.runPromise(use(service))).rejects.toBe(failure);
		expect(idempotency.release).not.toHaveBeenCalled();
		expect(idempotency.complete).not.toHaveBeenCalled();
	});

	it("retries hot-Account OCC conflicts", async () => {
		let attempts = 0;
		repository.createTransaction.mockImplementation(() => {
			attempts += 1;
			return attempts < 5 ? Effect.fail(new AccountVersionConflict()) : Effect.succeed(transaction);
		});

		await expect(
			runtime.runPromise(
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).resolves.toBe(transaction);
		expect(repository.createTransaction).toHaveBeenCalledTimes(5);
		expect(assets.resolveAssets).toHaveBeenCalledOnce();
		const calls = repository.createTransaction.mock.calls;
		expect(calls.every(call => call[0] === calls[0]?.[0])).toBe(true);
	});

	it("retries typed PostgreSQL concurrency failures without inspecting their cause", async () => {
		repository.createTransaction
			.mockReturnValueOnce(Effect.fail(new TransactionConcurrencyFailure(new Error("opaque"))))
			.mockReturnValueOnce(Effect.succeed(transaction));

		await expect(
			runtime.runPromise(
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).resolves.toBe(transaction);
		expect(repository.createTransaction).toHaveBeenCalledTimes(2);
	});

	it("rejects more than 200 distinct Accounts before claiming", async () => {
		const ledgerEntries = Array.from({ length: 201 }, (_, index) => ({
			accountId: newLedgerAccountID().toString(),
			direction: index === 0 ? ("debit" as const) : ("credit" as const),
			amount: "1",
			assetCode: "EUR",
		}));

		await expect(
			runtime.runPromise(
				service.createTransaction(organizationId, ledgerId, idempotencyKey, {
					...createRequest,
					ledgerEntries,
				})
			)
		).rejects.toBeInstanceOf(TransactionValidationFailure);
		expect(repository.createTransaction).not.toHaveBeenCalled();
		expect(idempotency.claim).not.toHaveBeenCalled();
	});

	it("updates through an action-scoped idempotency claim", async () => {
		await runtime.runPromise(
			service.updateTransaction(organizationId, ledgerId, transactionId, idempotencyKey, updateRequest)
		);

		expect(repository.updateTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			transactionId,
			{
				...updateRequest,
				ledgerEntries: updateRequest.ledgerEntries.map(entry => ({
					...entry,
					assetId: "ast_00000000000000000000000001",
					minorUnitExponent: 2,
				})),
			},
			expect.anything(),
			expect.any(Array)
		);
		expect(idempotency.claim).toHaveBeenCalledWith(
			organizationId,
			"transactions.update",
			idempotencyKey
		);
	});

	it("retries Transaction OCC conflicts", async () => {
		repository.updateTransaction
			.mockReturnValueOnce(Effect.fail(new TransactionVersionConflict()))
			.mockReturnValueOnce(Effect.succeed(transaction));

		await expect(
			runtime.runPromise(
				service.updateTransaction(
					organizationId,
					ledgerId,
					transactionId,
					idempotencyKey,
					updateRequest
				)
			)
		).resolves.toBe(transaction);
		expect(repository.updateTransaction).toHaveBeenCalledTimes(2);
		const calls = repository.updateTransaction.mock.calls;
		expect(calls[0]?.[4]).toBe(calls[1]?.[4]);
		expect(calls[0]?.[5]).toBe(calls[1]?.[5]);
	});

	it("requires the Ledger before listing and gets Transactions directly", async () => {
		await runtime.runPromise(
			service.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
		);
		await runtime.runPromise(service.getTransaction(organizationId, ledgerId, transactionId));

		expect(repository.listTransactions).toHaveBeenCalledWith(organizationId, ledgerId, {
			offset: 0,
			limit: 20,
		});
		expect(ledgerService.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
		expect(repository.getTransaction).toHaveBeenCalledWith(organizationId, ledgerId, transactionId);
		expect(idempotency.claim).not.toHaveBeenCalled();
	});
});

it("releases a fresh claim when Asset resolution fails", async () => {
	const failure = new NotFoundError("Asset not found");
	assets.resolveAssets.mockReturnValueOnce(Effect.fail(failure));
	await expect(
		runtime.runPromise(
			service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
		)
	).rejects.toBe(failure);
	expect(idempotency.release).toHaveBeenCalledWith(
		organizationId,
		"transactions.create",
		idempotencyKey
	);
	expect(repository.createTransaction).not.toHaveBeenCalled();
});
