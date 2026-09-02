import { Effect, Layer, Option } from "effect";
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
	TransactionConcurrencyFailure,
	TransactionValidationFailure,
	TransactionVersionConflict,
} from "./LedgerTransactionErrors";
import {
	IdempotencyPending,
	type IdempotencyService,
	IdempotencyServiceTag,
	IdempotencyUnavailable,
	type IdempotentOperation,
} from "@/services/IdempotencyService";
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
	const idempotencyRun = vi.fn(
		(operation: IdempotentOperation<unknown, unknown, unknown>) => operation.execute
	);
	const idempotency: IdempotencyService = {
		run<A, E, R>(operation: IdempotentOperation<A, E, R>) {
			return idempotencyRun(
				operation as unknown as IdempotentOperation<unknown, unknown, unknown>
			) as Effect.Effect<A, E | IdempotencyPending | IdempotencyUnavailable, R>;
		},
	};
	const ledgerService = {
		getLedger: vi.fn<LedgerService["getLedger"]>(() => Effect.succeed({} as never)),
	} as unknown as LedgerService;
	const dependencies = Layer.mergeAll(
		Layer.succeed(LedgerTransactionRepoTag, repository),
		Layer.succeed(IdempotencyServiceTag, idempotency),
		Layer.succeed(LedgerServiceTag, ledgerService)
	);
	const layer = transactionServiceLayer.pipe(Layer.provide(dependencies));
	const run = <A, E>(use: (service: TransactionService) => Effect.Effect<A, E>) =>
		Effect.runPromise(TransactionServiceTag.use(use).pipe(Effect.provide(layer)));
	return { idempotencyRun, ledgerService, repository, run };
};

describe("TransactionService", () => {
	it("creates a Transaction entity under an action-scoped idempotency claim", async () => {
		const h = harness();

		await h.run(service =>
			service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
		);

		expect(h.idempotencyRun).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId,
				action: "transactions.create",
				key: idempotencyKey,
			})
		);
		expect(h.repository.createTransaction).toHaveBeenCalledWith(expect.any(LedgerTransaction));
	});

	it("lets the shared idempotency service replay a Transaction by stored ID", async () => {
		const h = harness();
		h.idempotencyRun.mockImplementation(operation => operation.replay(transactionId.toString()));

		const found = await h.run(service =>
			service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
		);

		expect(found).toBe(transaction);
		expect(h.repository.getTransaction).toHaveBeenCalledWith(organizationId, ledgerId, transactionId);
		expect(h.repository.createTransaction).not.toHaveBeenCalled();
	});

	it("propagates shared pending and unavailable idempotency failures", async () => {
		const h = harness();
		for (const failure of [
			new IdempotencyPending(),
			new IdempotencyUnavailable(new Error("offline")),
		]) {
			h.idempotencyRun.mockReturnValueOnce(Effect.fail(failure));
			await expect(
				h.run(service =>
					service.createTransaction(organizationId, ledgerId, idempotencyKey, createRequest)
				)
			).rejects.toBe(failure);
		}
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
		expect(calls.every(call => call[0] === calls[0]?.[0])).toBe(true);
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
		expect(h.idempotencyRun).not.toHaveBeenCalled();
	});

	it("updates through an action-scoped idempotency claim", async () => {
		const h = harness();

		await h.run(service =>
			service.updateTransaction(organizationId, ledgerId, transactionId, idempotencyKey, updateRequest)
		);

		expect(h.repository.updateTransaction).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			transactionId,
			updateRequest,
			expect.anything(),
			expect.any(Array)
		);
		expect(h.idempotencyRun).toHaveBeenCalledWith(
			expect.objectContaining({ action: "transactions.update", key: idempotencyKey })
		);
	});

	it("retries Transaction OCC conflicts", async () => {
		const h = harness();
		h.repository.updateTransaction
			.mockReturnValueOnce(Effect.fail(new TransactionVersionConflict()))
			.mockReturnValueOnce(Effect.succeed(transaction));

		await expect(
			h.run(service =>
				service.updateTransaction(
					organizationId,
					ledgerId,
					transactionId,
					idempotencyKey,
					updateRequest
				)
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
		expect(h.idempotencyRun).not.toHaveBeenCalled();
	});
});
