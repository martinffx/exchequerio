import { Clock, Effect, Layer, Option, Result } from "effect";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";

import { AccountNotFound, AccountVersionConflict, makeCurrency } from "@/ledgers/accounts";
import { type LedgerService, LedgerServiceTag } from "@/ledgers/LedgerService";
import { LedgerNotFound } from "@/ledgers/LedgerErrors";
import {
	newLedgerAccountID,
	newLedgerID,
	newLedgerTransactionEntryID,
	newLedgerTransactionID,
	newOrgID,
} from "@/repo/entities/types";

import { Entry, Transaction } from "./domain/Transaction";
import {
	type TransactionIdempotencyRepo,
	TransactionIdempotencyRepoTag,
} from "./TransactionIdempotencyRepo";
import {
	TransactionConcurrencyFailure,
	TransactionIdempotencyUnavailable,
	TransactionLifecycleConflict,
	TransactionNotFound,
	TransactionPersistenceDecodingFailure,
	TransactionPersistenceFailure,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
} from "./TransactionErrors";
import { type TransactionRepo, TransactionRepoTag } from "./TransactionRepo";
import { makeTransactionServiceLayer, TransactionServiceTag } from "./TransactionService";

const organizationId = newOrgID();
const ledgerId = newLedgerID();
const transactionId = newLedgerTransactionID();
const debitAccountId = newLedgerAccountID();
const creditAccountId = newLedgerAccountID();
const nowMillis = Date.parse("2026-08-15T12:34:56.789Z");
const now = DateTime.fromMillis(nowMillis, { zone: "utc" });

const transaction = Effect.runSync(
	Effect.gen(function* () {
		const entries = yield* Effect.all([
			Entry.make({
				id: newLedgerTransactionEntryID(),
				accountId: debitAccountId,
				direction: "debit",
				amount: 100,
				currency: makeCurrency("EUR", 2),
			}),
			Entry.make({
				id: newLedgerTransactionEntryID(),
				accountId: creditAccountId,
				direction: "credit",
				amount: 100,
				currency: makeCurrency("EUR", 2),
			}),
		]);
		return yield* Transaction.create({
			id: transactionId,
			organizationId,
			ledgerId,
			status: "pending",
			entries,
			created: now,
			updated: now,
		});
	}).pipe(Effect.map(mutation => mutation.transaction))
);
const someTransaction = Option.fromNullishOr(transaction);

const createRequest = {
	status: "pending" as const,
	description: "payment",
	metadata: { source: "test" },
	ledgerEntries: [
		{
			accountId: debitAccountId.toString(),
			direction: "debit" as const,
			amount: 100,
		},
		{
			accountId: creditAccountId.toString(),
			direction: "credit" as const,
			amount: 100,
		},
	],
};

const replaceRequest = {
	description: "replacement",
	ledgerEntries: createRequest.ledgerEntries,
};

