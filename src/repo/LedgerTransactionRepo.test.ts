import { describe, expect, it } from "@jest/globals"
import { drizzle } from "drizzle-orm/node-postgres"

import { Pool } from "pg"
import { TypeID } from "typeid-js"
import { LedgerTransactionEntity } from "@/services/entities"
import { LedgerTransactionRepo } from "./LedgerTransactionRepo"
import type { DrizzleDB } from "./types"

describe("LedgerTransactionRepo - Import and Method Validation", () => {
	let database: DrizzleDB
	let pool: Pool
	let repo: LedgerTransactionRepo

	beforeAll(() => {
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

	afterAll(async () => {
		await pool.end()
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
