import { LedgerRepo } from "@/repo/LedgerRepo"
import type { LedgerTransactionRepo } from "@/repo/LedgerTransactionRepo"
import type { DrizzleDB } from "@/repo/types"

import { LedgerTransactionService } from "./LedgerTransactionService"

// Mock database for testing
const mockDatabase = {
	transaction: jest.fn(),
	select: jest.fn(),
	insert: jest.fn(),
	update: jest.fn(),
	delete: jest.fn(),
	from: jest.fn(),
	where: jest.fn(),
	limit: jest.fn(),
	returning: jest.fn(),
	for: jest.fn(),
	set: jest.fn(),
	values: jest.fn(),
	innerJoin: jest.fn(),
	orderBy: jest.fn(),
	offset: jest.fn(),
	_: {},
	query: {},
	$with: jest.fn(),
	$count: jest.fn(),
	$exists: jest.fn(),
	execute: jest.fn(),
	prepare: jest.fn(),
	placeholder: jest.fn(),
	refresh: jest.fn(),
} as unknown

describe("Ledger Transaction Service - Unit Tests", () => {
	let ledgerRepo: LedgerRepo
	let ledgerTransactionService: LedgerTransactionService

	beforeEach(() => {
		jest.clearAllMocks()
		ledgerRepo = new LedgerRepo(mockDatabase as DrizzleDB)
		const mockLedgerTransactionRepo = {} as LedgerTransactionRepo
		ledgerTransactionService = new LedgerTransactionService(mockLedgerTransactionRepo, ledgerRepo)
	})

	describe("Double-Entry Validation", () => {
		it("should validate double-entry compliance for valid entries", async () => {
			// Mock the repo method to avoid actual database calls
			jest.spyOn(ledgerRepo, "getAccountBalance").mockResolvedValue({
				id: "test-account",
				name: "Test Account",
				normalBalance: "debit",
				balanceAmount: "100.00",
				lockVersion: 1,
			})

			jest.spyOn(ledgerRepo, "createTransactionWithEntries").mockResolvedValue({
				id: "test-transaction",
				ledgerId: "test-ledger",
				idempotencyKey: null,
				description: "Test transaction",
				status: "pending",
				postedAt: null,
				effectiveAt: new Date(),
				reversesTransactionId: null,
				metadata: null,
				created: new Date(),
				updated: new Date(),
			})

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
			]

			const result = await ledgerTransactionService.createTransactionWithEntries({
				ledgerId: "test-ledger",
				description: "Test transaction",
				entries: validEntries,
			})

			expect(result).toBeDefined()
			expect((result as { status: string }).status).toBe("pending")
		})

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
			]

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries: unbalancedEntries,
				})
			).rejects.toThrow("Double-entry validation failed")
		})

		it("should reject transactions with less than 2 entries", async () => {
			const singleEntry = [
				{
					accountId: "account1",
					direction: "debit" as const,
					amount: "100.00",
				},
			]

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries: singleEntry,
				})
			).rejects.toThrow("Transaction must have at least 2 entries")
		})

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
			]

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries: invalidEntries,
				})
			).rejects.toThrow("Invalid amount")
		})

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
			]

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries: invalidEntries,
				})
			).rejects.toThrow("Invalid direction")
		})
	})

	describe("Settlement Workflow (US2)", () => {
		it("should create settlement transactions correctly", async () => {
			// Mock account balance responses
			jest
				.spyOn(ledgerRepo, "getAccountBalance")
				.mockResolvedValueOnce({
					id: "merchant-account",
					name: "Merchant Account",
					normalBalance: "debit",
					balanceAmount: "1000.00",
					lockVersion: 1,
				})
				.mockResolvedValueOnce({
					id: "settlement-account",
					name: "Settlement Account",
					normalBalance: "credit",
					balanceAmount: "0.00",
					lockVersion: 1,
				})

			jest.spyOn(ledgerRepo, "createTransactionWithEntries").mockResolvedValue({
				id: "settlement-transaction",
				ledgerId: "test-ledger",
				idempotencyKey: null,
				description: "Daily settlement",
				status: "pending",
				postedAt: null,
				effectiveAt: new Date(),
				reversesTransactionId: null,
				metadata: null,
				created: new Date(),
				updated: new Date(),
			})

			const result = await ledgerTransactionService.createSettlement(
				"merchant-account",
				"settlement-account",
				"500.00",
				"Daily settlement"
			)

			expect(result).toBeDefined()
			expect((result as { status: string }).status).toBe("pending")
			expect(ledgerRepo.createTransactionWithEntries).toHaveBeenCalledWith(
				"",
				"Daily settlement",
				[
					{
						accountId: "merchant-account",
						direction: "debit",
						amount: "500.00",
					},
					{
						accountId: "settlement-account",
						direction: "credit",
						amount: "500.00",
					},
				],
				expect.stringMatching(/settlement-merchant-account-\d+/)
			)
		})
	})

	describe("Balance Calculations (US1)", () => {
		it("should delegate balance queries to repository", async () => {
			const mockBalances = {
				pending: { amount: 150, credits: 200, debits: 50 },
				posted: { amount: 100, credits: 150, debits: 50 },
				available: { amount: 120, credits: 150, debits: 30 },
				currency: "USD",
				currencyExponent: 2,
			}

			jest.spyOn(ledgerRepo, "getAccountBalances").mockResolvedValue(mockBalances)

			const result = await ledgerTransactionService.getAccountBalances("account1", "ledger1")

			expect(result).toEqual(mockBalances)
			expect(ledgerRepo.getAccountBalances).toHaveBeenCalledWith("account1", "ledger1")
		})

		it("should provide fast balance queries for p99 performance", async () => {
			const mockFastBalances = {
				pending: { amount: 100, credits: 0, debits: 0 },
				posted: { amount: 100, credits: 0, debits: 0 },
				available: { amount: 100, credits: 0, debits: 0 },
				currency: "USD",
				currencyExponent: 2,
			}

			jest.spyOn(ledgerRepo, "getAccountBalancesFast").mockResolvedValue(mockFastBalances)

			const result = await ledgerTransactionService.getAccountBalancesFast("account1", "ledger1")

			expect(result).toEqual(mockFastBalances)
			expect(ledgerRepo.getAccountBalancesFast).toHaveBeenCalledWith("account1", "ledger1")
		})
	})

	describe("Idempotency Key Handling", () => {
		it("should handle idempotency key conflicts gracefully", async () => {
			// Mock account balance
			jest.spyOn(ledgerRepo, "getAccountBalance").mockResolvedValue({
				id: "test-account",
				name: "Test Account",
				normalBalance: "debit",
				balanceAmount: "100.00",
				lockVersion: 1,
			})

			// Mock duplicate key error
			jest
				.spyOn(ledgerRepo, "createTransactionWithEntries")
				.mockRejectedValue(new Error("duplicate key value violates unique constraint"))

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
			]

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries,
					idempotencyKey: "duplicate-key",
				})
			).rejects.toThrow("Transaction with idempotency key 'duplicate-key' already exists")
		})
	})

	describe("Account Validation", () => {
		it("should validate that all accounts exist", async () => {
			// Mock first account exists, second doesn't
			jest
				.spyOn(ledgerRepo, "getAccountBalance")
				.mockResolvedValueOnce({
					id: "account1",
					name: "Account 1",
					normalBalance: "debit",
					balanceAmount: "100.00",
					lockVersion: 1,
				})
				.mockRejectedValueOnce(new Error("Account not found"))

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
			]

			await expect(
				ledgerTransactionService.createTransactionWithEntries({
					ledgerId: "test-ledger",
					description: "Test transaction",
					entries,
				})
			).rejects.toThrow("Account not found: nonexistent-account")
		})
	})
})
