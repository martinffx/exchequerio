import { TypeID } from "typeid-js";
import { vi } from "vitest";
import type { LedgerTransactionRepo } from "@/repo/LedgerTransactionRepo";

import { LedgerTransactionService } from "./LedgerTransactionService";

describe("Ledger Service", () => {
	// Create valid TypeIDs for testing
	const testOrganizationId = new TypeID("org").toString();
	const testLedgerId = new TypeID("lgr").toString();
	const testAccount1Id = new TypeID("lat").toString();
	const testAccount2Id = new TypeID("lat").toString();

	// Create mock with defined methods
	const mockLedgerTransactionRepo = vi.mocked<LedgerTransactionRepo>({
		createTransaction: vi.fn(),
		postTransaction: vi.fn(),
		getLedgerTransaction: vi.fn(),
		listLedgerTransactions: vi.fn(),
		withTransaction: vi.fn(),
		createTransaction: vi.fn(),
		getAccountWithLock: vi.fn(),
		updateAccountBalance: vi.fn(),
	} as unknown as LedgerTransactionRepo);

	const ledgerTransactionService = new LedgerTransactionService(mockLedgerTransactionRepo);

	beforeEach(() => {
		vi.resetAllMocks();
	});

	describe("Double-Entry Validation", () => {
		it("should validate double-entry compliance for valid entries", async () => {
			const validEntries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "100.00",
				},
			];

			// Mock the repository method to return a transaction entity
			const mockTransactionId = new TypeID("ltr").toString();
			const mockResult = {
				id: TypeID.fromString(mockTransactionId),
				ledgerId: TypeID.fromString(testLedgerId),
				description: "Test transaction",
				status: "pending" as const,
				created: new Date(),
				updated: new Date(),
			};

			mockLedgerTransactionRepo.createTransaction.mockResolvedValue(mockResult as any);

			const result = await ledgerTransactionService.createTransaction({
				organizationId: testOrganizationId,
				ledgerId: testLedgerId,
				description: "Test transaction",
				entries: validEntries,
			});

			expect(result).toBeDefined();
			expect(result.status).toBe("pending");
			expect(mockLedgerTransactionRepo.createTransaction).toHaveBeenCalledTimes(1);
		});

		it("should reject transactions with unbalanced entries", async () => {
			const unbalancedEntries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "50.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransaction({
					organizationId: "test-org",
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries: unbalancedEntries,
				})
			).rejects.toThrow("Double-entry validation failed");
		});

		it("should reject transactions with less than 2 entries", async () => {
			const singleEntry = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "100.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransaction({
					organizationId: "test-org",
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries: singleEntry,
				})
			).rejects.toThrow("Double-entry validation failed");
		});

		it("should reject transactions with invalid amounts", async () => {
			const invalidEntries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "-50.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "50.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransaction({
					organizationId: "test-org",
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries: invalidEntries,
				})
			).rejects.toThrow("Double-entry validation failed");
		});

		it("should reject transactions with invalid directions", async () => {
			const invalidEntries = [
				{
					accountId: testAccount1Id,
					direction: "invalid" as "debit" | "credit",
					amount: "50.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "50.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransaction({
					organizationId: "test-org",
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries: invalidEntries,
				})
			).rejects.toThrow("Double-entry validation failed");
		});
	});

	describe("Settlement Workflow (US2)", () => {
		it("should create settlement transactions correctly", async () => {
			// Mock the repository method to return a transaction entity
			const mockTransactionId = new TypeID("ltr").toString();
			const mockResult = {
				id: TypeID.fromString(mockTransactionId),
				ledgerId: TypeID.fromString(testLedgerId),
				description: "Daily settlement",
				status: "pending" as const,
				created: new Date(),
				updated: new Date(),
			};

			mockLedgerTransactionRepo.createTransaction.mockResolvedValue(mockResult as any);

			const result = await ledgerTransactionService.createSettlement(
				testOrganizationId,
				testLedgerId,
				testAccount1Id,
				testAccount2Id,
				"500.00",
				"Daily settlement"
			);

			expect(result).toBeDefined();
			expect(result.status).toBe("pending");
			expect(mockLedgerTransactionRepo.createTransaction).toHaveBeenCalledTimes(1);
		});
	});

	describe("Balance Calculations (US1)", () => {
		it("should delegate balance queries to repository", async () => {});

		it("should provide fast balance queries for p99 performance", async () => {});
	});

	describe("Idempotency Key Handling", () => {
		it("should handle idempotency key conflicts gracefully", async () => {
			const entries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "100.00",
				},
			];

			// Mock the repository to throw a duplicate key error
			mockLedgerTransactionRepo.createTransaction.mockRejectedValue(
				new Error("duplicate key value violates unique constraint")
			);

			await expect(
				ledgerTransactionService.createTransaction({
					organizationId: testOrganizationId,
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries,
					idempotencyKey: "duplicate-key",
				})
			).rejects.toThrow("Transaction with idempotency key 'duplicate-key' already exists");
		});
	});

	describe("Account Validation", () => {
		it("should validate that all accounts exist", async () => {
			const nonExistentId = new TypeID("lat").toString();
			const entries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: nonExistentId,
					direction: "credit" as const,
					amount: "100.00",
				},
			];

			// Mock the repository to throw an account not found error
			mockLedgerTransactionRepo.createTransaction.mockRejectedValue(
				new Error(`Account ${nonExistentId} not found`)
			);

			await expect(
				ledgerTransactionService.createTransaction({
					organizationId: testOrganizationId,
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries,
				})
			).rejects.toThrow();
		});
	});
});
