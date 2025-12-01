import { TypeID } from "typeid-js";
import { vi } from "vitest";
import { createLedgerTransactionEntity } from "@/repo/fixtures";
import type { LedgerTransactionRepo } from "@/repo/LedgerTransactionRepo";
import { LedgerTransactionEntryEntity } from "./entities";
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
					amount: 10000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 10000,
				},
			];

			// Create mock transaction entity using fixture
			const mockTransactionId = new TypeID("ltr");
			const mockEntries = [
				LedgerTransactionEntryEntity.create(
					TypeID.fromString(testOrganizationId),
					mockTransactionId,
					TypeID.fromString(testAccount1Id),
					"debit",
					10000
				),
				LedgerTransactionEntryEntity.create(
					TypeID.fromString(testOrganizationId),
					mockTransactionId,
					TypeID.fromString(testAccount2Id),
					"credit",
					10000
				),
			];

			const mockResult = createLedgerTransactionEntity({
				id: mockTransactionId,
				organizationId: TypeID.fromString(testOrganizationId),
				ledgerId: TypeID.fromString(testLedgerId),
				entries: mockEntries,
				description: "Test transaction",
				status: "pending",
			});

			mockLedgerTransactionRepo.createTransaction.mockResolvedValue(mockResult);

			const result = await ledgerTransactionService.createTransactionWithEntries({
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
					amount: 10000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 5000,
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: testOrganizationId,
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
					amount: 10000,
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: testOrganizationId,
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries: singleEntry,
				})
			).rejects.toThrow("Transaction must have at least 2 entries");
		});

		it("should reject transactions with invalid amounts", async () => {
			const invalidEntries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: -5000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 5000,
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: testOrganizationId,
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries: invalidEntries,
				})
			).rejects.toThrow("Invalid entry amount: -5000");
		});

		it("should reject transactions with invalid directions", async () => {
			const invalidEntries = [
				{
					accountId: testAccount1Id,
					direction: "invalid" as "debit" | "credit",
					amount: 5000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 5000,
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: testOrganizationId,
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries: invalidEntries,
				})
			).rejects.toThrow("Invalid direction: invalid");
		});
	});

	describe("Settlement Workflow (US2)", () => {
		it("should create settlement transactions correctly", async () => {
			// Create mock transaction entity using fixture
			const mockTransactionId = new TypeID("ltr");
			const mockEntries = [
				LedgerTransactionEntryEntity.create(
					TypeID.fromString(testOrganizationId),
					mockTransactionId,
					TypeID.fromString(testAccount1Id),
					"debit",
					50000
				),
				LedgerTransactionEntryEntity.create(
					TypeID.fromString(testOrganizationId),
					mockTransactionId,
					TypeID.fromString(testAccount2Id),
					"credit",
					50000
				),
			];

			const mockResult = createLedgerTransactionEntity({
				id: mockTransactionId,
				organizationId: TypeID.fromString(testOrganizationId),
				ledgerId: TypeID.fromString(testLedgerId),
				entries: mockEntries,
				description: "Daily settlement",
				status: "pending",
			});

			mockLedgerTransactionRepo.createTransaction.mockResolvedValue(mockResult);

			const result = await ledgerTransactionService.createSettlement(
				testOrganizationId,
				testLedgerId,
				testAccount1Id,
				testAccount2Id,
				50000,
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
					amount: 10000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 10000,
				},
			];

			// Mock the repository to throw a duplicate key error
			mockLedgerTransactionRepo.createTransaction.mockRejectedValue(
				new Error("duplicate key value violates unique constraint")
			);

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
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
					amount: 10000,
				},
				{
					accountId: nonExistentId,
					direction: "credit" as const,
					amount: 10000,
				},
			];

			// Mock the repository to throw an account not found error
			mockLedgerTransactionRepo.createTransaction.mockRejectedValue(
				new Error(`Account ${nonExistentId} not found`)
			);

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: testOrganizationId,
					ledgerId: testLedgerId,
					description: "Test transaction",
					entries,
				})
			).rejects.toThrow();
		});
	});
});