const makeHarness = () => {
	const callOrder: string[] = [];
	const candidateId = newLedgerTransactionID();
	const entryIds = [newLedgerTransactionEntryID(), newLedgerTransactionEntryID()];
	let entryIndex = 0;
	const ids = {
		transaction: vi.fn(() =>
			Effect.sync(() => {
				callOrder.push("transaction-id");
				return candidateId;
			})
		),
		entry: vi.fn(() =>
			Effect.sync(() => {
				callOrder.push("entry-id");
				return entryIds[entryIndex++]!;
			})
		),
	};
	const repository = {
		listTransactions: vi.fn<TransactionRepo["listTransactions"]>(() => Effect.succeed([transaction])),
		getTransaction: vi.fn<TransactionRepo["getTransaction"]>(() => Effect.succeed(someTransaction)),
		getTransactionByIdempotencyKey: vi.fn<TransactionRepo["getTransactionByIdempotencyKey"]>(() =>
			Effect.succeed(Option.none())
		),
		createTransaction: vi.fn<TransactionRepo["createTransaction"]>(() =>
			Effect.sync(() => {
				callOrder.push("save");
				return transaction;
			})
		),
		replaceTransaction: vi.fn<TransactionRepo["replaceTransaction"]>(() =>
			Effect.succeed(transaction)
		),
		postTransaction: vi.fn<TransactionRepo["postTransaction"]>(() => Effect.succeed(transaction)),
		voidTransaction: vi.fn<TransactionRepo["voidTransaction"]>(() => Effect.succeed(transaction)),
	} satisfies TransactionRepo;
	const idempotency = {
		lookup: vi.fn<TransactionIdempotencyRepo["lookup"]>(() =>
			Effect.sync(() => {
				callOrder.push("lookup");
				return undefined;
			})
		),
		claim: vi.fn<TransactionIdempotencyRepo["claim"]>((_organizationId, _key, id) =>
			Effect.sync(() => {
				callOrder.push("claim");
				return id;
			})
		),
		repopulate: vi.fn<TransactionIdempotencyRepo["repopulate"]>((_organizationId, _key, id) =>
			Effect.succeed(id)
		),
		cleanup: vi.fn<TransactionIdempotencyRepo["cleanup"]>(() => Effect.void),
	} satisfies TransactionIdempotencyRepo;
	const getLedger = vi.fn<LedgerService["getLedger"]>(() =>
		Effect.sync(() => {
			callOrder.push("parent");
			return { id: ledgerId } as Effect.Success<ReturnType<LedgerService["getLedger"]>>;
		})
	);
	const ledgerService = { getLedger } as unknown as LedgerService;
	const sleep = vi.fn<Clock.Clock["sleep"]>(() => Effect.void);
	const clock: Clock.Clock = {
		currentTimeMillisUnsafe: () => nowMillis,
		currentTimeMillis: Effect.sync(() => {
			callOrder.push("time");
			return nowMillis;
		}),
		currentTimeNanosUnsafe: () => BigInt(nowMillis) * 1_000_000n,
		currentTimeNanos: Effect.succeed(BigInt(nowMillis) * 1_000_000n),
		monotonicTimeNanosUnsafe: () => 0n,
		monotonicTimeNanos: Effect.succeed(0n),
		sleep,
	};

	const dependencies = Layer.mergeAll(
		Layer.succeed(TransactionRepoTag, repository),
		Layer.succeed(TransactionIdempotencyRepoTag, idempotency),
		Layer.succeed(LedgerServiceTag, ledgerService)
	);
	const layer = makeTransactionServiceLayer(ids).pipe(Layer.provide(dependencies));
	const run = <A, E>(effect: Effect.Effect<A, E, Effect.Success<typeof TransactionServiceTag>>) =>
		Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provideService(Clock.Clock, clock)));
	const use = <A, E>(
		f: (service: Effect.Success<typeof TransactionServiceTag>) => Effect.Effect<A, E>
	) => run(TransactionServiceTag.pipe(Effect.flatMap(f)));
	const failure = async <A, E>(
		effect: Effect.Effect<A, E, Effect.Success<typeof TransactionServiceTag>>
	) => {
		const result = await run(effect.pipe(Effect.result));
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isSuccess(result)) throw new Error("Expected failure");
		return result.failure;
	};

	return {
		callOrder,
		candidateId,
		entryIds,
		ids,
		repository,
		idempotency,
		ledgerService,
		getLedger,
		sleep,
		use,
		failure,
	};
};

