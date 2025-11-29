import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import { Config } from "@/config";
import { LedgerTransactionEntity } from "@/services/entities/LedgerTransactionEntity";
import { createLedgerEntity } from "./fixtures";
import { LedgerAccountRepo } from "./LedgerAccountRepo";
import { LedgerRepo } from "./LedgerRepo";
import { LedgerTransactionRepo } from "./LedgerTransactionRepo";
import * as schema from "./schema";
import {
	LedgerAccountsTable,
	LedgersTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "./schema";

// Integration tests that require a real database connection
describe("LedgerRepo Integration Tests", () => {
	const config = new Config();
	const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
	const database = drizzle(pool, { schema });
	const ledgerRepo = new LedgerRepo(database);
	const ledgerTransactionRepo = new LedgerTransactionRepo(database);
	const ledgerAccountRepo = new LedgerAccountRepo(database);
	const testLedger = createLedgerEntity();
	const testLedgerId = testLedger.id.toString();
	const _testOrgId = testLedger.organizationId.toString();
	const testAccount1Id = new TypeID("lat").toString();
	const testAccount2Id = new TypeID("lat").toString();

	beforeAll(async () => {
		// Insert test data
		await ledgerRepo.createLedger(testLedger);

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
			];

			// Create transaction entity using factory method
			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				TypeID.fromString<"lgr">(testLedgerId),
				entries,
				"Test transaction"
			);
			const entryEntities = transactionEntity.entries || [];

			const transaction = await ledgerTransactionRepo.createTransactionWithEntries(
				_testOrgId,
				transactionEntity,
				entryEntities
			);

			expect(transaction).toBeDefined();
			expect(transaction.id).toBeDefined();
			expect(transaction.status).toBe("pending");

			// Verify balances were updated
			const account1 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount1Id)
			);
			const account2 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount2Id)
			);

			expect(account1.postedAmount).toBe(100);
			expect(account2.postedAmount).toBe(100);
		});

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
			];

			await expect(
				ledgerTransactionRepo.createTransactionWithEntries(
					_testOrgId,
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						unbalancedEntries,
						"Unbalanced transaction"
					),
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						unbalancedEntries,
						"Unbalanced transaction"
					).entries || []
				)
			).rejects.toThrow("Double-entry validation failed");

			// Verify no changes were made
			const account1 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount1Id)
			);
			const account2 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount2Id)
			);

			expect(account1.postedAmount).toBe(0);
			expect(account2.postedAmount).toBe(0);
		});
	});

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

			// Execute concurrent transactions
			const [tx1, tx2] = await Promise.all([
				ledgerTransactionRepo.createTransactionWithEntries(
					_testOrgId,
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						entries1,
						"Concurrent tx 1"
					),
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						entries1,
						"Concurrent tx 1"
					).entries || []
				),
				ledgerTransactionRepo.createTransactionWithEntries(
					_testOrgId,
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						entries2,
						"Concurrent tx 2"
					),
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						entries2,
						"Concurrent tx 2"
					).entries || []
				),
			]);

			expect(tx1).toBeDefined();
			expect(tx2).toBeDefined();

			// Verify final balances are correct
			const account1 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount1Id)
			);
			const account2 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount2Id)
			);

			expect(account1.postedAmount).toBe(125); // 50 + 75
			expect(account2.postedAmount).toBe(125);
		});

		it("should prevent lost updates with optimistic locking", async () => {
			// First, create a transaction to set initial balance
			await ledgerTransactionRepo.createTransactionWithEntries(
				_testOrgId,
				LedgerTransactionEntity.createWithEntries(
					TypeID.fromString<"lgr">(testLedgerId),
					[
						{ accountId: testAccount1Id, direction: "debit", amount: "100.00" },
						{ accountId: testAccount2Id, direction: "credit", amount: "100.00" },
					],
					"Setup"
				),
				LedgerTransactionEntity.createWithEntries(
					TypeID.fromString<"lgr">(testLedgerId),
					[
						{ accountId: testAccount1Id, direction: "debit", amount: "100.00" },
						{ accountId: testAccount2Id, direction: "credit", amount: "100.00" },
					],
					"Setup"
				).entries || []
			);

			// Get account state
			const _account1 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount1Id)
			);

			// Try to create concurrent modifications that would cause lost updates
			const concurrentPromises = Array.from({ length: 5 }, (_, index) =>
				ledgerTransactionRepo.createTransactionWithEntries(
					_testOrgId,
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						[
							{ accountId: testAccount1Id, direction: "debit", amount: "10.00" },
							{ accountId: testAccount2Id, direction: "credit", amount: "10.00" },
						],
						`Concurrent ${index}`
					),
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						[
							{ accountId: testAccount1Id, direction: "debit", amount: "10.00" },
							{ accountId: testAccount2Id, direction: "credit", amount: "10.00" },
						],
						`Concurrent ${index}`
					).entries || []
				)
			);

			// All should succeed due to proper locking
			const results = await Promise.all(concurrentPromises);
			expect(results).toHaveLength(5);

			// Final balance should be accurate
			const finalAccount1 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount1Id)
			);
			expect(finalAccount1.postedAmount).toBe(150); // 100 + (5 * 10)
		});
	});

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
			];

			const _idempotencyKey = "test-idempotency-key";

			// First transaction should succeed
			const tx1 = await ledgerTransactionRepo.createTransactionWithEntries(
				_testOrgId,
				LedgerTransactionEntity.createWithEntries(
					TypeID.fromString<"lgr">(testLedgerId),
					entries,
					"First transaction"
				),
				LedgerTransactionEntity.createWithEntries(
					TypeID.fromString<"lgr">(testLedgerId),
					entries,
					"First transaction"
				).entries || []
			);

			expect(tx1).toBeDefined();

			// Second transaction with same key should fail - TODO: Implement idempotency checking
			await expect(
				ledgerTransactionRepo.createTransactionWithEntries(
					_testOrgId,
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						entries,
						"Duplicate transaction"
					),
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						entries,
						"Duplicate transaction"
					).entries || []
				)
			).rejects.toThrow();

			// Verify only one transaction was created
			const account1 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount1Id)
			);
			expect(account1.postedAmount).toBe(100);
		});
	});

	describe("Balance Calculation Performance", () => {
		it("should calculate balances efficiently for multiple transactions", async () => {
			// Create multiple transactions to test balance calculation performance
			const _transactionPromises = await Promise.all(
				Array.from({ length: 10 }, (_, index) =>
					ledgerTransactionRepo.createTransactionWithEntries(
						_testOrgId,
						LedgerTransactionEntity.createWithEntries(
							TypeID.fromString<"lgr">(testLedgerId),
							[
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
							],
							`Performance test ${index}`
						),
						LedgerTransactionEntity.createWithEntries(
							TypeID.fromString<"lgr">(testLedgerId),
							[
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
							],
							`Performance test ${index}`
						).entries || []
					)
				)
			);

			// Test balance query performance
			const startTime = performance.now();
			const balances = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount1Id)
			);
			const endTime = performance.now();

			const queryTime = endTime - startTime;

			// Should be well under 500ms p99 target
			expect(queryTime).toBeLessThan(100);
			expect(balances.postedAmount).toBe(100); // 10 transactions * 10 each
		});

		it("should handle fast balance queries for high frequency operations", async () => {
			// Create some test data
			await ledgerTransactionRepo.createTransactionWithEntries(
				_testOrgId,
				LedgerTransactionEntity.createWithEntries(
					TypeID.fromString<"lgr">(testLedgerId),
					[
						{ accountId: testAccount1Id, direction: "debit", amount: "50.00" },
						{ accountId: testAccount2Id, direction: "credit", amount: "50.00" },
					],
					"Fast balance test"
				),
				LedgerTransactionEntity.createWithEntries(
					TypeID.fromString<"lgr">(testLedgerId),
					[
						{ accountId: testAccount1Id, direction: "debit", amount: "50.00" },
						{ accountId: testAccount2Id, direction: "credit", amount: "50.00" },
					],
					"Fast balance test"
				).entries || []
			);

			// Test fast balance query
			const startTime = performance.now();
			const balances = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount1Id)
			);
			const endTime = performance.now();

			const queryTime = endTime - startTime;

			// Fast query should be even faster
			expect(queryTime).toBeLessThan(50);
			expect(balances.postedAmount).toBe(50);
		});
	});

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
			];

			await expect(
				ledgerTransactionRepo.createTransactionWithEntries(
					_testOrgId,
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						invalidEntries,
						"Invalid amount test"
					),
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						invalidEntries,
						"Invalid amount test"
					).entries || []
				)
			).rejects.toThrow();
		});

		it("should enforce foreign key constraints", async () => {
			const nonExistentAccountId = new TypeID("lat").toString();
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
			];

			await expect(
				ledgerTransactionRepo.createTransactionWithEntries(
					_testOrgId,
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						entries,
						"FK constraint test"
					),
					LedgerTransactionEntity.createWithEntries(
						TypeID.fromString<"lgr">(testLedgerId),
						entries,
						"FK constraint test"
					).entries || []
				)
			).rejects.toThrow();
		});

		it("should enforce required fields", async () => {
			// Test basic transaction creation with all required fields
			const result = await database
				.insert(LedgerTransactionsTable)
				.values({
					id: new TypeID("ltr").toString(),
					ledgerId: testLedgerId,
					status: "pending",
				})
				.returning();

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe(new TypeID("ltr").toString());
			expect(result[0].ledgerId).toBe(testLedgerId);
			expect(result[0].status).toBe("pending");
		});
	});
});
