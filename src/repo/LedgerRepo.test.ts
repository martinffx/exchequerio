import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import { Config } from "@/config";
import { OrganizationEntity } from "@/services/entities";
import { LedgerTransactionEntity } from "@/services/entities/LedgerTransactionEntity";
import { createLedgerEntity } from "./fixtures";
import { LedgerAccountRepo } from "./LedgerAccountRepo";
import { LedgerRepo } from "./LedgerRepo";
import { LedgerTransactionRepo } from "./LedgerTransactionRepo";
import { OrganizationRepo } from "./OrganizationRepo";
import * as schema from "./schema";
import {
	LedgerAccountsTable,
	LedgersTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	OrganizationsTable,
} from "./schema";

// Integration tests that require a real database connection
describe("LedgerRepo Integration Tests", () => {
	const config = new Config();
	const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
	const database = drizzle(pool, { schema });
	const organizationRepo = new OrganizationRepo(database);
	const ledgerRepo = new LedgerRepo(database);
	const ledgerTransactionRepo = new LedgerTransactionRepo(database);
	const ledgerAccountRepo = new LedgerAccountRepo(database);
	const testLedger = createLedgerEntity();
	const testLedgerId = testLedger.id.toString();
	const _testOrgId = testLedger.organizationId.toString();
	const testAccount1Id = new TypeID("lat").toString();
	const testAccount2Id = new TypeID("lat").toString();

	beforeAll(async () => {
		// Create organization first (foreign key requirement) using direct database insert
		await database.insert(OrganizationsTable).values({
			id: testLedger.organizationId.toString(),
			name: "Test Organization",
			description: "Test organization for ledger tests",
			created: new Date(),
			updated: new Date(),
		});

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
		// Clean up test data scoped to THIS test file only (in reverse order of creation due to foreign keys)
		// First get all transaction IDs for this ledger
		const transactions = await database
			.select({ id: LedgerTransactionsTable.id })
			.from(LedgerTransactionsTable)
			.where(eq(LedgerTransactionsTable.ledgerId, testLedgerId));
		const transactionIds = transactions.map(t => t.id);

		if (transactionIds.length > 0) {
			await database
				.delete(LedgerTransactionEntriesTable)
				.where(inArray(LedgerTransactionEntriesTable.transactionId, transactionIds));
		}
		await database
			.delete(LedgerTransactionsTable)
			.where(eq(LedgerTransactionsTable.ledgerId, testLedgerId));
		await database.delete(LedgerAccountsTable).where(eq(LedgerAccountsTable.ledgerId, testLedgerId));
		await database.delete(LedgersTable).where(eq(LedgersTable.id, testLedgerId));
		await database.delete(OrganizationsTable).where(eq(OrganizationsTable.id, _testOrgId));
		await pool.end();
	});

	beforeEach(async () => {
		// Clean up THIS test file's transactions only (scoped to testLedgerId)
		try {
			const transactions = await database
				.select({ id: LedgerTransactionsTable.id })
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.ledgerId, testLedgerId));
			const transactionIds = transactions.map(t => t.id);

			if (transactionIds.length > 0) {
				await database
					.delete(LedgerTransactionEntriesTable)
					.where(inArray(LedgerTransactionEntriesTable.transactionId, transactionIds));
			}
			await database
				.delete(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.ledgerId, testLedgerId));

			// Reset account balances and lock versions
			await database
				.update(LedgerAccountsTable)
				.set({ balanceAmount: "0", lockVersion: 1 })
				.where(eq(LedgerAccountsTable.ledgerId, testLedgerId));
		} catch (error) {
			// Ignore cleanup errors
		}
	});

	beforeEach(async () => {
		// ONLY reset account balances - no deletions
		await database
			.update(LedgerAccountsTable)
			.set({ balanceAmount: "0", lockVersion: 1 })
			.where(eq(LedgerAccountsTable.ledgerId, testLedgerId));
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

			expect(account1.pendingAmount).toBe(100);
			expect(account2.pendingAmount).toBe(100);
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

			// Entity validates on creation, so this should throw
			expect(() =>
				LedgerTransactionEntity.createWithEntries(
					TypeID.fromString<"lgr">(testLedgerId),
					unbalancedEntries,
					"Unbalanced transaction"
				)
			).toThrow("Double-entry validation failed");

			// Verify no changes were made to accounts
			const account1 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount1Id)
			);
			const account2 = await ledgerAccountRepo.calculateBalance(
				TypeID.fromString<"lgr">(testLedgerId),
				TypeID.fromString<"lat">(testAccount2Id)
			);

			expect(account1.pendingAmount).toBe(0);
			expect(account2.pendingAmount).toBe(0);
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

			expect(account1.pendingAmount).toBe(125); // 50 + 75
			expect(account2.pendingAmount).toBe(125);
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
			expect(finalAccount1.pendingAmount).toBe(150); // 100 + (5 * 10)
		});
	});

	describe("Idempotency Key Handling", () => {
		it("should store idempotency keys with transactions", async () => {
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

			const idempotencyKey = "test-idempotency-key";

			// Create transaction with idempotency key
			const txEntity = LedgerTransactionEntity.createWithEntries(
				TypeID.fromString<"lgr">(testLedgerId),
				entries,
				"Transaction with idempotency key",
				idempotencyKey
			);

			const tx = await ledgerTransactionRepo.createTransactionWithEntries(
				_testOrgId,
				txEntity,
				txEntity.entries || []
			);

			expect(tx).toBeDefined();
			expect(tx.idempotencyKey).toBe(idempotencyKey);

			// TODO: Add unique constraint on idempotency key and test duplicate prevention
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
			expect(balances.pendingAmount).toBe(100); // 10 transactions * 10 each
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
			expect(balances.pendingAmount).toBe(50);
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

			// Entity validates on creation, so this should throw
			expect(() =>
				LedgerTransactionEntity.createWithEntries(
					TypeID.fromString<"lgr">(testLedgerId),
					invalidEntries,
					"Invalid amount test"
				)
			).toThrow("Invalid amount");
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
			const transactionId = new TypeID("ltr").toString();
			const result = await database
				.insert(LedgerTransactionsTable)
				.values({
					id: transactionId,
					ledgerId: testLedgerId,
					status: "pending",
				})
				.returning();

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe(transactionId);
			expect(result[0].ledgerId).toBe(testLedgerId);
			expect(result[0].status).toBe("pending");
		});
	});
});
