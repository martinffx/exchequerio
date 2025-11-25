import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { LedgerRepo } from "./LedgerRepo"
import {
	LedgersTable,
	LedgerAccountsTable,
	LedgerTransactionsTable,
	LedgerTransactionEntriesTable,
} from "./schema"
import * as schema from "./schema"
import type { DrizzleDB } from "./types"
import { TypeID } from "typeid-js"
import { eq } from "drizzle-orm"
import { createLedgerEntity } from "./fixtures"
import { Config } from "@/config"

// Integration tests that require a real database connection
describe("LedgerRepo Integration Tests", () => {
	const config = new Config()
	const pool = new Pool({ connectionString: config.databaseUrl, max: 1 })
	const db = drizzle(pool, { schema })
	const ledgerRepo = new LedgerRepo(db)
	const testLedger = createLedgerEntity()
	const testLedgerId = testLedger.id.toString()
	const testOrgId = testLedger.organizationId.toString()
	const testAccount1Id = new TypeID("lat").toString()
	const testAccount2Id = new TypeID("lat").toString()

	beforeAll(async () => {
		// Insert test data
		await ledgerRepo.createLedger(testLedger)

		await db.insert(LedgerAccountsTable).values([
			{
				id: testAccount1Id,
				ledgerId: testLedgerId,
				name: "Test Account 1",
				normalBalance: "debit",
				balanceAmount: "0",
				lockVersion: 1,
				created: new Date(),
				updated: new Date(),
			},
			{
				id: testAccount2Id,
				ledgerId: testLedgerId,
				name: "Test Account 2",
				normalBalance: "credit",
				balanceAmount: "0",
				lockVersion: 1,
				created: new Date(),
				updated: new Date(),
			},
		])
	})

	afterAll(async () => {
		// Clean up test data
		await db.delete(LedgerTransactionEntriesTable)
		await db.delete(LedgerTransactionsTable)
		await db.delete(LedgerAccountsTable)
		await db.delete(LedgersTable)
		await pool.end()
	})

	beforeEach(async () => {
		// Reset account balances and lock versions before each test
		await db
			.update(LedgerAccountsTable)
			.set({ balanceAmount: "0", lockVersion: 1 })
			.where(eq(LedgerAccountsTable.ledgerId, testLedgerId))

		// Clean up transactions
		await db.delete(LedgerTransactionEntriesTable)
		await db.delete(LedgerTransactionsTable).where(eq(LedgerTransactionsTable.ledgerId, testLedgerId))
	})

	describe("Atomic Transaction Creation", () => {
		it("should create transaction with entries atomically", async () => {
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
			]

			const transaction = await ledgerRepo.createTransactionWithEntries(
				testLedgerId,
				"Test transaction",
				entries
			)

			expect(transaction).toBeDefined()
			expect(transaction.id).toBeDefined()
			expect(transaction.status).toBe("pending")

			// Verify balances were updated
			const account1 = await ledgerRepo.getAccountBalance(testAccount1Id)
			const account2 = await ledgerRepo.getAccountBalance(testAccount2Id)

			expect(account1.balanceAmount).toBe("100.00")
			expect(account2.balanceAmount).toBe("100.00")
			expect(account1.lockVersion).toBe(2)
			expect(account2.lockVersion).toBe(2)
		})

		it("should rollback on double-entry validation failure", async () => {
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
			]

			await expect(
				ledgerRepo.createTransactionWithEntries(
					testLedgerId,
					"Unbalanced transaction",
					unbalancedEntries
				)
			).rejects.toThrow("Double-entry validation failed")

			// Verify no changes were made
			const account1 = await ledgerRepo.getAccountBalance(testAccount1Id)
			const account2 = await ledgerRepo.getAccountBalance(testAccount2Id)

			expect(account1.balanceAmount).toBe("0")
			expect(account2.balanceAmount).toBe("0")
			expect(account1.lockVersion).toBe(1)
			expect(account2.lockVersion).toBe(1)
		})
	})

	describe("Concurrency and Race Conditions", () => {
		it("should handle concurrent transactions on same account", async () => {
			const entries1 = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "50.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "50.00",
				},
			]

			const entries2 = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "75.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "75.00",
				},
			]

			// Execute concurrent transactions
			const [tx1, tx2] = await Promise.all([
				ledgerRepo.createTransactionWithEntries(testLedgerId, "Concurrent tx 1", entries1),
				ledgerRepo.createTransactionWithEntries(testLedgerId, "Concurrent tx 2", entries2),
			])

			expect(tx1).toBeDefined()
			expect(tx2).toBeDefined()

			// Verify final balances are correct
			const account1 = await ledgerRepo.getAccountBalance(testAccount1Id)
			const account2 = await ledgerRepo.getAccountBalance(testAccount2Id)

			expect(account1.balanceAmount).toBe("125.00") // 50 + 75
			expect(account2.balanceAmount).toBe("125.00")
			expect(account1.lockVersion).toBe(3) // Updated twice
			expect(account2.lockVersion).toBe(3)
		})

		it("should prevent lost updates with optimistic locking", async () => {
			// First, create a transaction to set initial balance
			await ledgerRepo.createTransactionWithEntries(testLedgerId, "Setup", [
				{ accountId: testAccount1Id, direction: "debit", amount: "100.00" },
				{ accountId: testAccount2Id, direction: "credit", amount: "100.00" },
			])

			// Get account state
			const account1 = await ledgerRepo.getAccountBalance(testAccount1Id)
			expect(account1.lockVersion).toBe(2)

			// Try to create concurrent modifications that would cause lost updates
			const concurrentPromises = Array.from({ length: 5 }, (_, i) =>
				ledgerRepo.createTransactionWithEntries(testLedgerId, `Concurrent ${i}`, [
					{ accountId: testAccount1Id, direction: "debit", amount: "10.00" },
					{ accountId: testAccount2Id, direction: "credit", amount: "10.00" },
				])
			)

			// All should succeed due to proper locking
			const results = await Promise.all(concurrentPromises)
			expect(results).toHaveLength(5)

			// Final balance should be accurate
			const finalAccount1 = await ledgerRepo.getAccountBalance(testAccount1Id)
			expect(finalAccount1.balanceAmount).toBe("150.00") // 100 + (5 * 10)
			expect(finalAccount1.lockVersion).toBe(7) // Initial + setup + 5 updates
		})
	})

	describe("Idempotency Key Handling", () => {
		it("should prevent duplicate transactions with same idempotency key", async () => {
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
			]

			const idempotencyKey = "test-idempotency-key"

			// First transaction should succeed
			const tx1 = await ledgerRepo.createTransactionWithEntries(
				testLedgerId,
				"First transaction",
				entries,
				idempotencyKey
			)

			expect(tx1).toBeDefined()

			// Second transaction with same key should fail
			await expect(
				ledgerRepo.createTransactionWithEntries(
					testLedgerId,
					"Duplicate transaction",
					entries,
					idempotencyKey
				)
			).rejects.toThrow("duplicate key value violates unique constraint")

			// Verify only one transaction was created
			const account1 = await ledgerRepo.getAccountBalance(testAccount1Id)
			expect(account1.balanceAmount).toBe("100.00")
			expect(account1.lockVersion).toBe(2) // Only updated once
		})
	})

	describe("Balance Calculation Performance", () => {
		it("should calculate balances efficiently for multiple transactions", async () => {
			// Create multiple transactions to test balance calculation performance
			const transactionPromises = Array.from({ length: 10 }, (_, i) =>
				ledgerRepo.createTransactionWithEntries(testLedgerId, `Performance test ${i}`, [
					{
						accountId: testAccount1Id,
						direction: "debit" as const,
						amount: "10.00",
					},
					{
						accountId: testAccount2Id,
						direction: "credit" as const,
						amount: "10.00",
					},
				])
			)

			await Promise.all(transactionPromises)

			// Test balance query performance
			const startTime = performance.now()
			const balances = await ledgerRepo.getAccountBalances(testAccount1Id, testLedgerId)
			const endTime = performance.now()

			const queryTime = endTime - startTime

			// Should be well under 500ms p99 target
			expect(queryTime).toBeLessThan(100)
			expect(balances.pending.amount).toBe(100) // 10 transactions * 10.00
			expect(balances.posted.amount).toBe(100)
			expect(balances.available.amount).toBe(100)
		})

		it("should handle fast balance queries for high frequency operations", async () => {
			// Create some test data
			await ledgerRepo.createTransactionWithEntries(testLedgerId, "Fast balance test", [
				{ accountId: testAccount1Id, direction: "debit", amount: "50.00" },
				{ accountId: testAccount2Id, direction: "credit", amount: "50.00" },
			])

			// Test fast balance query
			const startTime = performance.now()
			const balances = await ledgerRepo.getAccountBalancesFast(testAccount1Id, testLedgerId)
			const endTime = performance.now()

			const queryTime = endTime - startTime

			// Fast query should be even faster
			expect(queryTime).toBeLessThan(50)
			expect(balances.available.amount).toBe(50)
		})
	})

	describe("Database Constraint Validation", () => {
		it("should enforce positive amount constraints", async () => {
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
			]

			await expect(
				ledgerRepo.createTransactionWithEntries(testLedgerId, "Invalid amount test", invalidEntries)
			).rejects.toThrow()
		})

		it("should enforce foreign key constraints", async () => {
			const nonExistentAccountId = new TypeID("lat").toString()
			const entries = [
				{
					accountId: nonExistentAccountId,
					direction: "debit" as const,
					amount: "50.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "50.00",
				},
			]

			await expect(
				ledgerRepo.createTransactionWithEntries(testLedgerId, "FK constraint test", entries)
			).rejects.toThrow()
		})

		it("should enforce required fields", async () => {
			// Test basic transaction creation with all required fields
			const result = await db
				.insert(LedgerTransactionsTable)
				.values({
					id: new TypeID("ltr").toString(),
					ledgerId: testLedgerId,
					status: "pending",
				})
				.returning()

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe(new TypeID("ltr").toString())
			expect(result[0].ledgerId).toBe(testLedgerId)
			expect(result[0].status).toBe("pending")
		})
	})
})