describe("TransactionService successes", () => {
	it("lists after verifying the Organization-scoped Ledger parent", async () => {
		const h = makeHarness();
		await expect(
			h.use(service => service.listTransactions(organizationId, ledgerId, { offset: 4, limit: 8 }))
		).resolves.toEqual([transaction]);
		expect(h.getLedger).toHaveBeenCalledWith(organizationId, ledgerId);
		expect(h.repository.listTransactions).toHaveBeenCalledWith(organizationId, ledgerId, {
			offset: 4,
			limit: 8,
		});
	});

	it("gets an Organization- and Ledger-scoped Transaction", async () => {
		const h = makeHarness();
		await expect(
			h.use(service => service.getTransaction(organizationId, ledgerId, transactionId))
		).resolves.toBe(transaction);
		expect(h.repository.getTransaction).toHaveBeenCalledWith(organizationId, ledgerId, transactionId);
	});

	it("creates with deterministic IDs and Luxon server time after winning the claim", async () => {
		const h = makeHarness();
		await expect(
			h.use(service => service.createTransaction(organizationId, ledgerId, "key", createRequest))
		).resolves.toBe(transaction);
		expect(h.repository.getTransactionByIdempotencyKey).not.toHaveBeenCalled();
		expect(h.idempotency.claim).toHaveBeenCalledWith(organizationId, "key", h.candidateId);
		expect(h.repository.createTransaction).toHaveBeenCalledWith({
			id: h.candidateId,
			organizationId,
			ledgerId,
			idempotencyKey: "key",
			status: "pending",
			description: "payment",
			metadata: { source: "test" },
			entries: [
				{
					id: h.entryIds[0],
					accountId: debitAccountId,
					direction: "debit",
					amount: 100,
					metadata: undefined,
				},
				{
					id: h.entryIds[1],
					accountId: creditAccountId,
					direction: "credit",
					amount: 100,
					metadata: undefined,
				},
			],
			created: now,
			updated: now,
		});
		expect(h.callOrder).toEqual([
			"lookup",
			"parent",
			"transaction-id",
			"entry-id",
			"entry-id",
			"time",
			"claim",
			"save",
		]);
	});

	it("sets Posted Time for direct Posted creation", async () => {
		const h = makeHarness();
		await h.use(service =>
			service.createTransaction(organizationId, ledgerId, "posted", {
				...createRequest,
				status: "posted",
			})
		);
		expect(h.repository.createTransaction).toHaveBeenCalledWith(
			expect.objectContaining({ postedAt: now, created: now, updated: now })
		);
	});

	it("replaces with new Entry IDs and server Updated Time", async () => {
		const h = makeHarness();
		await expect(
			h.use(service =>
				service.replaceTransaction(organizationId, ledgerId, transactionId, replaceRequest)
			)
		).resolves.toBe(transaction);
		expect(h.repository.replaceTransaction).toHaveBeenCalledWith(
			expect.objectContaining({
				id: transactionId,
				organizationId,
				ledgerId,
				description: "replacement",
				updated: now,
			})
		);
	});

	it.each(["post", "void"] as const)("%ss with server time", async operation => {
		const h = makeHarness();
		await h.use(service =>
			operation === "post"
				? service.postTransaction(organizationId, ledgerId, transactionId)
				: service.voidTransaction(organizationId, ledgerId, transactionId)
		);
		expect(
			operation === "post" ? h.repository.postTransaction : h.repository.voidTransaction
		).toHaveBeenCalledWith(organizationId, ledgerId, transactionId, now);
	});
});

