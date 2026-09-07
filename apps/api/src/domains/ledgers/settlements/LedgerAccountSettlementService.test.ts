import { randomUUID } from "node:crypto";
import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import type { AccountService } from "../accounts/AccountService";
import { LedgerAccount } from "../accounts/LedgerAccount";
import type { LedgerTransactionRepo } from "../transactions/LedgerTransactionRepo";
import { TransactionValidationFailure } from "../transactions/LedgerTransactionErrors";
import { ConflictError, ServiceUnavailableError } from "@/lib/errors";
import { newOrgID, newLedgerID, newLedgerAccountID, newLedgerAccountSettlementID } from "@/lib/ids";
import type { IdempotencyService } from "@/services/IdempotencyService";
import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import type { LedgerAccountSettlementRepo } from "./LedgerAccountSettlementRepo";
import { LedgerAccountSettlementService } from "./LedgerAccountSettlementService";

const organizationId = newOrgID();
const ledgerId = newLedgerID();
const settlementId = newLedgerAccountSettlementID();
const settledAccountId = newLedgerAccountID();
const contraAccountId = newLedgerAccountID();
const now = DateTime.fromISO("2026-09-06T12:00:00Z");
const prepared = new LedgerAccountSettlementEntity({
	id: settlementId,
	organizationId,
	ledgerId,
	settledAccountId,
	contraAccountId,
	currency: "USD",
	status: "processing",
	targetStatus: "pending",
	allowEitherDirection: false,
	created: now,
	updated: now,
});
const accounting = Effect.runSync(
	prepared.toTransaction([{ amount: 125, direction: "debit" }], "debit", "pending", now)
);
const finalized = new LedgerAccountSettlementEntity({
	...prepared.data,
	status: "pending",
	targetStatus: undefined,
	transaction: accounting,
});
// oxlint-disable-next-line unicorn/no-array-callback-reference -- Effect Option constructor, not an iterator.
const replayClaim = Option.some(settlementId.toString());
// oxlint-disable-next-line unicorn/no-array-callback-reference -- Effect Option constructor, not an iterator.
const existingAccounting = Option.some(accounting);
const request = {
	settledAccountId: settledAccountId.toString(),
	contraAccountId: contraAccountId.toString(),
};

let repository: Mocked<LedgerAccountSettlementRepo>;
let transactions: Mocked<LedgerTransactionRepo>;
let idempotency: Mocked<IdempotencyService>;
let getAccount: Mocked<Pick<AccountService, "getAccount">>["getAccount"];
let service: LedgerAccountSettlementService;
let key: string;

beforeEach(() => {
	key = randomUUID();
	repository = {
		listSettlements: vi.fn(),
		getSettlement: vi.fn(),
		createSettlement: vi.fn(),
		prepareSettlement: vi.fn(),
		finalizeSettlement: vi.fn(),
		buildTransaction: vi.fn(),
		changeEntries: vi.fn(),
		listEntries: vi.fn(),
	};
	repository.listSettlements.mockReturnValue(Effect.succeed([finalized]));
	repository.getSettlement.mockReturnValue(Effect.succeed(prepared));
	repository.createSettlement.mockReturnValue(Effect.succeed(prepared));
	repository.prepareSettlement.mockReturnValue(Effect.succeed(prepared));
	repository.finalizeSettlement.mockReturnValue(Effect.succeed(finalized));
	repository.buildTransaction.mockReturnValue(Effect.succeed(accounting));
	transactions = {
		getSettlementTransaction: vi.fn(),
		createSettlementTransaction: vi.fn(),
		postSettlementTransaction: vi.fn(),
		voidSettlementTransaction: vi.fn(),
		listTransactions: vi.fn(),
		getTransaction: vi.fn(),
		createTransaction: vi.fn(),
		updateTransaction: vi.fn(),
		postTransaction: vi.fn(),
		voidTransaction: vi.fn(),
	};
	transactions.getSettlementTransaction.mockReturnValue(Effect.succeed(Option.none()));
	transactions.createSettlementTransaction.mockReturnValue(Effect.succeed(accounting));
	idempotency = { claim: vi.fn(), complete: vi.fn(), release: vi.fn() };
	idempotency.claim.mockReturnValue(Effect.succeed(Option.none()));
	idempotency.complete.mockReturnValue(Effect.void);
	idempotency.release.mockReturnValue(Effect.void);
	getAccount = vi.fn();
	getAccount.mockReturnValue(
		Effect.succeed(
			LedgerAccount.fromCreateRequest(settledAccountId, organizationId, ledgerId, {
				name: "Receivable",
				normalBalance: "debit",
				currencyCode: "USD",
			})
		)
	);
	service = new LedgerAccountSettlementService(
		repository,
		{ getAccount } as unknown as AccountService,
		transactions,
		idempotency
	);
});

