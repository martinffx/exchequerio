import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { retry } from "radash";
import { TypeID } from "typeid-js";
import { vi } from "vitest";
import { Config } from "@/config";
import { NotFoundError } from "@/errors";
import { LedgerTransactionEntity } from "@/services/entities";
import {
	createLedgerEntity,
	createLedgerTransactionEntity,
	createLedgerTransactionEntryEntity,
} from "./fixtures";
import { LedgerTransactionRepo } from "./LedgerTransactionRepo";
import * as schema from "./schema";
import {
	LedgerAccountsTable,
	LedgersTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
	OrganizationsTable,
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
	const testAccount1Id = new TypeID("lat").toString();
	const testAccount2Id = new TypeID("lat").toString();

	beforeAll(async () => {
		// Create organization first (foreign key requirement)
		await database.insert(OrganizationsTable).values({
			id: testOrgId.toString(),
			name: "Test Organization",
			description: "Test organization for transaction tests",
			created: new Date(),
			updated: new Date(),
		});

		// Insert test ledger
		await database.insert(LedgersTable).values(testLedger.toRecord());

		// Insert test accounts
		await database.insert(LedgerAccountsTable).values([
			{
				id: testAccount1Id,
				organizationId: testOrgId.toString(),
				ledgerId: testLedgerId,
				name: "Test Account 1",
				normalBalance: "debit",
				pendingAmount: 0,
				postedAmount: 0,
				availableAmount: 0,
				pendingCredits: 0,
				pendingDebits: 0,
				postedCredits: 0,
				postedDebits: 0,
				availableCredits: 0,
				availableDebits: 0,
				lockVersion: 1,
				created: new Date(),
				updated: new Date(),
			},
			{
				id: testAccount2Id,
				organizationId: testOrgId.toString(),
				ledgerId: testLedgerId,
				name: "Test Account 2",
				normalBalance: "credit",
				pendingAmount: 0,
				postedAmount: 0,
				availableAmount: 0,
				pendingCredits: 0,
				pendingDebits: 0,
				postedCredits: 0,
				postedDebits: 0,
				availableCredits: 0,
				availableDebits: 0,
				lockVersion: 1,
				created: new Date(),
				updated: new Date(),
			},
		]);
	});

	afterAll(async () => {
		// Clean up test data using direct database queries to avoid entity validation issues
		try {
			// Delete entries first, then transactions (respects FK constraints)
			await database
				.delete(LedgerTransactionEntriesTable)
				.where(
					inArray(
						LedgerTransactionEntriesTable.transactionId,
						database
							.select({ id: LedgerTransactionsTable.id })
							.from(LedgerTransactionsTable)
							.where(eq(LedgerTransactionsTable.ledgerId, testLedgerId))
					)
				);

			await database
				.delete(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.ledgerId, testLedgerId));

			// Delete accounts (direct query since repo enforces no entries constraint)
			await database.delete(LedgerAccountsTable).where(eq(LedgerAccountsTable.ledgerId, testLedgerId));

			// Delete ledger (direct query to avoid account count check)
			await database.delete(LedgersTable).where(eq(LedgersTable.id, testLedgerId));

			// Delete organization (direct query to avoid FK check)
			await database.delete(OrganizationsTable).where(eq(OrganizationsTable.id, testOrgId.toString()));
		} catch (error) {
			console.error("Cleanup error:", error);
		}
		await pool.end();
	});

	beforeEach(async () => {
		// Clean up THIS test file's transactions only (scoped to testLedgerId)
		// This won't affect other test files since they have different ledger IDs
		try {
			// Direct database cleanup to avoid entity validation issues with orphaned data
			// Delete entries first, then transactions (respects FK constraints)
			await database
				.delete(LedgerTransactionEntriesTable)
				.where(
					inArray(
						LedgerTransactionEntriesTable.transactionId,
						database
							.select({ id: LedgerTransactionsTable.id })
							.from(LedgerTransactionsTable)
							.where(eq(LedgerTransactionsTable.ledgerId, testLedgerId))
					)
				);

			await database
				.delete(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.ledgerId, testLedgerId));

			// Reset account balances and lock versions after deleting transactions
			await database
				.update(LedgerAccountsTable)
				.set({
					pendingAmount: 0,
					postedAmount: 0,
					availableAmount: 0,
					pendingCredits: 0,
					pendingDebits: 0,
					postedCredits: 0,
					postedDebits: 0,
					availableCredits: 0,
					availableDebits: 0,
					lockVersion: 1,
				})
				.where(eq(LedgerAccountsTable.ledgerId, testLedgerId));
		} catch (_error) {
			// Ignore cleanup errors
		}
	});

	describe("Transaction Creation with Entries", () => {
		it("should create transaction with entries and update balances atomically", async () => {
			// Arrange
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

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Test transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			// Act
			const result = await repo.createTransaction(transactionEntity);

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

			expect(account1[0].postedAmount).toBe(10000);
			expect(account2[0].postedAmount).toBe(10000);
			expect(account1[0].lockVersion).toBe(2);
			expect(account2[0].lockVersion).toBe(2);
		});

		it("should enforce double-entry accounting rule (debits = credits)", async () => {
			// Arrange
			const unbalancedEntries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: 10000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 5000, // Unbalanced!
				},
			];

			// Act & Assert - createWithEntries should throw during entity creation
			expect(() => {
				(() => {
					const txId = new TypeID("ltr");
					return createLedgerTransactionEntity({
						organizationId: testOrgId,
						ledgerId: testLedger.id,
						description: "Unbalanced transaction",
						entries: unbalancedEntries.map(e =>
							createLedgerTransactionEntryEntity({
								organizationId: testOrgId,
								transactionId: txId,
								accountId: TypeID.fromString<"lat">(e.accountId),
								direction: e.direction,
								amount: e.amount,
							})
						),
					});
				})();
			}).toThrow("Double-entry validation failed");

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

			expect(account1[0].postedAmount).toBe(0);
			expect(account2[0].postedAmount).toBe(0);
			expect(account1[0].lockVersion).toBe(1);
			expect(account2[0].lockVersion).toBe(1);
		});

		it("should enforce organization tenancy", async () => {
			// Arrange
			const wrongOrgId = new TypeID("org");
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

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: wrongOrgId,
				ledgerId: testLedger.id,
				description: "Test transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: wrongOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			// Act & Assert
			await expect(repo.createTransaction(transactionEntity)).rejects.toThrow(NotFoundError);
		});
	});

	describe("Transaction Status Updates", () => {
		it("should post transaction (update status to posted)", async () => {
			// Arrange
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

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Test transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			const createdTransaction = await repo.createTransaction(transactionEntity);

			// Act
			const postedTransaction = await repo.postTransaction(
				testOrgId,
				TypeID.fromString<"lgr">(testLedgerId),
				createdTransaction.id
			);

			// Assert
			expect(postedTransaction.status).toBe("posted");
			expect(postedTransaction.id.toString()).toBe(createdTransaction.id.toString());
		});

		it("should handle posting already posted transaction", async () => {
			// Arrange
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

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Test transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			const createdTransaction = await repo.createTransaction(transactionEntity);

			// Post once
			await repo.postTransaction(
				testOrgId,
				TypeID.fromString<"lgr">(testLedgerId),
				createdTransaction.id
			);

			// Act - Post again
			const postedAgain = await repo.postTransaction(
				testOrgId,
				TypeID.fromString<"lgr">(testLedgerId),
				createdTransaction.id
			);

			// Assert
			expect(postedAgain.status).toBe("posted");
			expect(postedAgain.id.toString()).toBe(createdTransaction.id.toString());
		});

		it("should enforce organization tenancy for postTransaction", async () => {
			// Arrange
			const wrongOrgId = new TypeID("org").toString();
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

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Test transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			const createdTransaction = await repo.createTransaction(transactionEntity);

			// Act & Assert
			await expect(
				repo.postTransaction(
					TypeID.fromString<"org">(wrongOrgId), // Wrong organization
					TypeID.fromString<"lgr">(testLedgerId),
					createdTransaction.id
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
					amount: 10000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 10000,
				},
			];

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Test transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			const createdTransaction = await repo.createTransaction(transactionEntity);

			// Act
			const retrievedTransaction = await repo.getLedgerTransaction(
				testOrgId.toString(),
				testLedgerId,
				createdTransaction.id.toString()
			);

			// Assert
			expect(retrievedTransaction.id.toString()).toBe(createdTransaction.id.toString());
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
					amount: 10000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 10000,
				},
			];

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Test transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			const createdTransaction = await repo.createTransaction(transactionEntity);

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
					amount: 10000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 10000,
				},
			];

			// Create multiple transactions
			for (let i = 0; i < 5; i++) {
				const transactionEntityId = new TypeID("ltr");
				const transactionEntity = createLedgerTransactionEntity({
					id: transactionEntityId,
					organizationId: testOrgId,
					ledgerId: testLedger.id,
					description: `Test transaction ${i}`,
					entries: entries.map(e =>
						createLedgerTransactionEntryEntity({
							organizationId: testOrgId,
							transactionId: transactionEntityId,
							accountId: TypeID.fromString<"lat">(e.accountId),
							direction: e.direction,
							amount: e.amount,
						})
					),
				});

				await repo.createTransaction(transactionEntity);
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
					amount: 5000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 5000,
				},
			];

			const entries2 = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: 7500,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 7500,
				},
			];

			const transactionEntity1Id = new TypeID("ltr");
			const transactionEntity1 = createLedgerTransactionEntity({
				id: transactionEntity1Id,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Concurrent tx 1",
				entries: entries1.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntity1Id,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			const transactionEntity2Id = new TypeID("ltr");
			const transactionEntity2 = createLedgerTransactionEntity({
				id: transactionEntity2Id,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Concurrent tx 2",
				entries: entries2.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntity2Id,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			// Act - Execute concurrent transactions with retry on conflict (exponential backoff + jitter)
			const [tx1, tx2] = await Promise.all([
				retry({ times: 5, backoff: count => 10 * 2 ** count + Math.random() * 10 }, async _exit => {
					return await repo.createTransaction(transactionEntity1);
				}),
				retry({ times: 5, backoff: count => 10 * 2 ** count + Math.random() * 10 }, async _exit => {
					return await repo.createTransaction(transactionEntity2);
				}),
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

			expect(account1[0].postedAmount).toBe(12500); // 5000 + 7500
			expect(account2[0].postedAmount).toBe(12500);
			expect(account1[0].lockVersion).toBe(3); // Updated twice
			expect(account2[0].lockVersion).toBe(3);
		});

		it("should prevent lost updates with optimistic locking", async () => {
			// Arrange - Create initial transaction
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

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Test transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			await repo.createTransaction(transactionEntity);

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
						amount: 1000,
					},
					{
						accountId: testAccount2Id,
						direction: "credit" as const,
						amount: 1000,
					},
				];

				const concurrentTransactionEntityId = new TypeID("ltr");
				const concurrentTransactionEntity = createLedgerTransactionEntity({
					id: concurrentTransactionEntityId,
					organizationId: testOrgId,
					ledgerId: testLedger.id,
					description: `Concurrent transaction ${index}`,
					entries: concurrentEntries.map(e =>
						createLedgerTransactionEntryEntity({
							organizationId: testOrgId,
							transactionId: concurrentTransactionEntityId,
							accountId: TypeID.fromString<"lat">(e.accountId),
							direction: e.direction,
							amount: e.amount,
						})
					),
				});

				return retry(
					{ times: 5, backoff: count => 10 * 2 ** count + Math.random() * 10 },
					async _exit => {
						return await repo.createTransaction(concurrentTransactionEntity);
					}
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

			expect(finalAccount1[0].postedAmount).toBe(15000); // 10000 + (5 * 1000)
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
					amount: 10000,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 10000,
				},
			];

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Invalid account transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			// Get initial state
			const initialAccount2 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount2Id))
				.limit(1);

			// Act & Assert
			await expect(repo.createTransaction(transactionEntity)).rejects.toThrow(NotFoundError);

			// Verify no changes were made (rollback)
			const finalAccount2 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount2Id))
				.limit(1);

			expect(finalAccount2[0].postedAmount).toBe(initialAccount2[0].postedAmount);
			expect(finalAccount2[0].lockVersion).toBe(initialAccount2[0].lockVersion);
		});

		it("should rollback on ledger validation failure", async () => {
			// Arrange
			const wrongLedgerId = new TypeID("lgr").toString();
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

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: TypeID.fromString<"lgr">(wrongLedgerId),
				description: "Wrong ledger transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			// Get initial state
			const initialAccount1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			// Act & Assert
			await expect(repo.createTransaction(transactionEntity)).rejects.toThrow(NotFoundError);

			// Verify no changes were made (rollback)
			const finalAccount1 = await database
				.select()
				.from(LedgerAccountsTable)
				.where(eq(LedgerAccountsTable.id, testAccount1Id))
				.limit(1);

			expect(finalAccount1[0].postedAmount).toBe(initialAccount1[0].postedAmount);
			expect(finalAccount1[0].lockVersion).toBe(initialAccount1[0].lockVersion);
		});
	});

	describe("Financial Integrity", () => {
		it("should maintain accurate balance calculations for multiple transactions", async () => {
			// Arrange
			const transactions = [
				{ debit: 10000, credit: 10000 },
				{ debit: 5000, credit: 5000 },
				{ debit: 2500, credit: 2500 },
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

				const transactionEntityId = new TypeID("ltr");
				const transactionEntity = createLedgerTransactionEntity({
					id: transactionEntityId,
					organizationId: testOrgId,
					ledgerId: testLedger.id,
					description: `Balance test transaction ${index}`,
					entries: entries.map(e =>
						createLedgerTransactionEntryEntity({
							organizationId: testOrgId,
							transactionId: transactionEntityId,
							accountId: TypeID.fromString<"lat">(e.accountId),
							direction: e.direction,
							amount: e.amount,
						})
					),
				});

				await repo.createTransaction(transactionEntity);
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

			const expectedTotal = transactions.reduce((sum, t) => sum + t.debit, 0);

			expect(account1[0].postedAmount).toBe(expectedTotal);
			expect(account2[0].postedAmount).toBe(expectedTotal);
		});

		it("should handle decimal precision correctly", async () => {
			// Arrange
			const entries = [
				{
					accountId: testAccount1Id,
					direction: "debit" as const,
					amount: 1001234,
				},
				{
					accountId: testAccount2Id,
					direction: "credit" as const,
					amount: 1001234,
				},
			];

			const transactionEntityId = new TypeID("ltr");
			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedger.id,
				description: "Setup transaction",
				entries: entries.map(e =>
					createLedgerTransactionEntryEntity({
						organizationId: testOrgId,
						transactionId: transactionEntityId,
						accountId: TypeID.fromString<"lat">(e.accountId),
						direction: e.direction,
						amount: e.amount,
					})
				),
			});

			// Act
			await repo.createTransaction(transactionEntity);

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

			expect(account1[0].postedAmount).toBe(1001234);
			expect(account2[0].postedAmount).toBe(1001234);
		});
	});

	// Note: Transaction handling is now internal via this.db.transaction()
	// Tests for atomic operations are covered in createTransaction and postTransaction tests
});