describe("TransactionService create idempotency", () => {
	it("returns the Valkey-mapped Transaction and ignores a different replay body", async () => {
		const h = makeHarness();
		h.idempotency.lookup.mockReturnValue(Effect.succeed(transaction.id));
		h.repository.getTransactionByIdempotencyKey.mockReturnValue(Effect.succeed(someTransaction));
		const replay = {
			...createRequest,
			status: "posted" as const,
			ledgerEntries: Array.from({ length: 201 }, (_, index) => ({
				accountId: newLedgerAccountID().toString(),
				direction: index % 2 === 0 ? ("debit" as const) : ("credit" as const),
				amount: 999,
			})),
		};

		await expect(
			h.use(service => service.createTransaction(organizationId, ledgerId, "key", replay))
		).resolves.toBe(transaction);
		expect(h.repository.createTransaction).not.toHaveBeenCalled();
		expect(h.idempotency.claim).not.toHaveBeenCalled();
		expect(h.getLedger).not.toHaveBeenCalled();
		expect(h.ids.transaction).not.toHaveBeenCalled();
	});

	it("waits for a claim winner's PostgreSQL commit without creating", async () => {
		const h = makeHarness();
		const winnerId = transaction.id;
		h.idempotency.claim.mockReturnValue(Effect.succeed(winnerId));
		h.repository.getTransactionByIdempotencyKey
			.mockReturnValueOnce(Effect.succeed(Option.none()))
			.mockReturnValueOnce(Effect.succeed(Option.none()))
			.mockReturnValue(Effect.succeed(someTransaction));

		await expect(
			h.use(service => service.createTransaction(organizationId, ledgerId, "key", createRequest))
		).resolves.toBe(transaction);
		expect(h.repository.getTransactionByIdempotencyKey).toHaveBeenCalledTimes(3);
		expect(h.sleep).toHaveBeenCalledTimes(2);
		expect(h.repository.createTransaction).not.toHaveBeenCalled();
		expect(h.idempotency.cleanup).not.toHaveBeenCalled();
	});

	it("bounds waiting for a winner that never commits", async () => {
		const h = makeHarness();
		h.idempotency.claim.mockReturnValue(Effect.succeed(transaction.id));
		const error = await h.failure(
			TransactionServiceTag.use(service =>
				service.createTransaction(organizationId, ledgerId, "key", createRequest)
			)
		);
		expect(error).toBeInstanceOf(TransactionPersistenceFailure);
		expect(h.repository.getTransactionByIdempotencyKey).toHaveBeenCalledTimes(41);
		expect(h.sleep).toHaveBeenCalledTimes(40);
		expect(h.repository.createTransaction).not.toHaveBeenCalled();
	});

	it("cleans up only its own failed claim", async () => {
		const h = makeHarness();
		const failure = new TransactionValidationFailure("invalid");
		h.repository.createTransaction.mockReturnValue(Effect.fail(failure));
		await expect(
			h.failure(
				TransactionServiceTag.use(service =>
					service.createTransaction(organizationId, ledgerId, "key", createRequest)
				)
			)
		).resolves.toBe(failure);
		expect(h.idempotency.cleanup).toHaveBeenCalledWith(organizationId, "key", h.candidateId);
	});

	it("recovers a permanent database idempotency race and repopulates Valkey", async () => {
		const h = makeHarness();
		const unique = new TransactionConcurrencyFailure({
			cause: {
				code: "23505",
				constraint: "unique_ledger_transactions_organization_idempotency_key",
			},
		});
		h.repository.createTransaction.mockReturnValue(Effect.fail(unique));
		h.repository.getTransactionByIdempotencyKey.mockReturnValue(Effect.succeed(someTransaction));

		await expect(
			h.use(service => service.createTransaction(organizationId, ledgerId, "key", createRequest))
		).resolves.toBe(transaction);
		expect(h.repository.createTransaction).toHaveBeenCalledTimes(1);
		expect(h.idempotency.cleanup).toHaveBeenCalledWith(organizationId, "key", h.candidateId);
		expect(h.idempotency.repopulate).toHaveBeenCalledWith(organizationId, "key", transaction.id);
	});

	it("does not recover an unrelated unique violation", async () => {
		const h = makeHarness();
		const unique = new TransactionConcurrencyFailure({
			code: "23505",
			constraint: "unrelated_unique_constraint",
		});
		h.repository.createTransaction.mockReturnValue(Effect.fail(unique));

		await expect(
			h.failure(
				TransactionServiceTag.use(service =>
					service.createTransaction(organizationId, ledgerId, "key", createRequest)
				)
			)
		).resolves.toBe(unique);
		expect(h.repository.createTransaction).toHaveBeenCalledOnce();
		expect(h.idempotency.cleanup).toHaveBeenCalledOnce();
		expect(h.repository.getTransactionByIdempotencyKey).not.toHaveBeenCalled();
		expect(h.idempotency.repopulate).not.toHaveBeenCalled();
	});

	it("does not combine a unique code and idempotency constraint from sibling errors", async () => {
		const h = makeHarness();
		const mixed = new TransactionConcurrencyFailure({
			errors: [
				{ code: "23505" },
				{ constraint: "unique_ledger_transactions_organization_idempotency_key" },
			],
		});
		h.repository.createTransaction.mockReturnValue(Effect.fail(mixed));

		await expect(
			h.failure(
				TransactionServiceTag.use(service =>
					service.createTransaction(organizationId, ledgerId, "key", createRequest)
				)
			)
		).resolves.toBe(mixed);
		expect(h.repository.createTransaction).toHaveBeenCalledOnce();
		expect(h.idempotency.cleanup).toHaveBeenCalledOnce();
		expect(h.repository.getTransactionByIdempotencyKey).not.toHaveBeenCalled();
		expect(h.idempotency.repopulate).not.toHaveBeenCalled();
	});

	it("cleans up and propagates an ambiguously classified save failure once", async () => {
		const h = makeHarness();
		const ambiguous = new TransactionConcurrencyFailure(new Error("ambiguous"));
		h.repository.createTransaction.mockReturnValue(Effect.fail(ambiguous));

		await expect(
			h.failure(
				TransactionServiceTag.use(service =>
					service.createTransaction(organizationId, ledgerId, "key", createRequest)
				)
			)
		).resolves.toBe(ambiguous);
		expect(h.repository.createTransaction).toHaveBeenCalledOnce();
		expect(h.idempotency.cleanup).toHaveBeenCalledOnce();
		expect(h.repository.getTransactionByIdempotencyKey).not.toHaveBeenCalled();
	});

	it("propagates cleanup failure after a failed save", async () => {
		const h = makeHarness();
		const saveFailure = new TransactionValidationFailure("invalid");
		const cleanupFailure = new TransactionIdempotencyUnavailable(new Error("cleanup offline"));
		h.repository.createTransaction.mockReturnValue(Effect.fail(saveFailure));
		h.idempotency.cleanup.mockReturnValue(Effect.fail(cleanupFailure));

		await expect(
			h.failure(
				TransactionServiceTag.use(service =>
					service.createTransaction(organizationId, ledgerId, "key", createRequest)
				)
			)
		).resolves.toBe(cleanupFailure);
		expect(h.idempotency.cleanup).toHaveBeenCalledWith(organizationId, "key", h.candidateId);
	});

	it("propagates repopulation failure during exact unique-race recovery", async () => {
		const h = makeHarness();
		const unique = new TransactionConcurrencyFailure({
			code: "23505",
			constraint: "unique_ledger_transactions_organization_idempotency_key",
		});
		const repopulateFailure = new TransactionIdempotencyUnavailable(new Error("repopulate offline"));
		h.repository.createTransaction.mockReturnValue(Effect.fail(unique));
		h.repository.getTransactionByIdempotencyKey.mockReturnValue(Effect.succeed(someTransaction));
		h.idempotency.repopulate.mockReturnValue(Effect.fail(repopulateFailure));

		await expect(
			h.failure(
				TransactionServiceTag.use(service =>
					service.createTransaction(organizationId, ledgerId, "key", createRequest)
				)
			)
		).resolves.toBe(repopulateFailure);
	});

	it("cleans up after a save defect and preserves the defect", async () => {
		const h = makeHarness();
		const defect = new Error("save defect");
		h.repository.createTransaction.mockReturnValue(Effect.die(defect));

		await expect(
			h.use(service => service.createTransaction(organizationId, ledgerId, "key", createRequest))
		).rejects.toBe(defect);
		expect(h.idempotency.cleanup).toHaveBeenCalledWith(organizationId, "key", h.candidateId);
	});

	it("retries a retryable create and does not clean up after eventual success", async () => {
		const h = makeHarness();
		h.repository.createTransaction
			.mockReturnValueOnce(Effect.fail(new TransactionConcurrencyFailure({ code: "40P01" })))
			.mockReturnValue(Effect.succeed(transaction));

		await expect(
			h.use(service => service.createTransaction(organizationId, ledgerId, "key", createRequest))
		).resolves.toBe(transaction);
		expect(h.repository.createTransaction).toHaveBeenCalledTimes(2);
		expect(h.idempotency.cleanup).not.toHaveBeenCalled();
	});

	it("cleans up once after bounded create retries are exhausted", async () => {
		const h = makeHarness();
		h.repository.createTransaction.mockImplementation(() =>
			Effect.fail(
				new AccountVersionConflict(
					organizationId.toString(),
					ledgerId.toString(),
					debitAccountId.toString()
				)
			)
		);

		const error = await h.failure(
			TransactionServiceTag.use(service =>
				service.createTransaction(organizationId, ledgerId, "key", createRequest)
			)
		);
		expect(error).toBeInstanceOf(AccountVersionConflict);
		expect(h.repository.createTransaction).toHaveBeenCalledTimes(3);
		expect(h.idempotency.cleanup).toHaveBeenCalledOnce();
	});

	it.each(["lookup", "claim"] as const)(
		"fails on Valkey %s unavailability before any new create attempt",
		async operation => {
			const h = makeHarness();
			const unavailable = new TransactionIdempotencyUnavailable(new Error("offline"));
			h.idempotency[operation].mockReturnValue(Effect.fail(unavailable));

			await expect(
				h.failure(
					TransactionServiceTag.use(service =>
						service.createTransaction(organizationId, ledgerId, "key", createRequest)
					)
				)
			).resolves.toBe(unavailable);
			expect(h.repository.createTransaction).not.toHaveBeenCalled();
			expect(h.idempotency.lookup).toHaveBeenCalledOnce();
			expect(h.idempotency.claim).toHaveBeenCalledTimes(operation === "claim" ? 1 : 0);
		}
	);

	it("checks the distinct Account cap after replay lookup but before parent lookup, IDs, claim, or write", async () => {
		const h = makeHarness();
		const overLimit = {
			...createRequest,
			ledgerEntries: Array.from({ length: 201 }, () => ({
				accountId: newLedgerAccountID().toString(),
				direction: "debit" as const,
				amount: 1,
			})),
		};

		const error = await h.failure(
			TransactionServiceTag.use(service =>
				service.createTransaction(organizationId, ledgerId, "key", overLimit)
			)
		);
		expect(error).toBeInstanceOf(TransactionValidationFailure);
		expect(h.idempotency.lookup).toHaveBeenCalledOnce();
		expect(h.getLedger).not.toHaveBeenCalled();
		expect(h.ids.transaction).not.toHaveBeenCalled();
		expect(h.idempotency.claim).not.toHaveBeenCalled();
		expect(h.repository.createTransaction).not.toHaveBeenCalled();
	});
});

