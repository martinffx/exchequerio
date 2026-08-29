import { Effect, Layer, Option, Result } from "effect";
import { Settings } from "luxon";
import { TypeID } from "typeid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountVersionConflict } from "@/ledgers/accounts";
import {
	newLedgerAccountID,
	newLedgerTransactionID,
	type LedgerAccountID,
	type LedgerID,
	type OrgID,
} from "@/repo/entities/types";

import { LedgerTransaction } from "./domain/LedgerTransaction";
import {
	TransactionCreationPending,
	TransactionValidationFailure,
	TransactionVersionConflict,
} from "./TransactionErrors";
import { type TransactionIdemService, TransactionIdemServiceTag } from "./TransactionIdemService";
import { type LedgerTransactionRepo, LedgerTransactionRepoTag } from "./LedgerTransactionRepo";
import type { TransactionCreateRequest, TransactionUpdateRequest } from "./TransactionSchema";
import {
	type TransactionService,
	TransactionServiceTag,
	transactionServiceLayer,
} from "./TransactionService";

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
			Effect.succeed(Result.succeed(transactionId))
		),
		releaseTransactionId: vi.fn<TransactionIdemService["releaseTransactionId"]>(() => Effect.void),
	} satisfies TransactionIdemService;
	const dependencies = Layer.merge(
		Layer.succeed(LedgerTransactionRepoTag, repository),
		Layer.succeed(TransactionIdemServiceTag, idempotency)
	);
	const layer = transactionServiceLayer.pipe(Layer.provide(dependencies));
	const run = <A, E>(use: (service: TransactionService) => Effect.Effect<A, E>) =>
		Effect.runPromise(TransactionServiceTag.use(use).pipe(Effect.provide(layer)));
	return { idempotency, repository, run };
};

describe("TransactionService", () => {
	it("passes the claimed Transaction ID into repository creation", async () => {
		const h = harness();

		await h.run(service =>
			service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
		);

		expect(h.idempotency.claimTransactionId).toHaveBeenCalledWith(organizationId, idempotencyKey);
		expect(h.repository.createTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			transactionId,
			createRequest
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

	it("reports an unresolved existing claim as retryable service unavailability", async () => {
		const h = harness();
		h.idempotency.claimTransactionId.mockReturnValue(Effect.succeed(Result.fail(transactionId)));
		h.repository.getTransaction.mockReturnValue(Effect.succeed(Option.none()));

		await expect(
			h.run(service =>
				service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
			)
		).rejects.toMatchObject({
			constructor: TransactionCreationPending,
			retryable: true,
			statusCode: 503,
		});
		expect(h.repository.createTransaction).not.toHaveBeenCalled();
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
		expect(h.idempotency.releaseTransactionId).toHaveBeenCalledWith(
			organizationId,
			idempotencyKey,
			transactionId
		);
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
		expect(h.idempotency.releaseTransactionId).not.toHaveBeenCalled();
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
		expect(h.idempotency.releaseTransactionId).toHaveBeenCalledWith(
			organizationId,
			idempotencyKey,
			transactionId
		);
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
			updateRequest
		);
		expect(h.idempotency.claimTransactionId).not.toHaveBeenCalled();
		expect(h.idempotency.releaseTransactionId).not.toHaveBeenCalled();
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
	});

	it("lists and gets directly from the repository", async () => {
		const h = harness();

		await h.run(service =>
			service.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
		);
		await h.run(service => service.getTransaction(organizationId, ledgerId, transactionId));

		expect(h.repository.listTransactions).toHaveBeenCalledWith(organizationId, ledgerId, {
			offset: 0,
			limit: 20,
		});
		expect(h.repository.getTransaction).toHaveBeenCalledWith(organizationId, ledgerId, transactionId);
		expect(h.idempotency.claimTransactionId).not.toHaveBeenCalled();
	});
});
