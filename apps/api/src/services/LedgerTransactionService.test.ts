import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { BadRequestError, ConflictError } from "@/lib/errors";
import { LedgerAccountEntity } from "../repo/entities/LedgerAccountEntity";
import { LedgerTransactionEntity } from "../repo/entities/LedgerTransactionEntity";
import { LedgerTransactionEntryEntity } from "../repo/entities/LedgerTransactionEntryEntity";
import type {
	LedgerAccountID,
	LedgerID,
	LedgerTransactionEntryID,
	LedgerTransactionID,
	OrgID,
} from "../repo/entities/types";
import type { LedgerAccountReader } from "../repo/LedgerAccountReader";
import type { LedgerTransactionRepo } from "../repo/LedgerTransactionRepo";
import type { LedgerTransactionRequest } from "../routes/ledgers/schema";
import { LedgerTransactionService } from "./LedgerTransactionService";

describe("LedgerTransactionService", () => {
	const orgId = new TypeID("org") as OrgID;
	const ledgerId = new TypeID("lgr") as LedgerID;
	const transactionId = new TypeID("ltr") as LedgerTransactionID;

	const mockTransactionRepo = vi.mocked<LedgerTransactionRepo>({
		listLedgerTransactions: vi.fn(),
		getLedgerTransaction: vi.fn(),
		createTransaction: vi.fn(),
		postTransaction: vi.fn(),
		deleteTransactionWithBalanceUpdate: vi.fn(),
	} as unknown as LedgerTransactionRepo);
	const mockAccountReader = vi.mocked<LedgerAccountReader>({
		getByIds: vi.fn(),
	} as unknown as LedgerAccountReader);
	const service = new LedgerTransactionService(mockTransactionRepo, mockAccountReader);

	afterEach(() => {
		vi.clearAllMocks();
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

			mockTransactionRepo.listLedgerTransactions.mockResolvedValue(mockTransactions);

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
			mockTransactionRepo.listLedgerTransactions.mockResolvedValue([]);

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

			mockTransactionRepo.getLedgerTransaction.mockResolvedValue(mockTransaction);

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
					accountId: accountId1.toString(),
					currency: "USD",
					currencyExponent: 2,
					amount: 10000,
					direction: "debit",
					status: "pending",
				},
				{
					id: entryId2.toString(),
					accountId: accountId2.toString(),
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
		const account = (
			id: LedgerAccountID,
			currencyCode = "USD",
			minorUnitExponent = 2
		): LedgerAccountEntity =>
			new LedgerAccountEntity({
				id,
				organizationId: orgId,
				ledgerId,
				name: "Account",
				normalBalance: "debit",
				currencyCode,
				minorUnitExponent,
				pendingAmount: 0,
				postedAmount: 0,
				availableAmount: 0,
				pendingCredits: 0,
				pendingDebits: 0,
				postedCredits: 0,
				postedDebits: 0,
				availableCredits: 0,
				availableDebits: 0,
				lockVersion: 1,
				created: new Date(),
				updated: new Date(),
			});

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
							accountId: TypeID.fromString(e.accountId) as LedgerAccountID,
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

			mockAccountReader.getByIds.mockResolvedValue([
				account(accountId1, "EUR", 2),
				account(accountId2, "EUR", 2),
			]);
			mockTransactionRepo.createTransaction.mockResolvedValue(mockCreatedTransaction);

			const result = await service.createTransaction(orgId, ledgerId, validRequest);

			expect(result).toEqual(mockCreatedTransaction);
			expect(mockAccountReader.getByIds).toHaveBeenCalledOnce();
			expect(mockAccountReader.getByIds).toHaveBeenCalledWith(orgId, ledgerId, [
				accountId1,
				accountId2,
			]);
			expect(mockTransactionRepo.createTransaction).toHaveBeenCalledWith(
				expect.any(LedgerTransactionEntity)
			);
			const created = mockTransactionRepo.createTransaction.mock.calls[0]?.[0];
			expect(created?.entries.every(entry => entry.currency === "EUR")).toBe(true);
		});

		it("rejects more than 200 distinct accounts before reading accounts", async () => {
			const request: LedgerTransactionRequest = {
				...validRequest,
				ledgerEntries: Array.from({ length: 201 }, (_, index) => ({
					id: new TypeID("lte").toString(),
					accountId: new TypeID("lat").toString(),
					currency: "USD",
					currencyExponent: 2,
					amount: 1,
					direction: index % 2 === 0 ? ("debit" as const) : ("credit" as const),
					status: "pending" as const,
				})),
			};

			await expect(service.createTransaction(orgId, ledgerId, request)).rejects.toEqual(
				new BadRequestError("A Transaction may reference at most 200 distinct Accounts")
			);
			expect(mockAccountReader.getByIds).not.toHaveBeenCalled();
			expect(mockTransactionRepo.createTransaction).not.toHaveBeenCalled();
		});

		it("accepts 200 distinct accounts with one bulk read", async () => {
			const accountIds = Array.from({ length: 200 }, () => new TypeID("lat") as LedgerAccountID);
			const request: LedgerTransactionRequest = {
				...validRequest,
				ledgerEntries: accountIds.map((accountId, index) => ({
					id: new TypeID("lte").toString(),
					accountId: accountId.toString(),
					currency: "USD",
					currencyExponent: 2,
					amount: 1,
					direction: index < 100 ? ("debit" as const) : ("credit" as const),
					status: "pending" as const,
				})),
			};
			mockAccountReader.getByIds.mockResolvedValue(accountIds.map(accountId => account(accountId)));
			mockTransactionRepo.createTransaction.mockImplementation(async transaction => transaction);

			const transaction = await service.createTransaction(orgId, ledgerId, request);

			expect(transaction.entries).toHaveLength(200);
			expect(mockAccountReader.getByIds).toHaveBeenCalledOnce();
			expect(mockAccountReader.getByIds).toHaveBeenCalledWith(orgId, ledgerId, accountIds);
		});

		it("should fail when a referenced account is not found", async () => {
			mockAccountReader.getByIds.mockRejectedValue(new Error("Account not found"));

			await expect(service.createTransaction(orgId, ledgerId, validRequest)).rejects.toThrow(
				"Account"
			);

			expect(mockTransactionRepo.createTransaction).not.toHaveBeenCalled();
		});

		it("rejects accounts with different currency pairs", async () => {
			mockAccountReader.getByIds.mockResolvedValue([
				account(accountId1, "USD", 2),
				account(accountId2, "JPY", 0),
			]);

			await expect(service.createTransaction(orgId, ledgerId, validRequest)).rejects.toThrow(
				"same currency"
			);
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
						accountId: accountId1.toString(),
						currency: "USD",
						currencyExponent: 2,
						amount: 10000,
						direction: "debit",
						status: "pending",
					},
					{
						id: entryId2.toString(),
						accountId: accountId2.toString(),
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

			mockAccountReader.getByIds.mockResolvedValue([account(accountId1), account(accountId2)]);

			// LedgerTransactionEntity.fromRequest will throw validation error
			await expect(service.createTransaction(orgId, ledgerId, unbalancedRequest)).rejects.toThrow();
		});

		it("should reject duplicate accounts in transaction", async () => {
			const duplicateAccountRequest: LedgerTransactionRequest = {
				description: "Duplicate account transaction",
				effectiveAt: "2025-01-01T00:00:00Z",
				status: "pending",
				ledgerEntries: [
					{
						id: entryId1.toString(),
						accountId: accountId1.toString(), // Same account
						currency: "USD",
						currencyExponent: 2,
						amount: 10000,
						direction: "debit",
						status: "pending",
					},
					{
						id: entryId2.toString(),
						accountId: accountId1.toString(), // Duplicate account
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

			mockAccountReader.getByIds.mockResolvedValue([account(accountId1)]);

			// LedgerTransactionEntity.fromRequest will throw validation error
			await expect(
				service.createTransaction(orgId, ledgerId, duplicateAccountRequest)
			).rejects.toThrow("Duplicate account in transaction");
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

			mockTransactionRepo.postTransaction.mockResolvedValue(postedTransaction);

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

			mockTransactionRepo.getLedgerTransaction.mockResolvedValue(pendingTransaction);

			mockTransactionRepo.deleteTransactionWithBalanceUpdate.mockResolvedValue(undefined);

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

			mockTransactionRepo.getLedgerTransaction.mockResolvedValue(postedTransaction);

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

			mockTransactionRepo.getLedgerTransaction.mockResolvedValue(postedTransaction);

			mockTransactionRepo.deleteTransactionWithBalanceUpdate.mockResolvedValue(undefined);

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
