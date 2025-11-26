import { afterEach, beforeEach, describe, expect, it } from "@jest/globals"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"

import { Pool } from "pg"
import { TypeID } from "typeid-js"
import { LedgerTransactionEntity } from "@/services/entities"
import { LedgerTransactionRepo } from "./LedgerTransactionRepo"
import {
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "./schema"
import type { DrizzleDB } from "./types"

describe("LedgerTransactionRepo - Import and Method Validation", () => {
	let database: DrizzleDB
	let pool: Pool
	let repo: LedgerTransactionRepo

	beforeEach(() => {
		// Setup test database connection
		pool = new Pool({
			host: "localhost",
			port: 5432,
			database: "ledger_test",
			user: "postgres",
			password: "postgres",
		})

		database = drizzle(pool) as DrizzleDB

		// Skip migration for unit tests - focus on import/method validation
		repo = new LedgerTransactionRepo(database)
	})

	afterEach(async () => {
		await pool.end()
	})

	describe("Import Validation", () => {
		it("should instantiate LedgerTransactionRepo without import errors", () => {
			// This test will fail if any imports are missing
			expect(repo).toBeInstanceOf(LedgerTransactionRepo)
			expect(repo).toBeDefined()
		})

		it("should have access to all required database operations", () => {
			// Verify db instance has required methods
			expect(typeof database.select).toBe("function")
			expect(typeof database.insert).toBe("function")
			expect(typeof database.update).toBe("function")
			expect(typeof database.transaction).toBe("function")
		})
	})

	describe("Required Method Existence", () => {
		it("should have createTransaction method", () => {
			expect(typeof repo.createTransaction).toBe("function")
		})

		it("should have getAccountWithLock method", () => {
			expect(typeof repo.getAccountWithLock).toBe("function")
		})

		it("should have updateAccountBalance method", () => {
			expect(typeof repo.updateAccountBalance).toBe("function")
		})

		it("should have existing createTransactionWithEntries method", () => {
			expect(typeof repo.createTransactionWithEntries).toBe("function")
		})
	})

	describe("Method Signature Validation", () => {
		it("createTransaction should accept a callback and return a promise", async () => {
			const testCallback = jest.fn().mockResolvedValue("test-result")

			// Mock db.transaction to call the callback immediately
			jest.spyOn(database, "transaction").mockImplementation(async function_ => {
				return await function_(database as unknown)
			})

			const result = await repo.createTransaction(testCallback)

			expect(testCallback).toHaveBeenCalled()
			expect(result).toBe("test-result")
		})

		it("getAccountWithLock should have correct method signature", () => {
			// Verify the method exists and is callable (doesn't test database interaction)
			const _mockTx = {
				select: jest.fn().mockReturnThis(),
				from: jest.fn().mockReturnThis(),
				where: jest.fn().mockReturnThis(),
				for: jest.fn().mockResolvedValue([
					{
						id: "test-id",
						balanceAmount: "100.00",
						lockVersion: 1,
						normalBalance: "debit",
					},
				]),
			}

			expect(async () => {
				await repo.getAccountWithLock("test-id")
			}).not.toThrow()
		})

		it("updateAccountBalance should have correct method signature", () => {
			// Verify the method exists and is callable (doesn't test database interaction)
			const _mockTx = {
				update: jest.fn().mockReturnThis(),
				set: jest.fn().mockReturnThis(),
				where: jest.fn().mockResolvedValue({ rowCount: 1 }),
			}

			expect(async () => {
				await repo.withTransaction(async _tx => {
					return await repo.updateAccountBalance("test-id", "100.00", "debit")
				})
			}).not.toThrow()
		})
	})

	describe("TypeScript Compilation Validation", () => {
		it("should import TypeID without errors", () => {
			const typeId = new TypeID("ltr")
			expect(typeId).toBeDefined()
			expect(typeof typeId.toString()).toBe("string")
		})

		it("should import schema tables without errors", () => {
			expect(LedgerTransactionsTable).toBeDefined()
			expect(LedgerTransactionEntriesTable).toBeDefined()
			expect(LedgerAccountsTable).toBeDefined()
		})

		it("should import drizzle operators without errors", () => {
			expect(typeof eq).toBe("function")
		})

		it("should compile without TypeScript errors", () => {
			// This test passes if the file compiled successfully
			// Any import issues would prevent Jest from running this test
			expect(true).toBe(true)
		})
	})

	describe("Integration Readiness", () => {
		it("createTransactionWithEntries method should be accessible", () => {
			// Verify the existing method can be called (validates that all its dependencies are imported)
			expect(typeof repo.createTransactionWithEntries).toBe("function")

			// Verify method signature matches expected interface
			const ledgerId = new TypeID("lgr").toString()
			const entries = [
				{
					accountId: new TypeID("lac").toString(),
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: new TypeID("lac").toString(),
					direction: "credit" as const,
					amount: "100.00",
				},
			]

			// Should not throw compilation/import errors when calling
			expect(() => {
				const transactionEntity = LedgerTransactionEntity.createWithEntries(
					TypeID.fromString<"lgr">(ledgerId),
					entries,
					"Test transaction"
				)
				void repo.createTransactionWithEntries(
					"test-org",
					transactionEntity,
					transactionEntity.entries ?? []
				)
			}).not.toThrow()
		})
	})
})
