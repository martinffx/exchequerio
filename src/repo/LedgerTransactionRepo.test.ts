import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import { vi } from "vitest";
import { Config } from "@/config";
import { ConflictError, NotFoundError } from "@/errors";
import { LedgerTransactionEntity } from "@/services/entities";
import { createLedgerEntity } from "./fixtures";
import { LedgerTransactionRepo } from "./LedgerTransactionRepo";
import * as schema from "./schema";
import {
	LedgerAccountsTable,
	LedgersTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "./schema";

// Mock uuid to avoid ES module issues
vi.mock("uuid", () => ({
	v7: vi.fn(() => `mock-uuid-${Math.random().toString(36).substr(2, 9)}`),
}));

// Integration tests that require a real database connection
describe("LedgerTransactionRepo Integration Tests", () => {
	const config = new Config();
	const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
	const database = drizzle(pool, { schema });
	const repo = new LedgerTransactionRepo(database);

	// Test fixtures
	const testOrgId = new TypeID("org");
	const testLedger = createLedgerEntity({ organizationId: testOrgId });
	const testLedgerId = testLedger.id.toString();
	const testAccount1Id = new TypeID("lac").toString();
	const testAccount2Id = new TypeID("lac").toString();

	beforeAll(async () => {
		// Insert test ledger
		await database.insert(LedgersTable).values(testLedger.toRecord());

		// Insert test accounts
		await database.insert(LedgerAccountsTable).values([
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
		]);
	});

	afterAll(async () => {
		// Clean up test data
		await database.delete(LedgerTransactionEntriesTable);
		await database.delete(LedgerTransactionsTable);
		await database.delete(LedgerAccountsTable);
		await database.delete(LedgersTable);
		await pool.end();
	});

	beforeEach(async () => {
		// Reset account balances and lock versions before each test
		await database
			.update(LedgerAccountsTable)
			.set({ balanceAmount: "0", lockVersion: 1 })
			.where(eq(LedgerAccountsTable.ledgerId, testLedgerId));

		// Clean up transactions
		await database.delete(LedgerTransactionEntriesTable);
		await database
			.delete(LedgerTransactionsTable)
			.where(eq(LedgerTransactionsTable.ledgerId, testLedgerId));
	});

	describe("Transaction Creation with Entries", () => {
		it("should create transaction with entries and update balances atomically", async () => {
			// Arrange
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

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Test transaction"
			);

			// Act
			const result = await repo.createTransactionWithEntries(
				testOrgId.toString(),
				transactionEntity,
				transactionEntity.entries ?? []
			);

			// Assert
			expect(result).toBeDefined();
			expect(result.id).toBeDefined();
			expect(result.status).toBe("pending");
			expect(result.description).toBe("Test transaction");

			// Verify balances were updated
			const account1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			const account2 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount2Id))
				.limit(1);

			expect(account1[0].balanceAmount).toBe("100.00");
			expect(account2[0].balanceAmount).toBe("100.00");
			expect(account1[0].lockVersion).toBe(2);
			expect(account2[0].lockVersion).toBe(2);
		});

		it("should enforce double-entry accounting rule (debits = credits)", async () => {
			// Arrange
			const unbalancedEntries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "50.00", // Unbalanced!
				},
			];

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				unbalancedEntries,
				"Unbalanced transaction"
			);

			// Act & Assert
			await expect(
				repo.createTransactionWithEntries(
					testOrgId.toString(),
					transactionEntity,
					transactionEntity.entries ?? []
				)
			).rejects.toThrow(ConflictError);

			// Verify no changes were made (rollback)
			const account1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			const account2 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount2Id))
				.limit(1);

			expect(account1[0].balanceAmount).toBe("0");
			expect(account2[0].balanceAmount).toBe("0");
			expect(account1[0].lockVersion).toBe(1);
			expect(account2[0].lockVersion).toBe(1);
		});

		it("should enforce organization tenancy", async () => {
			// Arrange
			const wrongOrgId = new TypeID("org").toString();
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

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Test transaction"
			);

			// Act & Assert
			await expect(
				repo.createTransactionWithEntries(
					wrongOrgId, // Wrong organization
					transactionEntity,
					transactionEntity.entries ?? []
				)
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("Transaction Status Updates", () => {
		it("should post transaction (update status to posted)", async () => {
			// Arrange
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

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Test transaction"
			);

			const createdTransaction = await repo.createTransactionWithEntries(
				testOrgId.toString(),
				transactionEntity,
				transactionEntity.entries ?? []
			);

			// Act
			const postedTransaction = await repo.postTransaction(
				testOrgId.toString(),
				testLedgerId,
				createdTransaction.id.toString()
			);

			// Assert
			expect(postedTransaction.status).toBe("posted");
			expect(postedTransaction.id).toBe(createdTransaction.id);
		});

		it("should handle posting already posted transaction", async () => {
			// Arrange
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

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Test transaction"
			);

			const createdTransaction = await repo.createTransactionWithEntries(
				testOrgId.toString(),
				transactionEntity,
				transactionEntity.entries ?? []
			);

			// Post once
			await repo.postTransaction(testOrgId.toString(), testLedgerId, createdTransaction.id.toString());

			// Act - Post again
			const postedAgain = await repo.postTransaction(
				testOrgId.toString(),
				testLedgerId,
				createdTransaction.id.toString()
			);

			// Assert
			expect(postedAgain.status).toBe("posted");
			expect(postedAgain.id).toBe(createdTransaction.id);
		});

		it("should enforce organization tenancy for postTransaction", async () => {
			// Arrange
			const wrongOrgId = new TypeID("org").toString();
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

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Test transaction"
			);

			const createdTransaction = await repo.createTransactionWithEntries(
				testOrgId.toString(),
				transactionEntity,
				transactionEntity.entries ?? []
			);

			// Act & Assert
			await expect(
				repo.postTransaction(
					wrongOrgId, // Wrong organization
					testLedgerId,
					createdTransaction.id.toString()
				)
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("Transaction Retrieval", () => {
		it("should get single transaction with organization tenancy", async () => {
			// Arrange
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

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Test transaction"
			);

			const createdTransaction = await repo.createTransactionWithEntries(
				testOrgId.toString(),
				transactionEntity,
				transactionEntity.entries ?? []
			);

			// Act
			const retrievedTransaction = await repo.getLedgerTransaction(
				testOrgId.toString(),
				testLedgerId,
				createdTransaction.id.toString()
			);

			// Assert
			expect(retrievedTransaction.id).toBe(createdTransaction.id);
			expect(retrievedTransaction.description).toBe("Test transaction");
			expect(retrievedTransaction.status).toBe("pending");
		});

		it("should throw NotFoundError for wrong organization", async () => {
			// Arrange
			const wrongOrgId = new TypeID("org").toString();
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

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Test transaction"
			);

			const createdTransaction = await repo.createTransactionWithEntries(
				testOrgId.toString(),
				transactionEntity,
				transactionEntity.entries ?? []
			);

			// Act & Assert
			await expect(
				repo.getLedgerTransaction(
					wrongOrgId, // Wrong organization
					testLedgerId,
					createdTransaction.id.toString()
				)
			).rejects.toThrow(NotFoundError);
		});

		it("should list transactions with pagination and organization tenancy", async () => {
			// Arrange
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

			// Create multiple transactions
			for (let i = 0; i < 5; i++) {
				const transactionEntity = LedgerTransactionEntity.createWithEntries(
					testLedger.id,
					entries,
					`Test transaction ${i}`
				);

				await repo.createTransactionWithEntries(
					testOrgId.toString(),
					transactionEntity,
					transactionEntity.entries ?? []
				);
			}

			// Act
			const transactions = await repo.listLedgerTransactions(
				testOrgId.toString(),
				testLedgerId,
				0, // offset
				3 // limit
			);

			// Assert
			expect(transactions).toHaveLength(3);
			expect(transactions[0]).toBeInstanceOf(LedgerTransactionEntity);

			// Verify they are ordered by created date descending
			for (let i = 0; i < transactions.length - 1; i++) {
				expect(transactions[i].created.getTime()).toBeGreaterThanOrEqual(
					transactions[i + 1].created.getTime()
				);
			}
		});
	});

	describe("Concurrent Transaction Handling", () => {
		it("should handle concurrent transactions on same account with proper locking", async () => {
			// Arrange
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
			];

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
			];

			const transactionEntity1 = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries1,
				"Concurrent tx 1"
			);

			const transactionEntity2 = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries2,
				"Concurrent tx 2"
			);

			// Act - Execute concurrent transactions
			const [tx1, tx2] = await Promise.all([
				repo.createTransactionWithEntries(
					testOrgId.toString(),
					transactionEntity1,
					transactionEntity1.entries ?? []
				),
				repo.createTransactionWithEntries(
					testOrgId.toString(),
					transactionEntity2,
					transactionEntity2.entries ?? []
				),
			]);

			// Assert
			expect(tx1).toBeDefined();
			expect(tx2).toBeDefined();

			// Verify final balances are correct
			const account1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			const account2 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount2Id))
				.limit(1);

			expect(account1[0].balanceAmount).toBe("125.00"); // 50 + 75
			expect(account2[0].balanceAmount).toBe("125.00");
			expect(account1[0].lockVersion).toBe(3); // Updated twice
			expect(account2[0].lockVersion).toBe(3);
		});

		it("should prevent lost updates with optimistic locking", async () => {
			// Arrange - Create initial transaction
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

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Setup transaction"
			);

			await repo.createTransactionWithEntries(
				testOrgId.toString(),
				transactionEntity,
				transactionEntity.entries ?? []
			);

			// Get account state
			const account1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			expect(account1[0].lockVersion).toBe(2);

			// Act - Create multiple concurrent transactions
			const concurrentPromises = Array.from({ length: 5 }, (_, index) => {
				const concurrentEntries = [
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
				];

				const concurrentTransactionEntity = LedgerTransactionEntity.createWithEntries(
					testLedger.id,
					concurrentEntries,
					`Concurrent transaction ${index}`
				);

				return repo.createTransactionWithEntries(
					testOrgId.toString(),
					concurrentTransactionEntity,
					concurrentTransactionEntity.entries ?? []
				);
			});

			const results = await Promise.all(concurrentPromises);

			// Assert
			expect(results).toHaveLength(5);

			// Final balance should be accurate
			const finalAccount1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			expect(finalAccount1[0].balanceAmount).toBe("150.00"); // 100 + (5 * 10)
			expect(finalAccount1[0].lockVersion).toBe(7); // Initial + setup + 5 updates
		});
	});

	describe("Rollback Scenarios", () => {
		it("should rollback on account not found error", async () => {
			// Arrange
			const nonExistentAccountId = new TypeID("lac").toString();
			const entries = [
				{
					accountId: nonExistentAccountId,
					direction: "debit" as const,
					amount: "100.00",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "100.00",
				},
			];

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Invalid account transaction"
			);

			// Get initial state
			const initialAccount2 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount2Id))
				.limit(1);

			// Act & Assert
			await expect(
				repo.createTransactionWithEntries(
					testOrgId.toString(),
					transactionEntity,
					transactionEntity.entries ?? []
				)
			).rejects.toThrow(NotFoundError);

			// Verify no changes were made (rollback)
			const finalAccount2 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount2Id))
				.limit(1);

			expect(finalAccount2[0].balanceAmount).toBe(initialAccount2[0].balanceAmount);
			expect(finalAccount2[0].lockVersion).toBe(initialAccount2[0].lockVersion);
		});

		it("should rollback on ledger validation failure", async () => {
			// Arrange
			const wrongLedgerId = new TypeID("lgr").toString();
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

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				TypeID.fromString<"lgr">(wrongLedgerId), // Wrong ledger
				entries,
				"Wrong ledger transaction"
			);

			// Get initial state
			const initialAccount1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			// Act & Assert
			await expect(
				repo.createTransactionWithEntries(
					testOrgId.toString(),
					transactionEntity,
					transactionEntity.entries ?? []
				)
			).rejects.toThrow(NotFoundError);

			// Verify no changes were made (rollback)
			const finalAccount1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			expect(finalAccount1[0].balanceAmount).toBe(initialAccount1[0].balanceAmount);
			expect(finalAccount1[0].lockVersion).toBe(initialAccount1[0].lockVersion);
		});
	});

	describe("Financial Integrity", () => {
		it("should maintain accurate balance calculations for multiple transactions", async () => {
			// Arrange
			const transactions = [
				{ debit: "100.00", credit: "100.00" },
				{ debit: "50.00", credit: "50.00" },
				{ debit: "25.00", credit: "25.00" },
			];

			// Act - Create multiple transactions
			for (const [index, amounts] of transactions.entries()) {
				const entries = [
					{
						accountId: testAccount1Id,
						direction: "debit" as const,
						amount: amounts.debit,
					},
					{
						accountId: testAccount2Id,
						direction: "credit" as const,
						amount: amounts.credit,
					},
				];

				const transactionEntity = LedgerTransactionEntity.createWithEntries(
					testLedger.id,
					entries,
					`Balance test transaction ${index}`
				);

				await repo.createTransactionWithEntries(
					testOrgId.toString(),
					transactionEntity,
					transactionEntity.entries ?? []
				);
			}

			// Assert - Verify final balances
			const account1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			const account2 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount2Id))
				.limit(1);

			const expectedTotal = transactions.reduce((sum, t) => sum + Number.parseFloat(t.debit), 0);

			expect(account1[0].balanceAmount).toBe(expectedTotal.toFixed(2));
			expect(account2[0].balanceAmount).toBe(expectedTotal.toFixed(2));
		});

		it("should handle decimal precision correctly", async () => {
			// Arrange
			const entries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: "100.1234",
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: "100.1234",
				},
			];

			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				testLedger.id,
				entries,
				"Precision test transaction"
			);

			// Act
			await repo.createTransactionWithEntries(
				testOrgId.toString(),
				transactionEntity,
				transactionEntity.entries ?? []
			);

			// Assert
			const account1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			const account2 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount2Id))
				.limit(1);

			expect(account1[0].balanceAmount).toBe("100.1234");
			expect(account2[0].balanceAmount).toBe("100.1234");
		});
	});

	describe("Database Transaction Wrapper", () => {
		it("should provide withTransaction method for atomic operations", async () => {
			// Act & Assert
			expect(typeof repo.withTransaction).toBe("function");

			// Test that it can execute a simple transaction
			const result = await repo.withTransaction(async tx => {
				const testRecord = await tx
					.select()
					.from(LedgersTable)
					.where(eq(LedgersTable.id, testLedgerId))
					.limit(1);

				return testRecord[0].name;
			});

			expect(result).toBe("Ledger");
		});
	});
});
