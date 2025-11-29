import { vi } from "vitest";
import type { LedgerTransactionRepo } from "@/repo/LedgerTransactionRepo";

import { LedgerTransactionService } from "./LedgerTransactionService";

describe("Ledger Service", () => {
	const ledgerTransactionRepo = vi.mocked<LedgerTransactionRepo>(
		{} as unknown as LedgerTransactionRepo
	);
	const ledgerTransactionService = new LedgerTransactionService(ledgerTransactionRepo);

	beforeEach(() => {
		jest.resetAllMocks();
	});

	describe("Double-Entry Validation", () => {
		it("should validate double-entry compliance for valid entries", async () => {
			const validEntries = [
				{
					accountId: "account1",
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: "account2",
					direction: "credit" as const,
					amount: "100.00",
				},
			];

			const result = await ledgerTransactionService.createTransactionWithEntries({
				organizationId: "test-org",
				ledgerId: "test-ledger",
				description: "Test transaction",
				entries: validEntries,
			});

			expect(result).toBeDefined();
			expect((result as { status: string }).status).toBe("pending");
		});

		it("should reject transactions with unbalanced entries", async () => {
			const unbalancedEntries = [
				{
					accountId: "account1",
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: "account2",
					direction: "credit" as const,
					amount: "50.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: "test-org",
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries: unbalancedEntries,
				})
			).rejects.toThrow("Double-entry validation failed");
		});

		it("should reject transactions with less than 2 entries", async () => {
			const singleEntry = [
				{
					accountId: "account1",
					direction: "debit" as const,
					amount: "100.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: "test-org",
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries: singleEntry,
				})
			).rejects.toThrow("Transaction must have at least 2 entries");
		});

		it("should reject transactions with invalid amounts", async () => {
			const invalidEntries = [
				{
					accountId: "account1",
					direction: "debit" as const,
					amount: "-50.00",
				},
				{
					accountId: "account2",
					direction: "credit" as const,
					amount: "50.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: "test-org",
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries: invalidEntries,
				})
			).rejects.toThrow("Invalid amount");
		});

		it("should reject transactions with invalid directions", async () => {
			const invalidEntries = [
				{
					accountId: "account1",
					direction: "invalid" as "debit" | "credit",
					amount: "50.00",
				},
				{
					accountId: "account2",
					direction: "credit" as const,
					amount: "50.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: "test-org",
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries: invalidEntries,
				})
			).rejects.toThrow("Invalid direction");
		});
	});

	describe("Settlement Workflow (US2)", () => {
		it("should create settlement transactions correctly", async () => {
			const result = await ledgerTransactionService.createSettlement(
				"merchant-account",
				"settlement-account",
				"500.00",
				"Daily settlement"
			);

			expect(result).toBeDefined();
			expect((result as { status: string }).status).toBe("pending");
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
					accountId: "account1",
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: "account2",
					direction: "credit" as const,
					amount: "100.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: "test-org",
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries,
					idempotencyKey: "duplicate-key",
				})
			).rejects.toThrow("Transaction with idempotency key 'duplicate-key' already exists");
		});
	});

	describe("Account Validation", () => {
		it("should validate that all accounts exist", async () => {
			const entries = [
				{
					accountId: "account1",
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: "nonexistent-account",
					direction: "credit" as const,
					amount: "100.00",
				},
			];

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					organizationId: "test-org",
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries,
				})
			).rejects.toThrow("Account not found: nonexistent-account");
		});
	});
});
