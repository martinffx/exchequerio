import { Effect, Layer, Option, Result } from "effect";
import { Settings } from "luxon";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountVersionConflict } from "@/domains/ledgers/accounts";
import { type LedgerService, LedgerServiceTag } from "@/domains/ledgers/LedgerService";
import {
	newLedgerAccountID,
	newLedgerTransactionID,
	type LedgerAccountID,
	type LedgerID,
	type OrgID,
} from "@/repo/entities/types";

import { LedgerTransaction } from "./LedgerTransaction";
import {
	TransactionCreationPending,
	TransactionConcurrencyFailure,
	TransactionIdempotencyUnavailable,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
	TransactionVersionConflict,
} from "./LedgerTransactionErrors";
import {
	type TransactionIdemService,
	TransactionIdemServiceTag,
} from "./LedgerTransactionIdemService";
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
		{ accountId: debitAccountId.toString(), direction: "debit", amount: 100, currencyCode: "EUR" },
		{ accountId: creditAccountId.toString(), direction: "credit", amount: 100, currencyCode: "EUR" },
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
			LedgerTransaction.fromCreateRequest(transactionId, organizationId, ledgerId, createRequest)
		);
	} finally {
		Settings.now = previousNow;
	}
})();
const some = Option.some;
const foundTransaction = some(transaction);

afterEach(() => vi.restoreAllMocks());

const harness = () => {
	const repository = {
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
		claimTransactionId: vi.fn<TransactionIdemService["claimTransactionId"]>(() =>
			Effect.succeed(Result.succeed(undefined))
		),
		getTransactionId: vi.fn<TransactionIdemService["getTransactionId"]>(() =>
			Effect.succeed(transactionId)
		),
		completeTransactionId: vi.fn<TransactionIdemService["completeTransactionId"]>(() => Effect.void),
		releaseTransactionId: vi.fn<TransactionIdemService["releaseTransactionId"]>(() => Effect.void),
	} satisfies TransactionIdemService;
	const ledgerService = {
		getLedger: vi.fn<LedgerService["getLedger"]>(() => Effect.succeed({} as never)),
	} as unknown as LedgerService;
	const dependencies = Layer.mergeAll(
		Layer.succeed(LedgerTransactionRepoTag, repository),
		Layer.succeed(TransactionIdemServiceTag, idempotency),
		Layer.succeed(LedgerServiceTag, ledgerService)
	);
	const layer = transactionServiceLayer.pipe(Layer.provide(dependencies));
	const run = <A, E>(use: (service: TransactionService) => Effect.Effect<A, E>) =>
		Effect.runPromise(TransactionServiceTag.use(use).pipe(Effect.provide(layer)));
	return { idempotency, ledgerService, repository, run };
};