/** Runs creation with this test’s action key and shared request fixture. */
const create = () =>
	Effect.runPromise(service.createLedgerAccountSettlement(organizationId, ledgerId, key, request));
/** Runs the pending transition with this test’s action key. */
const patch = () =>
	Effect.runPromise(
		service.patchLedgerAccountSettlement(organizationId, ledgerId, settlementId, key, {
			status: "pending",
		})
	);

describe("LedgerAccountSettlementService", () => {
	it("passes the Organization, Ledger, and pagination directly to the repository", async () => {
		await expect(
			Effect.runPromise(service.listLedgerAccountSettlements(organizationId, ledgerId, 5, 10))
		).resolves.toEqual([finalized]);
		expect(repository.listSettlements).toHaveBeenCalledWith(organizationId, ledgerId, 5, 10);
		expect(getAccount).not.toHaveBeenCalled();
		expect(idempotency.claim).not.toHaveBeenCalled();
	});

	it("records the prepared Settlement before creating accounting and finalizing", async () => {
		idempotency.complete.mockImplementation(() =>
			Effect.sync(() => {
				expect(repository.createSettlement).toHaveBeenCalledOnce();
			})
		);
		transactions.createSettlementTransaction.mockImplementation(() =>
			Effect.sync(() => {
				expect(idempotency.complete).toHaveBeenCalledWith(
					organizationId,
					"settlements.create",
					key,
					settlementId.toString()
				);
				return accounting;
			})
		);
		repository.finalizeSettlement.mockImplementation(() =>
			Effect.sync(() => {
				expect(transactions.createSettlementTransaction).toHaveBeenCalledWith(accounting);
				return finalized;
			})
		);
		await expect(create()).resolves.toBe(finalized);
		expect(idempotency.claim).toHaveBeenCalledWith(organizationId, "settlements.create", key);
		expect(repository.createSettlement).toHaveBeenCalledWith(
			expect.any(LedgerAccountSettlementEntity),
			"pending",
			expect.any(DateTime)
		);
		expect(repository.createSettlement.mock.calls[0]?.[0].data).toMatchObject({
			currency: "USD",
			status: "drafting",
		});
		expect(repository.finalizeSettlement).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			settlementId,
			"pending",
			expect.any(DateTime)
		);
		expect(idempotency.release).not.toHaveBeenCalled();
	});

	it("returns a drafting create without creating accounting", async () => {
		const draft = new LedgerAccountSettlementEntity({
			...prepared.data,
			status: "drafting",
			targetStatus: undefined,
		});
		repository.createSettlement.mockReturnValue(Effect.succeed(draft));
		await expect(
			Effect.runPromise(
				service.createLedgerAccountSettlement(organizationId, ledgerId, key, {
					...request,
					status: "drafting",
				})
			)
		).resolves.toBe(draft);
		expect(repository.createSettlement).toHaveBeenCalledWith(
			expect.any(LedgerAccountSettlementEntity),
			undefined,
			expect.any(DateTime)
		);
		expect(transactions.getSettlementTransaction).not.toHaveBeenCalled();
		expect(repository.finalizeSettlement).not.toHaveBeenCalled();
	});

	it("resumes a replayed Processing Settlement without preparing another one", async () => {
		idempotency.claim.mockReturnValue(Effect.succeed(replayClaim));
		await expect(create()).resolves.toBe(finalized);
		expect(repository.getSettlement).toHaveBeenCalledWith(organizationId, ledgerId, settlementId);
		expect(repository.createSettlement).not.toHaveBeenCalled();
		expect(getAccount).not.toHaveBeenCalled();
		expect(idempotency.complete).not.toHaveBeenCalled();
		expect(transactions.createSettlementTransaction).toHaveBeenCalledWith(accounting);
	});

	it("reuses committed accounting when retrying failed finalization", async () => {
		idempotency.claim.mockReturnValue(Effect.succeed(replayClaim));
		transactions.getSettlementTransaction.mockReturnValue(Effect.succeed(existingAccounting));
		await expect(create()).resolves.toBe(finalized);
		expect(repository.buildTransaction).not.toHaveBeenCalled();
		expect(transactions.createSettlementTransaction).not.toHaveBeenCalled();
		expect(repository.finalizeSettlement).toHaveBeenCalledOnce();
	});

	it.each(["posted", "voided"] as const)(
		"resumes %s using the existing accounting Transaction",
		async targetStatus => {
			const processing = new LedgerAccountSettlementEntity({ ...prepared.data, targetStatus });
			const terminal = new LedgerAccountSettlementEntity({ ...finalized.data, status: targetStatus });
			idempotency.claim.mockReturnValue(Effect.succeed(replayClaim));
			repository.getSettlement.mockReturnValue(Effect.succeed(processing));
			repository.finalizeSettlement.mockReturnValue(Effect.succeed(terminal));
			transactions.getSettlementTransaction.mockReturnValue(Effect.succeed(existingAccounting));
			transactions.postSettlementTransaction.mockReturnValue(Effect.succeed(accounting));
			transactions.voidSettlementTransaction.mockReturnValue(Effect.succeed(accounting));
			await expect(
				Effect.runPromise(
					service.patchLedgerAccountSettlement(organizationId, ledgerId, settlementId, key, {
						status: targetStatus,
					})
				)
			).resolves.toBe(terminal);
			const transition =
				targetStatus === "posted"
					? transactions.postSettlementTransaction
					: transactions.voidSettlementTransaction;
			expect(transition).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				settlementId,
				expect.any(DateTime)
			);
			expect(transactions.createSettlementTransaction).not.toHaveBeenCalled();
			expect(repository.prepareSettlement).not.toHaveBeenCalled();
			expect(repository.finalizeSettlement).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				settlementId,
				targetStatus,
				expect.any(DateTime)
			);
		}
	);

	it.each([undefined, "pending", "drafting"] as const)(
		"does not let an old %s create key resume a later void transition",
		async status => {
			const voiding = new LedgerAccountSettlementEntity({ ...prepared.data, targetStatus: "voided" });
			idempotency.claim.mockReturnValue(Effect.succeed(replayClaim));
			repository.getSettlement.mockReturnValue(Effect.succeed(voiding));
			await expect(
				Effect.runPromise(
					service.createLedgerAccountSettlement(organizationId, ledgerId, key, { ...request, status })
				)
			).resolves.toBe(voiding);
			expect(transactions.getSettlementTransaction).not.toHaveBeenCalled();
			expect(repository.finalizeSettlement).not.toHaveBeenCalled();
		}
	);

	it.each(["pending", "posted", "voided"] as const)(
		"does not let an old metadata patch key resume a later %s transition",
		async targetStatus => {
			const processing = new LedgerAccountSettlementEntity({ ...prepared.data, targetStatus });
			idempotency.claim.mockReturnValue(Effect.succeed(replayClaim));
			repository.getSettlement.mockReturnValue(Effect.succeed(processing));
			await expect(
				Effect.runPromise(
					service.patchLedgerAccountSettlement(organizationId, ledgerId, settlementId, key, {
						metadata: { note: "original edit" },
					})
				)
			).resolves.toBe(processing);
			expect(transactions.getSettlementTransaction).not.toHaveBeenCalled();
			expect(repository.finalizeSettlement).not.toHaveBeenCalled();
		}
	);

	it("does not let an old posted patch key resume a later void transition", async () => {
		const voiding = new LedgerAccountSettlementEntity({ ...prepared.data, targetStatus: "voided" });
		idempotency.claim.mockReturnValue(Effect.succeed(replayClaim));
		repository.getSettlement.mockReturnValue(Effect.succeed(voiding));
		await expect(
			Effect.runPromise(
				service.patchLedgerAccountSettlement(organizationId, ledgerId, settlementId, key, {
					status: "posted",
				})
			)
		).resolves.toBe(voiding);
		expect(transactions.getSettlementTransaction).not.toHaveBeenCalled();
		expect(repository.finalizeSettlement).not.toHaveBeenCalled();
	});

	it("returns finalized replays without creating or mutating accounting", async () => {
		idempotency.claim.mockReturnValue(Effect.succeed(replayClaim));
		repository.getSettlement.mockReturnValue(Effect.succeed(finalized));
		await expect(create()).resolves.toBe(finalized);
		expect(transactions.getSettlementTransaction).not.toHaveBeenCalled();
		expect(repository.finalizeSettlement).not.toHaveBeenCalled();
	});

	it("retains the prepared resource ID when accounting creation fails", async () => {
		transactions.createSettlementTransaction.mockReturnValue(
			Effect.fail(new TransactionValidationFailure("accounting failed"))
		);
		await expect(create()).rejects.toThrow("accounting failed");
		expect(idempotency.complete).toHaveBeenCalledWith(
			organizationId,
			"settlements.create",
			key,
			settlementId.toString()
		);
		expect(idempotency.release).not.toHaveBeenCalled();
		expect(repository.finalizeSettlement).not.toHaveBeenCalled();
	});

	it("retains the prepared resource ID when finalization fails", async () => {
		repository.finalizeSettlement.mockReturnValue(
			Effect.fail(new ServiceUnavailableError("finalization unavailable"))
		);
		await expect(patch()).rejects.toThrow("finalization unavailable");
		expect(idempotency.complete).toHaveBeenCalledWith(
			organizationId,
			"settlements.patch",
			key,
			settlementId.toString()
		);
		expect(transactions.createSettlementTransaction).toHaveBeenCalledOnce();
		expect(idempotency.release).not.toHaveBeenCalled();
	});

	it.each(["create", "patch"] as const)(
		"releases a %s claim when preparation is rejected",
		async operation => {
			const failure = Effect.fail(new ConflictError("preparation rejected"));
			repository.createSettlement.mockReturnValue(failure);
			repository.prepareSettlement.mockReturnValue(failure);
			await expect(operation === "create" ? create() : patch()).rejects.toThrow(
				"preparation rejected"
			);
			expect(idempotency.release).toHaveBeenCalledWith(
				organizationId,
				`settlements.${operation}`,
				key
			);
			expect(idempotency.complete).not.toHaveBeenCalled();
			expect(transactions.getSettlementTransaction).not.toHaveBeenCalled();
		}
	);

	it.each(["create", "patch"] as const)(
		"retains a %s claim when preparation has an uncertain result",
		async operation => {
			const failure = Effect.fail(new ServiceUnavailableError("preparation unavailable"));
			repository.createSettlement.mockReturnValue(failure);
			repository.prepareSettlement.mockReturnValue(failure);
			await expect(operation === "create" ? create() : patch()).rejects.toThrow(
				"preparation unavailable"
			);
			expect(idempotency.release).not.toHaveBeenCalled();
			expect(idempotency.complete).not.toHaveBeenCalled();
			expect(transactions.getSettlementTransaction).not.toHaveBeenCalled();
		}
	);

	it("propagates a conflicting transition without creating accounting", async () => {
		repository.prepareSettlement.mockReturnValue(
			Effect.fail(new ConflictError("Settlement is processing another transition"))
		);
		await expect(
			Effect.runPromise(
				service.patchLedgerAccountSettlement(organizationId, ledgerId, settlementId, key, {
					status: "voided",
				})
			)
		).rejects.toThrow("processing another transition");
		expect(repository.prepareSettlement).toHaveBeenCalledWith(
			organizationId,
			ledgerId,
			settlementId,
			{ status: "voided" },
			expect.any(DateTime)
		);
		expect(transactions.getSettlementTransaction).not.toHaveBeenCalled();
	});
});
