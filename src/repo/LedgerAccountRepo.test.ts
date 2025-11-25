import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { LedgerAccountRepo } from "./LedgerAccountRepo";
import {
	LedgersTable,
	LedgerAccountsTable,
	LedgerTransactionsTable,
	LedgerTransactionEntriesTable,
	OrganizationsTable,
} from "./schema";
import * as schema from "./schema";
import type { DrizzleDB } from "./types";
import { TypeID } from "typeid-js";
import { eq, and } from "drizzle-orm";
import { LedgerAccountEntity } from "@/services/entities/LedgerAccountEntity";
import type {
	LedgerAccountID,
	LedgerID,
} from "@/services/entities/LedgerAccountEntity";

import { Config } from "@/config";

// Test constants
const testOrgId = new TypeID("org").toString();
const testLedgerId = new TypeID("lgr") as LedgerID;
const testAccountId1 = new TypeID("lat") as LedgerAccountID;
const testAccountId2 = new TypeID("lat") as LedgerAccountID;

// Integration tests that require a real database connection
describe("LedgerAccountRepo Integration Tests", () => {
	const config = new Config();
	const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
	const db = drizzle(pool, { schema });
	const ledgerAccountRepo = new LedgerAccountRepo(db);

	beforeAll(async () => {
		// Insert test data
		await db.insert(OrganizationsTable).values({
			id: testOrgId,
			name: "Test Organization",
			created: new Date(),
			updated: new Date(),
		});

		await db.insert(LedgersTable).values({
			id: testLedgerId.toString(),
			organizationId: testOrgId,
			name: "Test Ledger",
			currency: "USD",
			currencyExponent: 2,
			created: new Date(),
			updated: new Date(),
		});
	});

	afterAll(async () => {
		// Clean up test data
		await db.delete(LedgerTransactionEntriesTable);
		await db.delete(LedgerTransactionsTable);
		await db.delete(LedgerAccountsTable);
		await db.delete(LedgersTable);
		await db.delete(OrganizationsTable);
		await pool.end();
	});

	beforeEach(async () => {
		// Clean up accounts between tests
		await db.delete(LedgerTransactionEntriesTable);
		await db.delete(LedgerTransactionsTable);
		await db
			.delete(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.ledgerId, testLedgerId.toString()));
	});

	describe("listAccounts", () => {
		it("should return empty array when no accounts exist", async () => {
			const accounts = await ledgerAccountRepo.listAccounts(
				testLedgerId,
				0,
				10,
			);
			expect(accounts).toEqual([]);
		});

		it("should list all accounts for a ledger with pagination", async () => {
			// Create test accounts with explicit timestamps to ensure ordering
			const created1 = new Date();
			const created2 = new Date(created1.getTime() + 1000); // 1 second later

			const entity1 = LedgerAccountEntity.fromRequest(
				{ name: "Account 1", description: "Test account 1" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			// Override created timestamp
			(entity1 as any).created = created1;
			(entity1 as any).updated = created1;

			const entity2 = LedgerAccountEntity.fromRequest(
				{ name: "Account 2", description: "Test account 2" },
				testLedgerId,
				"credit",
				testAccountId2.toString(),
			);
			// Override created timestamp to be later
			(entity2 as any).created = created2;
			(entity2 as any).updated = created2;

			await ledgerAccountRepo.createAccount(entity1);
			await ledgerAccountRepo.createAccount(entity2);

			// Test pagination - first page
			const page1 = await ledgerAccountRepo.listAccounts(testLedgerId, 0, 1);
			expect(page1).toHaveLength(1);
			expect(page1[0].name).toBe("Account 2"); // Should be ordered by created desc

			// Test pagination - second page
			const page2 = await ledgerAccountRepo.listAccounts(testLedgerId, 1, 1);
			expect(page2).toHaveLength(1);
			expect(page2[0].name).toBe("Account 1");

			// Test getting all
			const all = await ledgerAccountRepo.listAccounts(testLedgerId, 0, 10);
			expect(all).toHaveLength(2);
		});

		it("should filter accounts by name pattern", async () => {
			// Create test accounts with different names
			const merchant1 = LedgerAccountEntity.fromRequest(
				{ name: "Merchant Wallet ABC", description: "Merchant account" },
				testLedgerId,
				"debit",
				new TypeID("lat").toString(),
			);
			const merchant2 = LedgerAccountEntity.fromRequest(
				{ name: "Merchant Wallet XYZ", description: "Another merchant" },
				testLedgerId,
				"debit",
				new TypeID("lat").toString(),
			);
			const fee = LedgerAccountEntity.fromRequest(
				{ name: "Fee Account", description: "Fee account" },
				testLedgerId,
				"credit",
				new TypeID("lat").toString(),
			);

			await ledgerAccountRepo.createAccount(merchant1);
			await ledgerAccountRepo.createAccount(merchant2);
			await ledgerAccountRepo.createAccount(fee);

			// Filter by pattern
			const merchantAccounts = await ledgerAccountRepo.listAccounts(
				testLedgerId,
				0,
				10,
				"Merchant%",
			);
			expect(merchantAccounts).toHaveLength(2);
			merchantAccounts.forEach((account) => {
				expect(account.name).toContain("Merchant");
			});

			// Filter by specific name
			const feeAccounts = await ledgerAccountRepo.listAccounts(
				testLedgerId,
				0,
				10,
				"Fee%",
			);
			expect(feeAccounts).toHaveLength(1);
			expect(feeAccounts[0].name).toBe("Fee Account");
		});

		it("should return accounts as properly formed entities", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{
					name: "Test Account",
					description: "Test",
					metadata: { type: "merchant" },
				},
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);

			await ledgerAccountRepo.createAccount(entity);

			const accounts = await ledgerAccountRepo.listAccounts(
				testLedgerId,
				0,
				10,
			);
			expect(accounts).toHaveLength(1);

			const account = accounts[0];
			expect(account).toBeInstanceOf(LedgerAccountEntity);
			expect(account.id.toString()).toBe(testAccountId1.toString());
			expect(account.ledgerId.toString()).toBe(testLedgerId.toString());
			expect(account.name).toBe("Test Account");
			expect(account.description).toBe("Test");
			expect(account.normalBalance).toBe("debit");
			expect(account.balanceAmount).toBe("0");
			expect(account.metadata).toEqual({ type: "merchant" });
		});
	});

	describe("getAccount", () => {
		it("should throw error when account not found", async () => {
			const nonExistentId = new TypeID("lat") as LedgerAccountID;
			await expect(
				ledgerAccountRepo.getAccount(testLedgerId, nonExistentId),
			).rejects.toThrow(`Account not found: ${nonExistentId.toString()}`);
		});

		it("should return account without balance data by default", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test Account", description: "Test" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);

			await ledgerAccountRepo.createAccount(entity);

			const account = await ledgerAccountRepo.getAccount(
				testLedgerId,
				testAccountId1,
			);
			expect(account).toBeInstanceOf(LedgerAccountEntity);
			expect(account.id.toString()).toBe(testAccountId1.toString());
			expect(account.balanceData).toBeUndefined();
		});

		it("should return account with balance data when requested", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test Account", description: "Test" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);

			await ledgerAccountRepo.createAccount(entity);

			const account = await ledgerAccountRepo.getAccount(
				testLedgerId,
				testAccountId1,
				true,
			);
			expect(account).toBeInstanceOf(LedgerAccountEntity);
			expect(account.balanceData).toBeDefined();
			expect(account.balanceData?.currency).toBe("USD");
			expect(account.balanceData?.currencyExponent).toBe(2);
			expect(account.balanceData?.postedAmount).toBe(0);
			expect(account.balanceData?.pendingAmount).toBe(0);
			expect(account.balanceData?.availableAmount).toBe(0);
		});

		it("should throw error when account belongs to different ledger", async () => {
			// Create account in testLedger
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test Account", description: "Test" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			await ledgerAccountRepo.createAccount(entity);

			// Try to get from different ledger
			const otherLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				ledgerAccountRepo.getAccount(otherLedgerId, testAccountId1),
			).rejects.toThrow(`Account not found: ${testAccountId1.toString()}`);
		});
	});

	describe("createAccount", () => {
		it("should create new account with proper defaults", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "New Account", description: "Test account" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);

			const created = await ledgerAccountRepo.createAccount(entity);

			expect(created).toBeInstanceOf(LedgerAccountEntity);
			expect(created.id.toString()).toBe(testAccountId1.toString());
			expect(created.name).toBe("New Account");
			expect(created.description).toBe("Test account");
			expect(created.normalBalance).toBe("debit");
			expect(created.balanceAmount).toBe("0");
			expect(created.lockVersion).toBe(0);
			expect(created.created).toBeInstanceOf(Date);
			expect(created.updated).toBeInstanceOf(Date);
		});

		it("should create account with metadata", async () => {
			const metadata = { type: "merchant", merchantId: "12345" };
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Merchant Account", metadata },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);

			const created = await ledgerAccountRepo.createAccount(entity);
			expect(created.metadata).toEqual(metadata);
		});

		it("should generate unique ID when not provided", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Auto ID Account" },
				testLedgerId,
				"credit",
			);

			const created = await ledgerAccountRepo.createAccount(entity);
			expect(created.id.toString()).toMatch(/^lat_[a-z0-9]+$/);
		});

		it("should enforce unique account names within ledger", async () => {
			const entity1 = LedgerAccountEntity.fromRequest(
				{ name: "Duplicate Name" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			const entity2 = LedgerAccountEntity.fromRequest(
				{ name: "Duplicate Name" },
				testLedgerId,
				"credit",
				testAccountId2.toString(),
			);

			await ledgerAccountRepo.createAccount(entity1);
			await expect(ledgerAccountRepo.createAccount(entity2)).rejects.toThrow();
		});
	});

	describe("updateAccount", () => {
		let existingAccount: LedgerAccountEntity;

		beforeEach(async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Original Name", description: "Original description" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			existingAccount = await ledgerAccountRepo.createAccount(entity);
		});

		it("should update account name and description", async () => {
			const updated = new LedgerAccountEntity({
				...existingAccount,
				name: "Updated Name",
				description: "Updated description",
			});

			const result = await ledgerAccountRepo.updateAccount(
				testLedgerId,
				updated,
			);

			expect(result.name).toBe("Updated Name");
			expect(result.description).toBe("Updated description");
			expect(result.lockVersion).toBe(existingAccount.lockVersion + 1);
			expect(result.updated.getTime()).toBeGreaterThan(
				existingAccount.updated.getTime(),
			);
		});

		it("should update metadata", async () => {
			const newMetadata = { updated: true, version: 2 };
			const updated = new LedgerAccountEntity({
				...existingAccount,
				metadata: newMetadata,
			});

			const result = await ledgerAccountRepo.updateAccount(
				testLedgerId,
				updated,
			);
			expect(result.metadata).toEqual(newMetadata);
		});

		it("should implement optimistic locking", async () => {
			// Create two versions with same original lock version
			const update1 = new LedgerAccountEntity({
				...existingAccount,
				name: "Update 1",
			});
			const update2 = new LedgerAccountEntity({
				...existingAccount,
				name: "Update 2",
			});

			// First update should succeed
			await ledgerAccountRepo.updateAccount(testLedgerId, update1);

			// Second update with stale lock version should fail
			await expect(
				ledgerAccountRepo.updateAccount(testLedgerId, update2),
			).rejects.toThrow("Optimistic locking failure");
		});

		it("should throw error when account not found", async () => {
			const nonExistentAccount = new LedgerAccountEntity({
				...existingAccount,
				id: new TypeID("lat") as LedgerAccountID,
			});

			await expect(
				ledgerAccountRepo.updateAccount(testLedgerId, nonExistentAccount),
			).rejects.toThrow("Account not found");
		});

		it("should prevent updating immutable fields", async () => {
			const updated = new LedgerAccountEntity({
				...existingAccount,
				normalBalance: "credit", // Try to change normal balance
				name: "Updated Name",
			});

			const result = await ledgerAccountRepo.updateAccount(
				testLedgerId,
				updated,
			);
			// Normal balance should remain unchanged
			expect(result.normalBalance).toBe("debit");
		});
	});

	describe("deleteAccount", () => {
		let testAccount: LedgerAccountEntity;

		beforeEach(async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Account to Delete" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			testAccount = await ledgerAccountRepo.createAccount(entity);
		});

		it("should delete account when no dependencies exist", async () => {
			await ledgerAccountRepo.deleteAccount(testLedgerId, testAccountId1);

			await expect(
				ledgerAccountRepo.getAccount(testLedgerId, testAccountId1),
			).rejects.toThrow("Account not found");
		});

		it("should throw error when account has transaction entries", async () => {
			// Create a transaction with entry for this account
			const transactionId = new TypeID("ltr").toString();
			await db.insert(LedgerTransactionsTable).values({
				id: transactionId,
				ledgerId: testLedgerId.toString(),
				description: "Test transaction",
				status: "posted",
				created: new Date(),
				updated: new Date(),
			});

			await db.insert(LedgerTransactionEntriesTable).values({
				id: new TypeID("lte").toString(),
				transactionId: transactionId,
				accountId: testAccountId1.toString(),
				direction: "debit",
				amount: "100.00",
				status: "posted",
				created: new Date(),
				updated: new Date(),
			});

			await expect(
				ledgerAccountRepo.deleteAccount(testLedgerId, testAccountId1),
			).rejects.toThrow(
				"Cannot delete account with existing transaction entries",
			);
		});

		it("should throw error when account not found", async () => {
			const nonExistentId = new TypeID("lat") as LedgerAccountID;
			await expect(
				ledgerAccountRepo.deleteAccount(testLedgerId, nonExistentId),
			).rejects.toThrow(`Account not found: ${nonExistentId.toString()}`);
		});

		it("should prevent deletion of account from different ledger", async () => {
			const otherLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				ledgerAccountRepo.deleteAccount(otherLedgerId, testAccountId1),
			).rejects.toThrow(`Account not found: ${testAccountId1.toString()}`);
		});
	});

	describe("calculateBalance", () => {
		let debitAccount: LedgerAccountEntity;
		let creditAccount: LedgerAccountEntity;

		beforeEach(async () => {
			// Create test accounts
			const debitEntity = LedgerAccountEntity.fromRequest(
				{ name: "Debit Account" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			const creditEntity = LedgerAccountEntity.fromRequest(
				{ name: "Credit Account" },
				testLedgerId,
				"credit",
				testAccountId2.toString(),
			);

			debitAccount = await ledgerAccountRepo.createAccount(debitEntity);
			creditAccount = await ledgerAccountRepo.createAccount(creditEntity);
		});

		it("should return zero balances for account with no transactions", async () => {
			const balance = await ledgerAccountRepo.calculateBalance(
				testLedgerId,
				testAccountId1,
			);

			expect(balance.postedAmount).toBe(0);
			expect(balance.pendingAmount).toBe(0);
			expect(balance.availableAmount).toBe(0);
			expect(balance.postedCredits).toBe(0);
			expect(balance.postedDebits).toBe(0);
			expect(balance.pendingCredits).toBe(0);
			expect(balance.pendingDebits).toBe(0);
			expect(balance.currency).toBe("USD");
			expect(balance.currencyExponent).toBe(2);
		});

		it("should calculate correct balances for debit account", async () => {
			// Clean up any existing transactions first
			await db.delete(LedgerTransactionEntriesTable);
			await db.delete(LedgerTransactionsTable);

			// Create posted transactions
			await createTransactionEntry(testAccountId1, "debit", "100.00", "posted");
			await createTransactionEntry(testAccountId1, "credit", "30.00", "posted");

			// Create pending transactions
			await createTransactionEntry(testAccountId1, "debit", "50.00", "pending");
			await createTransactionEntry(
				testAccountId1,
				"credit",
				"20.00",
				"pending",
			);

			const balance = await ledgerAccountRepo.calculateBalance(
				testLedgerId,
				testAccountId1,
			);

			// For debit account: balance = debits - credits
			expect(balance.postedAmount).toBe(70); // 100 - 30
			expect(balance.pendingAmount).toBe(100); // (100 + 50) - (30 + 20)
			expect(balance.availableAmount).toBe(100); // 70 + 50 - 20 (posted + pending debits - pending credits)
			expect(balance.postedDebits).toBe(100);
			expect(balance.postedCredits).toBe(30);
			expect(balance.pendingDebits).toBe(50);
			expect(balance.pendingCredits).toBe(20);

			// Clean up after this test
			await db.delete(LedgerTransactionEntriesTable);
			await db.delete(LedgerTransactionsTable);
		});

		it("should calculate correct balances for credit account", async () => {
			// Clean up any existing transactions first
			await db.delete(LedgerTransactionEntriesTable);
			await db.delete(LedgerTransactionsTable);

			// Create posted transactions
			await createTransactionEntry(
				testAccountId2,
				"credit",
				"200.00",
				"posted",
			);
			await createTransactionEntry(testAccountId2, "debit", "50.00", "posted");

			// Create pending transactions
			await createTransactionEntry(
				testAccountId2,
				"credit",
				"100.00",
				"pending",
			);
			await createTransactionEntry(testAccountId2, "debit", "25.00", "pending");

			const balance = await ledgerAccountRepo.calculateBalance(
				testLedgerId,
				testAccountId2,
			);

			// For credit account: balance = credits - debits
			expect(balance.postedAmount).toBe(150); // 200 - 50
			expect(balance.pendingAmount).toBe(225); // (200 + 100) - (50 + 25)
			expect(balance.availableAmount).toBe(225); // 150 + 100 - 25 (posted + pending credits - pending debits)
			expect(balance.postedCredits).toBe(200);
			expect(balance.postedDebits).toBe(50);
			expect(balance.pendingCredits).toBe(100);
			expect(balance.pendingDebits).toBe(25);

			// Clean up after this test
			await db.delete(LedgerTransactionEntriesTable);
			await db.delete(LedgerTransactionsTable);
		});

		it("should perform balance calculation in under 100ms", async () => {
			// Clean up any existing transactions first
			await db.delete(LedgerTransactionEntriesTable);
			await db.delete(LedgerTransactionsTable);

			// Create multiple transactions for performance test
			const promises = [];
			for (let i = 0; i < 50; i++) {
				promises.push(
					createTransactionEntry(testAccountId1, "debit", "10.00", "posted"),
				);
				promises.push(
					createTransactionEntry(testAccountId1, "credit", "5.00", "posted"),
				);
			}
			await Promise.all(promises);

			const startTime = performance.now();
			const balance = await ledgerAccountRepo.calculateBalance(
				testLedgerId,
				testAccountId1,
			);
			const endTime = performance.now();

			expect(endTime - startTime).toBeLessThan(100);
			expect(balance.postedAmount).toBe(250); // 50*10 - 50*5 = 500 - 250 = 250
			expect(balance.pendingAmount).toBe(250); // Same calculation for pending
			expect(balance.availableAmount).toBe(250); // 250 + 0 (no pending debits/credits to subtract)

			// Clean up the performance test data to avoid affecting other tests
			await db.delete(LedgerTransactionEntriesTable);
			await db.delete(LedgerTransactionsTable);
		});

		// Helper function to create transaction entries
		async function createTransactionEntry(
			accountId: LedgerAccountID,
			direction: "debit" | "credit",
			amount: string,
			status: "posted" | "pending",
		) {
			const transactionId = new TypeID("ltr").toString();
			await db.insert(LedgerTransactionsTable).values({
				id: transactionId,
				ledgerId: testLedgerId.toString(),
				description: `Test ${status} transaction`,
				status,
				created: new Date(),
				updated: new Date(),
			});

			await db.insert(LedgerTransactionEntriesTable).values({
				id: new TypeID("lte").toString(),
				transactionId,
				accountId: accountId.toString(),
				direction,
				amount,
				status,
				created: new Date(),
				updated: new Date(),
			});
		}
	});

	describe("Concurrency and Race Conditions", () => {
		it("should handle concurrent account operations safely", async () => {
			// Create multiple accounts concurrently
			const createPromises = Array.from({ length: 5 }, (_, i) => {
				const entity = LedgerAccountEntity.fromRequest(
					{ name: `Concurrent Account ${i}` },
					testLedgerId,
					"debit",
				);
				return ledgerAccountRepo.createAccount(entity);
			});

			const accounts = await Promise.all(createPromises);
			expect(accounts).toHaveLength(5);

			// All should have unique IDs
			const ids = accounts.map((a) => a.id.toString());
			const uniqueIds = new Set(ids);
			expect(uniqueIds.size).toBe(5);
		});

		it("should handle concurrent updates with optimistic locking", async () => {
			// Create base account
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Concurrent Update Test" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			const baseAccount = await ledgerAccountRepo.createAccount(entity);

			// Try concurrent updates
			const updatePromises = Array.from({ length: 3 }, (_, i) => {
				const updated = new LedgerAccountEntity({
					...baseAccount,
					name: `Updated Name ${i}`,
				});
				return ledgerAccountRepo.updateAccount(testLedgerId, updated);
			});

			// Only one should succeed, others should fail with optimistic locking error
			const results = await Promise.allSettled(updatePromises);

			const successful = results.filter((r) => r.status === "fulfilled");
			const failed = results.filter((r) => r.status === "rejected");

			expect(successful).toHaveLength(1);
			expect(failed).toHaveLength(2);

			failed.forEach((result) => {
				if (result.status === "rejected") {
					expect(result.reason.message).toContain("Optimistic locking failure");
				}
			});
		});
	});

	describe("Error Handling", () => {
		it("should handle database connection errors gracefully", async () => {
			// Close the pool to simulate connection error
			const tempPool = new Pool({
				connectionString: "postgresql://invalid:invalid@localhost:9999/invalid",
				max: 1,
				connectionTimeoutMillis: 1000,
			});
			const tempDb = drizzle(tempPool, { schema });
			const tempRepo = new LedgerAccountRepo(tempDb);

			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test" },
				testLedgerId,
				"debit",
			);

			await expect(tempRepo.createAccount(entity)).rejects.toThrow();
			await tempPool.end();
		});

		it("should validate TypeID format", async () => {
			const invalidId = "invalid-id" as unknown as LedgerAccountID;
			await expect(
				ledgerAccountRepo.getAccount(testLedgerId, invalidId),
			).rejects.toThrow();
		});
	});

	// New CRUD method tests with organization tenancy
	describe("getLedgerAccount", () => {
		it("should throw error when account not found", async () => {
			const nonExistentId = new TypeID("lat") as LedgerAccountID;
			await expect(
				ledgerAccountRepo.getLedgerAccount(
					testOrgId,
					testLedgerId,
					nonExistentId,
				),
			).rejects.toThrow(`Account not found: ${nonExistentId.toString()}`);
		});

		it("should return account when found", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test Account", description: "Test" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);

			await ledgerAccountRepo.createAccount(entity);

			const account = await ledgerAccountRepo.getLedgerAccount(
				testOrgId,
				testLedgerId,
				testAccountId1,
			);
			expect(account).toBeInstanceOf(LedgerAccountEntity);
			expect(account.id.toString()).toBe(testAccountId1.toString());
		});

		it("should throw error when account belongs to different organization", async () => {
			// Create account in testLedger
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test Account", description: "Test" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			await ledgerAccountRepo.createAccount(entity);

			// Try to get from different organization
			const otherOrgId = new TypeID("org").toString();
			await expect(
				ledgerAccountRepo.getLedgerAccount(
					otherOrgId,
					testLedgerId,
					testAccountId1,
				),
			).rejects.toThrow(`Account not found: ${testAccountId1.toString()}`);
		});
	});

	describe("listLedgerAccounts", () => {
		it("should return empty array when no accounts exist", async () => {
			const accounts = await ledgerAccountRepo.listLedgerAccounts(
				testOrgId,
				testLedgerId,
				0,
				10,
			);
			expect(accounts).toEqual([]);
		});

		it("should list accounts with organization tenancy", async () => {
			const entity1 = LedgerAccountEntity.fromRequest(
				{ name: "Account 1", description: "Test account 1" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);

			await ledgerAccountRepo.createAccount(entity1);

			const accounts = await ledgerAccountRepo.listLedgerAccounts(
				testOrgId,
				testLedgerId,
				0,
				10,
			);
			expect(accounts).toHaveLength(1);
			expect(accounts[0].name).toBe("Account 1");
		});

		it("should throw error when accessing different organization", async () => {
			const otherOrgId = new TypeID("org").toString();
			await expect(
				ledgerAccountRepo.listLedgerAccounts(otherOrgId, testLedgerId, 0, 10),
			).rejects.toThrow();
		});
	});

	describe("createLedgerAccount", () => {
		it("should create new account with organization tenancy", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "New Account", description: "Test account" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);

			const created = await ledgerAccountRepo.createLedgerAccount(
				testOrgId,
				entity,
			);

			expect(created).toBeInstanceOf(LedgerAccountEntity);
			expect(created.id.toString()).toBe(testAccountId1.toString());
			expect(created.name).toBe("New Account");
		});

		it("should throw error when creating for different organization", async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "New Account" },
				testLedgerId,
				"debit",
			);

			const otherOrgId = new TypeID("org").toString();
			await expect(
				ledgerAccountRepo.createLedgerAccount(otherOrgId, entity),
			).rejects.toThrow();
		});
	});

	describe("updateLedgerAccount", () => {
		let existingAccount: LedgerAccountEntity;

		beforeEach(async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Original Name", description: "Original description" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			existingAccount = await ledgerAccountRepo.createAccount(entity);
		});

		it("should update account with organization tenancy", async () => {
			const updated = new LedgerAccountEntity({
				...existingAccount,
				name: "Updated Name",
			});

			const result = await ledgerAccountRepo.updateLedgerAccount(
				testOrgId,
				testLedgerId,
				updated,
			);

			expect(result.name).toBe("Updated Name");
		});

		it("should throw error when updating different organization", async () => {
			const updated = new LedgerAccountEntity({
				...existingAccount,
				name: "Updated Name",
			});

			const otherOrgId = new TypeID("org").toString();
			await expect(
				ledgerAccountRepo.updateLedgerAccount(
					otherOrgId,
					testLedgerId,
					updated,
				),
			).rejects.toThrow();
		});
	});

	describe("deleteLedgerAccount", () => {
		let testAccount: LedgerAccountEntity;

		beforeEach(async () => {
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Account to Delete" },
				testLedgerId,
				"debit",
				testAccountId1.toString(),
			);
			testAccount = await ledgerAccountRepo.createAccount(entity);
		});

		it("should delete account with organization tenancy", async () => {
			await ledgerAccountRepo.deleteLedgerAccount(
				testOrgId,
				testLedgerId,
				testAccountId1,
			);

			await expect(
				ledgerAccountRepo.getAccount(testLedgerId, testAccountId1),
			).rejects.toThrow("Account not found");
		});

		it("should throw error when deleting from different organization", async () => {
			const otherOrgId = new TypeID("org").toString();
			await expect(
				ledgerAccountRepo.deleteLedgerAccount(
					otherOrgId,
					testLedgerId,
					testAccountId1,
				),
			).rejects.toThrow();
		});
	});
});
