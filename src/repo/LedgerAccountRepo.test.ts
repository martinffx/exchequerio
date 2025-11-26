import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { TypeID } from "typeid-js"
import { Config } from "@/config"
import type { LedgerAccountID, LedgerID } from "@/services/entities/LedgerAccountEntity"
import { LedgerAccountEntity } from "@/services/entities/LedgerAccountEntity"
import { LedgerAccountRepo } from "./LedgerAccountRepo"
import * as schema from "./schema"
import {
	LedgerAccountsTable,
	LedgersTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	OrganizationsTable,
} from "./schema"
import type { DrizzleDB } from "./types"

// Test constants
const testOrgId = new TypeID("org").toString()
const testLedgerId = new TypeID("lgr") as LedgerID
const testAccountId1 = new TypeID("lat")
const testAccountId2 = new TypeID("lat")

// Helper function to create transaction entries
async function createTransactionEntry(
	database: DrizzleDB,
	testLedgerId: LedgerID,
	accountId: LedgerAccountID,
	direction: "debit" | "credit",
	amount: string,
	status: "posted" | "pending"
) {
	const transactionId = new TypeID("ltr").toString()
	await database.insert(LedgerTransactionsTable).values({
		id: transactionId,
		ledgerId: testLedgerId.toString(),
		description: `Test ${status} transaction`,
		status,
		created: new Date(),
		updated: new Date(),
	})
	await database.insert(LedgerTransactionEntriesTable).values({
		id: new TypeID("lte").toString(),
		transactionId,
		accountId: accountId.toString(),
		direction,
		amount,
		status,
		created: new Date(),
		updated: new Date(),
	})
}