describe("TransactionService", () => {
	it("creates the Transaction after claiming pending and then stores its ID", async () => {
		const h = harness();

		await h.run(service =>
			service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
		);

		expect(h.idempotency.claimTransactionId).toHaveBeenCalledWith(organizationId, idempotencyKey);
		expect(h.repository.createTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			expect.anything(),
			createRequest,
			expect.anything(),
			expect.any(Array)
		);
		expect(h.idempotency.completeTransactionId).toHaveBeenCalledWith(
			organizationId,
			idempotencyKey,
			transaction.id
		);
		expect(h.idempotency.releaseTransactionId).not.toHaveBeenCalled();
	});

	it("loads an existing claim without creating another Transaction", async () => {
		const h = harness();
		h.idempotency.claimTransactionId.mockReturnValue(Effect.succeed(Result.fail(transactionId)));

		const found = await h.run(service =>
			service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
		);

		expect(found).toBe(transaction);
		expect(h.repository.getTransaction).toHaveBeenCalledWith(organizationId, ledgerId, transactionId);
		expect(h.repository.createTransaction).not.toHaveBeenCalled();
	});

	it("reports an unresolved pending claim as a retryable conflict after four checks", async () => {
		const h = harness();
		h.idempotency.claimTransactionId.mockReturnValue(Effect.succeed(Result.fail(undefined)));
		h.idempotency.getTransactionId.mockReturnValue(Effect.succeed(undefined));

		await expect(
			h.run(service =>
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).rejects.toMatchObject({
			constructor: TransactionCreationPending,
			retryable: true,
			statusCode: 409,
		});
		expect(h.idempotency.getTransactionId).toHaveBeenCalledTimes(4);
		expect(h.repository.createTransaction).not.toHaveBeenCalled();
		expect(h.repository.getTransaction).not.toHaveBeenCalled();
	});

	it("loads the Transaction when a pending claim completes during the bounded wait", async () => {
		const h = harness();
		h.idempotency.claimTransactionId.mockReturnValue(Effect.succeed(Result.fail(undefined)));
		h.idempotency.getTransactionId
			.mockReturnValueOnce(Effect.succeed(undefined))
			.mockReturnValueOnce(Effect.succeed(transactionId));

		await expect(
			h.run(service =>
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).resolves.toBe(transaction);
		expect(h.idempotency.getTransactionId).toHaveBeenCalledTimes(2);
		expect(h.repository.getTransaction).toHaveBeenCalledWith(organizationId, ledgerId, transactionId);
	});

	it("releases its claim when creation fails", async () => {
		const h = harness();
		const failure = new TransactionValidationFailure("invalid");
		h.repository.createTransaction.mockReturnValue(Effect.fail(failure));

		await expect(
			h.run(service =>
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).rejects.toBe(failure);
		expect(h.idempotency.releaseTransactionId).toHaveBeenCalledWith(organizationId, idempotencyKey);
	});

	it("retains its pending claim when repository availability is uncertain", async () => {
		const h = harness();
		const failure = new TransactionRepositoryUnavailable(new Error("offline"));
		h.repository.createTransaction.mockReturnValue(Effect.fail(failure));

		await expect(
			h.run(service =>
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).rejects.toBe(failure);
		expect(h.idempotency.releaseTransactionId).not.toHaveBeenCalled();
		expect(h.idempotency.completeTransactionId).not.toHaveBeenCalled();
	});

	it("retains its pending claim when storing the committed Transaction ID fails", async () => {
		const h = harness();
		const failure = new TransactionIdempotencyUnavailable(new Error("offline"));
		h.idempotency.completeTransactionId.mockReturnValue(Effect.fail(failure));

		await expect(
			h.run(service =>
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).rejects.toBe(failure);
		expect(h.repository.createTransaction).toHaveBeenCalledOnce();
		expect(h.idempotency.releaseTransactionId).not.toHaveBeenCalled();
	});

	it("retries hot-Account OCC conflicts", async () => {
		const h = harness();
		let attempts = 0;
		h.repository.createTransaction.mockImplementation(() => {
			attempts += 1;
			return attempts < 5 ? Effect.fail(new AccountVersionConflict()) : Effect.succeed(transaction);
		});

		await expect(
			h.run(service =>
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).resolves.toBe(transaction);
		expect(h.repository.createTransaction).toHaveBeenCalledTimes(5);
		const calls = h.repository.createTransaction.mock.calls;
		expect(calls.every(call => call[4] === calls[0]?.[4])).toBe(true);
		expect(calls.every(call => call[5] === calls[0]?.[5])).toBe(true);
		expect(h.idempotency.releaseTransactionId).not.toHaveBeenCalled();
	});

	it("retries typed PostgreSQL concurrency failures without inspecting their cause", async () => {
		const h = harness();
		h.repository.createTransaction
			.mockReturnValueOnce(Effect.fail(new TransactionConcurrencyFailure(new Error("opaque"))))
			.mockReturnValueOnce(Effect.succeed(transaction));

		await expect(
			h.run(service =>
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).resolves.toBe(transaction);
		expect(h.repository.createTransaction).toHaveBeenCalledTimes(2);
	});

	it("rejects more than 200 distinct Accounts and releases the claim", async () => {
		const h = harness();
		const ledgerEntries = Array.from({ length: 201 }, (_, index) => ({
			accountId: newLedgerAccountID().toString(),
			direction: index === 0 ? ("debit" as const) : ("credit" as const),
			amount: 1,
			currencyCode: "EUR",
		}));

		await expect(
			h.run(service =>
				service.createTransaction(organizationId, ledgerId, idempotencyKey, {
					...createRequest,
					ledgerEntries,
				})
			)
		).rejects.toBeInstanceOf(TransactionValidationFailure);
		expect(h.repository.createTransaction).not.toHaveBeenCalled();
		expect(h.idempotency.releaseTransactionId).toHaveBeenCalledWith(organizationId, idempotencyKey);
	});

	it("updates through the repository without touching idempotency", async () => {
		const h = harness();

		await h.run(service =>
			service.updateTransaction(organizationId, ledgerId, transactionId, updateRequest)
		);

		expect(h.repository.updateTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			transactionId,
			updateRequest,
			expect.anything(),
			expect.any(Array)
		);
		expect(h.idempotency.claimTransactionId).not.toHaveBeenCalled();
		expect(h.idempotency.releaseTransactionId).not.toHaveBeenCalled();
		expect(h.idempotency.completeTransactionId).not.toHaveBeenCalled();
	});

	it("retries Transaction OCC conflicts", async () => {
		const h = harness();
		h.repository.updateTransaction
			.mockReturnValueOnce(Effect.fail(new TransactionVersionConflict()))
			.mockReturnValueOnce(Effect.succeed(transaction));

		await expect(
			h.run(service =>
				service.updateTransaction(organizationId, ledgerId, transactionId, updateRequest)
			)
		).resolves.toBe(transaction);
		expect(h.repository.updateTransaction).toHaveBeenCalledTimes(2);
		const calls = h.repository.updateTransaction.mock.calls;
		expect(calls[0]?.[4]).toBe(calls[1]?.[4]);
		expect(calls[0]?.[5]).toBe(calls[1]?.[5]);
	});

	it("requires the Ledger before listing and gets Transactions directly", async () => {
		const h = harness();

		await h.run(service =>
			service.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
		);
		await h.run(service => service.getTransaction(organizationId, ledgerId, transactionId));

		expect(h.repository.listTransactions).toHaveBeenCalledWith(organizationId, ledgerId, {
			offset: 0,
			limit: 20,
		});
		expect(h.ledgerService.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
		expect(h.repository.getTransaction).toHaveBeenCalledWith(organizationId, ledgerId, transactionId);
		expect(h.idempotency.claimTransactionId).not.toHaveBeenCalled();
	});
});