describe("TransactionService parent and absence behavior", () => {
	it.each(["list", "create"] as const)(
		"stops %s when the Ledger parent is absent",
		async operation => {
			const h = makeHarness();
			const missing = new LedgerNotFound(organizationId.toString(), ledgerId.toString());
			h.getLedger.mockReturnValue(Effect.fail(missing));
			const error =
				operation === "list"
					? await h.failure(
							TransactionServiceTag.use(service =>
								service.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
							)
						)
					: await h.failure(
							TransactionServiceTag.use(service =>
								service.createTransaction(organizationId, ledgerId, "key", createRequest)
							)
						);
			expect(error).toBe(missing);
			expect(h.repository.listTransactions).not.toHaveBeenCalled();
			expect(h.idempotency.claim).not.toHaveBeenCalled();
			expect(h.repository.createTransaction).not.toHaveBeenCalled();
		}
	);

	it("maps an absent item to the tenant-safe Transaction not-found error", async () => {
		const h = makeHarness();
		h.repository.getTransaction.mockReturnValue(Effect.succeed(Option.none()));
		const error = await h.failure(
			TransactionServiceTag.use(service =>
				service.getTransaction(organizationId, ledgerId, transactionId)
			)
		);
		expect(error).toBeInstanceOf(TransactionNotFound);
	});
});