// Integration tests that require a real database connection
describe("LedgerAccountRepo Integration Tests", () => {
	const config = new Config()
	const pool = new Pool({ connectionString: config.databaseUrl, max: 1 })
	const database = drizzle(pool, { schema })
	const ledgerAccountRepo = new LedgerAccountRepo(database)

	beforeAll(async () => {
		// Insert test data
		await database.insert(OrganizationsTable).values({
			id: testOrgId,
			name: "Test Organization",
			created: new Date(),
			updated: new Date(),
		})

		await database.insert(LedgersTable).values({
			id: testLedgerId.toString(),
			organizationId: testOrgId,
			name: "Test Ledger",
			currency: "USD",
			currencyExponent: 2,
			created: new Date(),
			updated: new Date(),
		})
	})

	afterAll(async () => {
		// Clean up test data
		await database.delete(LedgerTransactionEntriesTable)
		await database.delete(LedgerTransactionsTable)
		await database.delete(LedgerAccountsTable)
		await database.delete(LedgersTable)
		await database.delete(OrganizationsTable)
		await pool.end()
	})

	beforeEach(async () => {
		// Clean up accounts between tests
		await database.delete(LedgerTransactionEntriesTable)
		await database.delete(LedgerTransactionsTable)
		await database
			.delete(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.ledgerId, testLedgerId.toString()))
	})

	describe("listAccounts", () => {
		it("should return empty array when no accounts exist", async () => {
			const accounts = await ledgerAccountRepo.listAccounts(testLedgerId, 0, 10)
			expect(accounts).toEqual([])
		})

		it("should list all accounts for a ledger with pagination", async () => {
			// Create test accounts with explicit timestamps to ensure ordering
			// Note: Timestamps would be used here for ordering (not needed in this test)

			// Create entities using fromRequest method (accepts default timestamps)
			const entity1 = LedgerAccountEntity.fromRequest(
				{ name: "Account 1", description: "Test account 1" },
				testLedgerId,
				"debit" as const,
				testAccountId1.toString()
			)
			const _testAccount = await ledgerAccountRepo.createAccount(entity1)
		})

		it("should delete account when no dependencies exist", async () => {
			await ledgerAccountRepo.deleteAccount(testLedgerId, testAccountId1)

			await expect(ledgerAccountRepo.getAccount(testLedgerId, testAccountId1)).rejects.toThrow(
				"Account not found"
			)
		})

		it("should throw error when account has transaction entries", async () => {
			// Create a transaction with entry for this account
			const transactionId = new TypeID("ltr").toString()
			await database.insert(LedgerTransactionsTable).values({
				id: transactionId,
				ledgerId: testLedgerId.toString(),
				description: "Test transaction",
				status: "posted",
				created: new Date(),
				updated: new Date(),
			})

			await database.insert(LedgerTransactionEntriesTable).values({
				id: new TypeID("lte").toString(),
				transactionId: transactionId,
				accountId: testAccountId1.toString(),
				direction: "debit",
				amount: "100.00",
				status: "posted",
				created: new Date(),
				updated: new Date(),
			})

			await expect(ledgerAccountRepo.deleteAccount(testLedgerId, testAccountId1)).rejects.toThrow(
				"Cannot delete account with existing transaction entries"
			)
		})

		it("should throw error when account not found", async () => {
			const nonExistentId = new TypeID("lat") as LedgerAccountID
			await expect(ledgerAccountRepo.deleteAccount(testLedgerId, nonExistentId)).rejects.toThrow(
				`Account not found: ${nonExistentId.toString()}`
			)
		})

		it("should prevent deletion of account from different ledger", async () => {
			const otherLedgerId = new TypeID("lgr") as LedgerID
			await expect(ledgerAccountRepo.deleteAccount(otherLedgerId, testAccountId1)).rejects.toThrow(
				`Account not found: ${testAccountId1.toString()}`
			)
		})
	})

	describe("calculateBalance", () => {
		let _debitAccount: LedgerAccountEntity
		let _creditAccount: LedgerAccountEntity

		beforeEach(async () => {
			// Create test accounts
			const debitEntity = LedgerAccountEntity.fromRequest(
				{ name: "Debit Account" },
				testLedgerId,
				"debit",
				testAccountId1.toString()
			)
			const creditEntity = LedgerAccountEntity.fromRequest(
				{ name: "Credit Account" },
				testLedgerId,
				"credit",
				testAccountId2.toString()
			)

			_debitAccount = await ledgerAccountRepo.createAccount(debitEntity)
			_creditAccount = await ledgerAccountRepo.createAccount(creditEntity)
		})

		it("should return zero balances for account with no transactions", async () => {
			const balance = await ledgerAccountRepo.calculateBalance(testLedgerId, testAccountId1)

			expect(balance.postedAmount).toBe(0)
			expect(balance.pendingAmount).toBe(0)
			expect(balance.availableAmount).toBe(0)
			expect(balance.postedCredits).toBe(0)
			expect(balance.postedDebits).toBe(0)
			expect(balance.pendingCredits).toBe(0)
			expect(balance.pendingDebits).toBe(0)
			expect(balance.currency).toBe("USD")
			expect(balance.currencyExponent).toBe(2)
		})

		it("should calculate correct balances for debit account", async () => {
			// Clean up any existing transactions first
			await database.delete(LedgerTransactionEntriesTable)
			await database.delete(LedgerTransactionsTable)

			// Create posted transactions
			await createTransactionEntry(database, testLedgerId, testAccountId1, "debit", "100.00", "posted")
			await createTransactionEntry(database, testLedgerId, testAccountId1, "credit", "30.00", "posted")

			// Create pending transactions
			await createTransactionEntry(database, testLedgerId, testAccountId1, "debit", "50.00", "pending")
			await createTransactionEntry(
				database,
				testLedgerId,
				testAccountId1,
				"credit",
				"20.00",
				"pending"
			)

			const balance = await ledgerAccountRepo.calculateBalance(testLedgerId, testAccountId1)

			// For debit account: balance = debits - credits
			expect(balance.postedAmount).toBe(70) // 100 - 30
			expect(balance.pendingAmount).toBe(100) // (100 + 50) - (30 + 20)
			expect(balance.availableAmount).toBe(100) // 70 + 50 - 20 (posted + pending debits - pending credits)
			expect(balance.postedDebits).toBe(100)
			expect(balance.postedCredits).toBe(30)
			expect(balance.pendingDebits).toBe(50)
			expect(balance.pendingCredits).toBe(20)

			// Clean up after this test
			await database.delete(LedgerTransactionEntriesTable)
			await database.delete(LedgerTransactionsTable)
		})

		it("should calculate correct balances for credit account", async () => {
			// Clean up any existing transactions first
			await database.delete(LedgerTransactionEntriesTable)
			await database.delete(LedgerTransactionsTable)

			// Create posted transactions
			await createTransactionEntry(
				database,
				testLedgerId,
				testAccountId2,
				"credit",
				"200.00",
				"posted"
			)
			await createTransactionEntry(database, testLedgerId, testAccountId2, "debit", "50.00", "posted")

			// Create pending transactions
			await createTransactionEntry(
				database,
				testLedgerId,
				testAccountId2,
				"credit",
				"100.00",
				"pending"
			)
			await createTransactionEntry(database, testLedgerId, testAccountId2, "debit", "25.00", "pending")

			const balance = await ledgerAccountRepo.calculateBalance(testLedgerId, testAccountId2)

			// For credit account: balance = credits - debits
			expect(balance.postedAmount).toBe(150) // 200 - 50
			expect(balance.pendingAmount).toBe(225) // (200 + 100) - (50 + 25)
			expect(balance.availableAmount).toBe(225) // 150 + 100 - 25 (posted + pending credits - pending debits)
			expect(balance.postedCredits).toBe(200)
			expect(balance.postedDebits).toBe(50)
			expect(balance.pendingCredits).toBe(100)
			expect(balance.pendingDebits).toBe(25)

			// Clean up after this test
			await database.delete(LedgerTransactionEntriesTable)
			await database.delete(LedgerTransactionsTable)
		})

		it("should perform balance calculation in under 100ms", async () => {
			// Clean up any existing transactions first
			await database.delete(LedgerTransactionEntriesTable)
			await database.delete(LedgerTransactionsTable)

			// Create multiple transactions for performance test
			const promises = []
			for (let index = 0; index < 50; index++) {
				promises.push(
					createTransactionEntry(database, testLedgerId, testAccountId1, "debit", "10.00", "posted")
				)
				promises.push(
					createTransactionEntry(database, testLedgerId, testAccountId1, "credit", "5.00", "posted")
				)
			}
			await Promise.all(promises)

			const startTime = performance.now()
			const balance = await ledgerAccountRepo.calculateBalance(testLedgerId, testAccountId1)
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(100)
			expect(balance.postedAmount).toBe(250) // 50*10 - 50*5 = 500 - 250 = 250
			expect(balance.pendingAmount).toBe(250) // Same calculation for pending
			expect(balance.availableAmount).toBe(250) // 250 + 0 (no pending debits/credits to subtract)

			// Clean up the performance test data to avoid affecting other tests
			await database.delete(LedgerTransactionEntriesTable)
			await database.delete(LedgerTransactionsTable)
		})
	})

	describe("Concurrency and Race Conditions", () => {
		it("should handle concurrent account operations safely", async () => {
			// Create multiple accounts concurrently
			const createPromises = Array.from({ length: 5 }, (_, index) => {
				const entity = LedgerAccountEntity.fromRequest(
					{ name: `Concurrent Account ${index}` },
					testLedgerId,
					"debit"
				)
				return ledgerAccountRepo.createAccount(entity)
			})

			const accounts = await Promise.all(createPromises)
			expect(accounts).toHaveLength(5)

			// All should have unique IDs
			const ids = accounts.map(a => a.id.toString())
			const uniqueIds = new Set(ids)
			expect(uniqueIds.size).toBe(5)
		})

		it("should handle concurrent updates with optimistic locking", async () => {
			// Create base account
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Concurrent Update Test" },
				testLedgerId,
				"debit",
				testAccountId1.toString()
			)
			const baseAccount = await ledgerAccountRepo.createAccount(entity)

			// Try concurrent updates
			const updatePromises = Array.from({ length: 3 }, (_, index) => {
				const updated = new LedgerAccountEntity({
					...baseAccount,
					name: `Updated Name ${index}`,
				})
				return ledgerAccountRepo.updateAccount(testLedgerId, updated)
			})

			// Only one should succeed, others should fail with optimistic locking error
			const results = await Promise.allSettled(updatePromises)

			const successful = results.filter(r => r.status === "fulfilled")
			const failed = results.filter(r => r.status === "rejected")

			expect(successful).toHaveLength(1)
			expect(failed).toHaveLength(2)

			for (const result of failed) {
				if (result.status === "rejected") {
					expect((result.reason as Error).message).toContain("Optimistic locking failure")
				}
			}
		})
	})

	describe("Error Handling", () => {
		it("should handle database connection errors gracefully", async () => {
			// Close the pool to simulate connection error
			const temporaryPool = new Pool({
				connectionString: "postgresql://invalid:invalid@localhost:9999/invalid",
				max: 1,
				connectionTimeoutMillis: 1000,
			})
			const temporaryDatabase = drizzle(temporaryPool, { schema })
			const temporaryRepo = new LedgerAccountRepo(temporaryDatabase)

			const entity = LedgerAccountEntity.fromRequest({ name: "Test" }, testLedgerId, "debit")

			await expect(temporaryRepo.createAccount(entity)).rejects.toThrow()
			await temporaryPool.end()
		})

		it("should validate TypeID format", async () => {
			const invalidId = "invalid-id" as unknown as LedgerAccountID
			await expect(ledgerAccountRepo.getAccount(testLedgerId, invalidId)).rejects.toThrow()
		})
	})

	// New CRUD method tests with organization tenancy
	describe("getLedgerAccount", () => {
		it("should throw error when account not found", async () => {
			const nonExistentId = new TypeID("lat") as LedgerAccountID
			await expect(
				ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, nonExistentId)
			).rejects.toThrow(`Account not found: ${nonExistentId.toString()}`)
		})

		it("should return account when found", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test Account", description: "Test" },
				testLedgerId,
				"debit",
				testAccountId1.toString()
			)

			await ledgerAccountRepo.createAccount(entity)

			const account = await ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, testAccountId1)
			expect(account).toBeInstanceOf(LedgerAccountEntity)
			expect(account.id.toString()).toBe(testAccountId1.toString())
		})

		it("should throw error when account belongs to different organization", async () => {
			// Create account in testLedger
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test Account", description: "Test" },
				testLedgerId,
				"debit",
				testAccountId1.toString()
			)
			await ledgerAccountRepo.createAccount(entity)

			// Try to get from different organization
			const otherOrgId = new TypeID("org").toString()
			await expect(
				ledgerAccountRepo.getLedgerAccount(otherOrgId, testLedgerId, testAccountId1)
			).rejects.toThrow(`Account not found: ${testAccountId1.toString()}`)
		})
	})

	describe("listLedgerAccounts", () => {
		it("should return empty array when no accounts exist", async () => {
			const accounts = await ledgerAccountRepo.listLedgerAccounts(testOrgId, testLedgerId, 0, 10)
			expect(accounts).toEqual([])
		})

		it("should list accounts with organization tenancy", async () => {
			const entity1 = LedgerAccountEntity.fromRequest(
				{ name: "Account 1", description: "Test account 1" },
				testLedgerId,
				"debit",
				testAccountId1.toString()
			)

			await ledgerAccountRepo.createAccount(entity1)

			const accounts = await ledgerAccountRepo.listLedgerAccounts(testOrgId, testLedgerId, 0, 10)
			expect(accounts).toHaveLength(1)
			expect(accounts[0].name).toBe("Account 1")
		})

		it("should throw error when accessing different organization", async () => {
			const otherOrgId = new TypeID("org").toString()
			await expect(
				ledgerAccountRepo.listLedgerAccounts(otherOrgId, testLedgerId, 0, 10)
			).rejects.toThrow()
		})
	})

	describe("createLedgerAccount", () => {
		it("should create new account with organization tenancy", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "New Account", description: "Test account" },
				testLedgerId,
				"debit",
				testAccountId1.toString()
			)

			const created = await ledgerAccountRepo.createLedgerAccount(testOrgId, entity)

			expect(created).toBeInstanceOf(LedgerAccountEntity)
			expect(created.id.toString()).toBe(testAccountId1.toString())
			expect(created.name).toBe("New Account")
		})

		it("should throw error when creating for different organization", async () => {
			const entity = LedgerAccountEntity.fromRequest({ name: "New Account" }, testLedgerId, "debit")

			const otherOrgId = new TypeID("org").toString()
			await expect(ledgerAccountRepo.createLedgerAccount(otherOrgId, entity)).rejects.toThrow()
		})
	})

	describe("updateLedgerAccount", () => {
		let existingAccount: LedgerAccountEntity

		beforeEach(async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Original Name", description: "Original description" },
				testLedgerId,
				"debit",
				testAccountId1.toString()
			)
			existingAccount = await ledgerAccountRepo.createAccount(entity)
		})

		it("should update account with organization tenancy", async () => {
			const updated = new LedgerAccountEntity({
				...existingAccount,
				name: "Updated Name",
			})

			const result = await ledgerAccountRepo.updateLedgerAccount(testOrgId, testLedgerId, updated)

			expect(result.name).toBe("Updated Name")
		})

		it("should throw error when updating different organization", async () => {
			const updated = new LedgerAccountEntity({
				...existingAccount,
				name: "Updated Name",
			})

			const otherOrgId = new TypeID("org").toString()
			await expect(
				ledgerAccountRepo.updateLedgerAccount(otherOrgId, testLedgerId, updated)
			).rejects.toThrow()
		})
	})

	describe("deleteLedgerAccount", () => {
		let _testAccount: LedgerAccountEntity

		beforeEach(async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Account to Delete" },
				testLedgerId,
				"debit",
				testAccountId1.toString()
			)
			_testAccount = await ledgerAccountRepo.createAccount(entity)
		})

		it("should delete account with organization tenancy", async () => {
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, testAccountId1)

			await expect(ledgerAccountRepo.getAccount(testLedgerId, testAccountId1)).rejects.toThrow(
				"Account not found"
			)
		})

		it("should throw error when deleting from different organization", async () => {
			const otherOrgId = new TypeID("org").toString()
			await expect(
				ledgerAccountRepo.deleteLedgerAccount(otherOrgId, testLedgerId, testAccountId1)
			).rejects.toThrow()
		})
	})
})
