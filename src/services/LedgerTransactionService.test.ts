import { TypeID } from "typeid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../errors";
import { LedgerEntity } from "../repo/entities/LedgerEntity";
import { LedgerTransactionEntity } from "../repo/entities/LedgerTransactionEntity";
import { LedgerTransactionEntryEntity } from "../repo/entities/LedgerTransactionEntryEntity";
import type {
	LedgerAccountID,
	LedgerID,
	LedgerTransactionEntryID,
	LedgerTransactionID,
	OrgID,
} from "../repo/entities/types";
import type { LedgerRepo } from "../repo/LedgerRepo";
import type { LedgerTransactionRepo } from "../repo/LedgerTransactionRepo";
import type { LedgerTransactionRequest } from "../routes/ledgers/schema";
import { LedgerTransactionService } from "./LedgerTransactionService";

describe("LedgerTransactionService", () => {
	let service: LedgerTransactionService;
	let mockTransactionRepo: LedgerTransactionRepo;
	let mockLedgerRepo: LedgerRepo;

	const orgId = new TypeID("org") as OrgID;
	const ledgerId = new TypeID("lgr") as LedgerID;
	const transactionId = new TypeID("ltr") as LedgerTransactionID;

	beforeEach(() => {
		// Create mock repos
		mockTransactionRepo = {
			listLedgerTransactions: vi.fn(),
			getLedgerTransaction: vi.fn(),
			createTransaction: vi.fn(),
			postTransaction: vi.fn(),
			deleteTransactionWithBalanceUpdate: vi.fn(),
		} as unknown as LedgerTransactionRepo;

		mockLedgerRepo = {
			getLedger: vi.fn(),
		} as unknown as LedgerRepo;

		// Create service with mocked dependencies
		service = new LedgerTransactionService(mockTransactionRepo, mockLedgerRepo);
	});

	describe("listTransactions", () => {
		it("should return list of transactions", async () => {
			const mockEntries = [
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "debit",
					status: "pending",
				}),
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "credit",
					status: "pending",
				}),
			];

			const mockTransactions = [
				new LedgerTransactionEntity({
					id: new TypeID("ltr") as LedgerTransactionID,
					ledgerId,
					organizationId: orgId,
					description: "Test transaction 1",
					status: "pending",
					effectiveAt: new Date(),
					created: new Date(),
					updated: new Date(),
					entries: mockEntries,
				}),
				new LedgerTransactionEntity({
					id: new TypeID("ltr") as LedgerTransactionID,
					ledgerId,
					organizationId: orgId,
					description: "Test transaction 2",
					status: "posted",
					effectiveAt: new Date(),
					created: new Date(),
					updated: new Date(),
					entries: mockEntries,
				}),
			];

			vi.mocked(mockTransactionRepo.listLedgerTransactions).mockResolvedValue(mockTransactions);

			const result = await service.listTransactions(orgId, ledgerId, 0, 10);

			expect(result).toEqual(mockTransactions);
			expect(mockTransactionRepo.listLedgerTransactions).toHaveBeenCalledWith(
				orgId.toString(),
				ledgerId.toString(),
				0,
				10
			);
		});

		it("should pass through offset and limit parameters", async () => {
			vi.mocked(mockTransactionRepo.listLedgerTransactions).mockResolvedValue([]);

			await service.listTransactions(orgId, ledgerId, 20, 50);

			expect(mockTransactionRepo.listLedgerTransactions).toHaveBeenCalledWith(
				orgId.toString(),
				ledgerId.toString(),
				20,
				50
			);
		});
	});

	describe("getLedgerTransaction", () => {
		it("should return transaction when found", async () => {
			const mockEntries = [
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "debit",
					status: "pending",
				}),
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "credit",
					status: "pending",
				}),
			];

			const mockTransaction = new LedgerTransactionEntity({
				id: transactionId,
				ledgerId,
				organizationId: orgId,
				description: "Test transaction",
				status: "pending",
				effectiveAt: new Date(),
				created: new Date(),
				updated: new Date(),
				entries: mockEntries,
			});

			vi.mocked(mockTransactionRepo.getLedgerTransaction).mockResolvedValue(mockTransaction);

			const result = await service.getLedgerTransaction(orgId, ledgerId, transactionId);

			expect(result).toEqual(mockTransaction);
			expect(mockTransactionRepo.getLedgerTransaction).toHaveBeenCalledWith(
				orgId.toString(),
				ledgerId.toString(),
				transactionId.toString()
			);
		});
	});

	describe("createTransaction", () => {
		const mockLedger = new LedgerEntity({
			id: ledgerId,
			organizationId: orgId,
			name: "Test Ledger",
			currency: "USD",
			currencyExponent: 2,
			created: new Date(),
			updated: new Date(),
		});

		const accountId1 = new TypeID("lat") as LedgerAccountID;
		const accountId2 = new TypeID("lat") as LedgerAccountID;
		const entryId1 = new TypeID("lte") as LedgerTransactionEntryID;
		const entryId2 = new TypeID("lte") as LedgerTransactionEntryID;

		const validRequest: LedgerTransactionRequest = {
			description: "Test transaction",
			effectiveAt: "2025-01-01T00:00:00Z",
			status: "pending",
			ledgerEntries: [
				{
					id: entryId1.toString(),
					ledgerAccountId: accountId1.toString(),
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "debit",
					status: "pending",
				},
				{
					id: entryId2.toString(),
					ledgerAccountId: accountId2.toString(),
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "credit",
					status: "pending",
				},
			],
			created: new Date().toISOString(),
			updated: new Date().toISOString(),
		};

		it("should create transaction successfully", async () => {
			const mockCreatedTransaction = new LedgerTransactionEntity({
				id: transactionId,
				ledgerId,
				organizationId: orgId,
				description: validRequest.description,
				status: "pending",
				effectiveAt: new Date(),
				created: new Date(),
				updated: new Date(),
				entries: validRequest.ledgerEntries.map(
					e =>
						new LedgerTransactionEntryEntity({
							id: TypeID.fromString(e.id) as LedgerTransactionEntryID,
							organizationId: orgId,
							transactionId,
							accountId: TypeID.fromString(e.ledgerAccountId) as LedgerAccountID,
							currency: e.currency,
							currencyExponent: e.currencyExponent,
							amount: e.amount,
							direction: e.direction,
							status: e.status,
							created: new Date(),
							updated: new Date(),
						})
				),
			});

			vi.mocked(mockLedgerRepo.getLedger).mockResolvedValue(mockLedger);
			vi.mocked(mockTransactionRepo.createTransaction).mockResolvedValue(mockCreatedTransaction);

			const result = await service.createTransaction(orgId, ledgerId, validRequest);

			expect(result).toEqual(mockCreatedTransaction);
			expect(mockLedgerRepo.getLedger).toHaveBeenCalledWith(orgId, ledgerId);
			expect(mockTransactionRepo.createTransaction).toHaveBeenCalledWith(
				expect.any(LedgerTransactionEntity)
			);
		});

		it("should throw NotFoundError when ledger not found", async () => {
			// Mock getLedger to throw NotFoundError as the repo does
			vi.mocked(mockLedgerRepo.getLedger).mockRejectedValue(new Error("Ledger not found"));

			await expect(service.createTransaction(orgId, ledgerId, validRequest)).rejects.toThrow("Ledger");

			expect(mockTransactionRepo.createTransaction).not.toHaveBeenCalled();
		});

		it("should validate entries balance via entity fromRequest", async () => {
			const unbalancedRequest: LedgerTransactionRequest = {
				description: "Unbalanced transaction",
				effectiveAt: "2025-01-01T00:00:00Z",
				status: "pending",
				ledgerEntries: [
					{
						id: entryId1.toString(),
						ledgerAccountId: accountId1.toString(),
						currency: "USD",
						currencyExponent: 2,
						amount: 10000,
						direction: "debit",
						status: "pending",
					},
					{
						id: entryId2.toString(),
						ledgerAccountId: accountId2.toString(),
						currency: "USD",
						currencyExponent: 2,
						amount: 5000, // Unbalanced
						direction: "credit",
						status: "pending",
					},
				],
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
			};

			vi.mocked(mockLedgerRepo.getLedger).mockResolvedValue(mockLedger);

			// LedgerTransactionEntity.fromRequest will throw validation error
			await expect(service.createTransaction(orgId, ledgerId, unbalancedRequest)).rejects.toThrow();
		});
	});

	describe("postTransaction", () => {
		it("should post pending transaction successfully", async () => {
			const mockEntries = [
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "debit",
					status: "posted",
				}),
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "credit",
					status: "posted",
				}),
			];

			const postedTransaction = new LedgerTransactionEntity({
				id: transactionId,
				ledgerId,
				organizationId: orgId,
				description: "Test transaction",
				status: "posted",
				effectiveAt: new Date(),
				created: new Date(),
				updated: new Date(),
				entries: mockEntries,
			});

			vi.mocked(mockTransactionRepo.postTransaction).mockResolvedValue(postedTransaction);

			const result = await service.postTransaction(orgId, ledgerId, transactionId);

			expect(result).toEqual(postedTransaction);
			expect(mockTransactionRepo.postTransaction).toHaveBeenCalledWith(orgId, ledgerId, transactionId);
		});
	});

	describe("deleteTransaction", () => {
		it("should delete pending transaction successfully", async () => {
			const mockEntries = [
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "debit",
					status: "pending",
				}),
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "credit",
					status: "pending",
				}),
			];

			const pendingTransaction = new LedgerTransactionEntity({
				id: transactionId,
				ledgerId,
				organizationId: orgId,
				description: "Test transaction",
				status: "pending",
				effectiveAt: new Date(),
				created: new Date(),
				updated: new Date(),
				entries: mockEntries,
			});

			vi.mocked(mockTransactionRepo.getLedgerTransaction).mockResolvedValue(pendingTransaction);
			vi.mocked(mockTransactionRepo.deleteTransactionWithBalanceUpdate).mockResolvedValue(undefined);

			await service.deleteTransaction(orgId, ledgerId, transactionId);

			expect(mockTransactionRepo.getLedgerTransaction).toHaveBeenCalledWith(
				orgId.toString(),
				ledgerId.toString(),
				transactionId.toString()
			);
			expect(mockTransactionRepo.deleteTransactionWithBalanceUpdate).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				transactionId,
				pendingTransaction
			);
		});

		it("should throw ConflictError when deleting posted transaction in production", async () => {
			const mockEntries = [
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "debit",
					status: "posted",
				}),
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "credit",
					status: "posted",
				}),
			];

			const postedTransaction = new LedgerTransactionEntity({
				id: transactionId,
				ledgerId,
				organizationId: orgId,
				description: "Test transaction",
				status: "posted",
				effectiveAt: new Date(),
				created: new Date(),
				updated: new Date(),
				entries: mockEntries,
			});

			vi.mocked(mockTransactionRepo.getLedgerTransaction).mockResolvedValue(postedTransaction);

			// Save original NODE_ENV
			const originalEnv = process.env.NODE_ENV;

			try {
				// Set to production mode
				process.env.NODE_ENV = "production";

				await expect(service.deleteTransaction(orgId, ledgerId, transactionId)).rejects.toThrow(
					ConflictError
				);

				expect(mockTransactionRepo.deleteTransactionWithBalanceUpdate).not.toHaveBeenCalled();
			} finally {
				// Restore original NODE_ENV
				process.env.NODE_ENV = originalEnv;
			}
		});

		it("should allow deleting posted transaction in test mode", async () => {
			const mockEntries = [
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "debit",
					status: "posted",
				}),
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as LedgerTransactionEntryID,
					organizationId: orgId,
					transactionId,
					accountId: new TypeID("lat") as LedgerAccountID,
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "credit",
					status: "posted",
				}),
			];

			const postedTransaction = new LedgerTransactionEntity({
				id: transactionId,
				ledgerId,
				organizationId: orgId,
				description: "Test transaction",
				status: "posted",
				effectiveAt: new Date(),
				created: new Date(),
				updated: new Date(),
				entries: mockEntries,
			});

			vi.mocked(mockTransactionRepo.getLedgerTransaction).mockResolvedValue(postedTransaction);
			vi.mocked(mockTransactionRepo.deleteTransactionWithBalanceUpdate).mockResolvedValue(undefined);

			// Save original NODE_ENV
			const originalEnv = process.env.NODE_ENV;

			try {
				// Set to test mode
				process.env.NODE_ENV = "test";

				await service.deleteTransaction(orgId, ledgerId, transactionId);

				expect(mockTransactionRepo.deleteTransactionWithBalanceUpdate).toHaveBeenCalledWith(
					orgId,
					ledgerId,
					transactionId,
					postedTransaction
				);
			} finally {
				// Restore original NODE_ENV
				process.env.NODE_ENV = originalEnv;
			}
		});
	});
});