describe("TransactionService retry policy", () => {
	const retryable = [
		["deadlock", () => new TransactionConcurrencyFailure({ code: "40P01" })],
		["serialization", () => new TransactionConcurrencyFailure({ code: "40001" })],
		[
			"Account version",
			() =>
				new AccountVersionConflict(
					organizationId.toString(),
					ledgerId.toString(),
					debitAccountId.toString()
				),
		],
	] as const;

	it.each(retryable)("retries %s conflicts and can succeed", async (_name, makeError) => {
		const h = makeHarness();
		h.repository.postTransaction
			.mockReturnValueOnce(Effect.fail(makeError()))
			.mockReturnValue(Effect.succeed(transaction));
		await expect(
			h.use(service => service.postTransaction(organizationId, ledgerId, transactionId))
		).resolves.toBe(transaction);
		expect(h.repository.postTransaction).toHaveBeenCalledTimes(2);
	});

	it.each(retryable)("bounds exhausted %s conflicts at three attempts", async (_name, makeError) => {
		const h = makeHarness();
		h.repository.postTransaction.mockImplementation(() => Effect.fail(makeError()));
		const error = await h.failure(
			TransactionServiceTag.use(service =>
				service.postTransaction(organizationId, ledgerId, transactionId)
			)
		);
		expect(error).toBeInstanceOf(makeError().constructor);
		expect(h.repository.postTransaction).toHaveBeenCalledTimes(3);
	});

	it.each([undefined, "23503", "99999", "23505"])(
		"does not retry Transaction concurrency with code %s",
		async code => {
			const h = makeHarness();
			const error = new TransactionConcurrencyFailure(code === undefined ? {} : { code });
			h.repository.postTransaction.mockReturnValue(Effect.fail(error));
			await expect(
				h.failure(
					TransactionServiceTag.use(service =>
						service.postTransaction(organizationId, ledgerId, transactionId)
					)
				)
			).resolves.toBe(error);
			expect(h.repository.postTransaction).toHaveBeenCalledOnce();
		}
	);

	const nonretryable = [
		new TransactionValidationFailure("invalid"),
		new AccountNotFound(organizationId.toString(), ledgerId.toString(), debitAccountId.toString()),
		new TransactionLifecycleConflict(transactionId.toString(), "posted", "voided"),
		new TransactionNotFound(organizationId.toString(), ledgerId.toString(), transactionId.toString()),
		new TransactionRepositoryUnavailable(new Error("offline")),
		new TransactionPersistenceDecodingFailure(new Error("bad row")),
		new TransactionPersistenceFailure(new Error("unknown")),
	];

	it.each(nonretryable)("runs nonretryable $name only once", async error => {
		const h = makeHarness();
		h.repository.postTransaction.mockReturnValue(Effect.fail(error));
		await expect(
			h.failure(
				TransactionServiceTag.use(service =>
					service.postTransaction(organizationId, ledgerId, transactionId)
				)
			)
		).resolves.toBe(error);
		expect(h.repository.postTransaction).toHaveBeenCalledOnce();
	});
});

describe("TransactionService Valkey isolation", () => {
	it.each(["list", "get", "replace", "post", "void"] as const)(
		"does not consult Valkey for %s",
		async operation => {
			const h = makeHarness();
			switch (operation) {
				case "list":
					await h.use(service =>
						service.listTransactions(organizationId, ledgerId, { offset: 0, limit: 20 })
					);
					break;
				case "get":
					await h.use(service => service.getTransaction(organizationId, ledgerId, transactionId));
					break;
				case "replace":
					await h.use(service =>
						service.replaceTransaction(organizationId, ledgerId, transactionId, replaceRequest)
					);
					break;
				case "post":
					await h.use(service => service.postTransaction(organizationId, ledgerId, transactionId));
					break;
				case "void":
					await h.use(service => service.voidTransaction(organizationId, ledgerId, transactionId));
					break;
			}
			expect(h.idempotency.lookup).not.toHaveBeenCalled();
			expect(h.idempotency.claim).not.toHaveBeenCalled();
			expect(h.idempotency.repopulate).not.toHaveBeenCalled();
			expect(h.idempotency.cleanup).not.toHaveBeenCalled();
		}
	);
});
