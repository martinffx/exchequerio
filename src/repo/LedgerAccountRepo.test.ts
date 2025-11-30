import { TypeID } from "typeid-js";
import { LedgerAccountEntity } from "@/services/entities/LedgerAccountEntity";
import type { LedgerAccountID, LedgerID, OrgID } from "@/services/entities/types";
import { createLedgerEntity, createOrganizationEntity, getRepos } from "./fixtures";

describe("LedgerAccountRepo", () => {
	const { organizationRepo, ledgerRepo, ledgerAccountRepo } = getRepos();

	// Test IDs - shared across test suite
	let testOrgId: OrgID;
	let testLedgerId: LedgerID;

	beforeAll(async () => {
		// Create test organization
		testOrgId = new TypeID("org") as OrgID;
		const orgEntity = createOrganizationEntity({
			id: testOrgId,
			name: "Ledger Account Test Org",
		});
		await organizationRepo.createOrganization(orgEntity);

		// Create test ledger
		testLedgerId = new TypeID("lgr") as LedgerID;
		const ledgerEntity = createLedgerEntity({
			id: testLedgerId,
			organizationId: testOrgId,
			name: "Ledger Account Test Ledger",
			currency: "USD",
			currencyExponent: 2,
		});
		await ledgerRepo.upsertLedger(ledgerEntity);
	});

	afterAll(async () => {
		// Clean up test data
		await ledgerRepo.deleteLedger(testOrgId, testLedgerId);
		await organizationRepo.deleteOrganization(testOrgId);
	});

	describe("listLedgerAccounts", () => {
		let accountId: LedgerAccountID;

		afterEach(async () => {
			// Clean up accounts created in tests
			if (accountId) {
				try {
					await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
				} catch {
					// Ignore if already deleted
				}
			}
		});

		it("should return empty array when no accounts exist", async () => {
			const accounts = await ledgerAccountRepo.listLedgerAccounts(testOrgId, testLedgerId, 0, 10);
			expect(accounts).toEqual([]);
		});

		it("should list accounts with pagination", async () => {
			accountId = new TypeID("lat") as LedgerAccountID;
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Account 1", description: "Test account 1" },
				testOrgId,
				testLedgerId,
				"debit",
				accountId.toString()
			);
			await ledgerAccountRepo.upsertLedgerAccount(entity);

			const accounts = await ledgerAccountRepo.listLedgerAccounts(testOrgId, testLedgerId, 0, 10);
			expect(accounts).toHaveLength(1);
			expect(accounts[0].name).toBe("Account 1");
		});

		it("should throw error when ledger doesn't belong to organization", async () => {
			const differentOrgId = new TypeID("org") as OrgID;
			await expect(
				ledgerAccountRepo.listLedgerAccounts(differentOrgId, testLedgerId, 0, 10)
			).rejects.toThrow("Ledger not found or does not belong to organization");
		});
	});

	describe("getLedgerAccount", () => {
		let accountId: LedgerAccountID;

		afterEach(async () => {
			if (accountId) {
				try {
					await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
				} catch {
					// Ignore if already deleted
				}
			}
		});

		it("should throw error when account not found", async () => {
			const nonExistentId = new TypeID("lat") as LedgerAccountID;
			await expect(
				ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, nonExistentId)
			).rejects.toThrow(`Account not found: ${nonExistentId.toString()}`);
		});

		it("should return account when found", async () => {
			accountId = new TypeID("lat") as LedgerAccountID;
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test Account", description: "Test" },
				testOrgId,
				testLedgerId,
				"debit",
				accountId.toString()
			);

			await ledgerAccountRepo.upsertLedgerAccount(entity);

			const account = await ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, accountId);
			expect(account).toBeInstanceOf(LedgerAccountEntity);
			expect(account.id.toString()).toBe(accountId.toString());
			expect(account.name).toBe("Test Account");
		});

		it("should throw error when account belongs to different organization", async () => {
			accountId = new TypeID("lat") as LedgerAccountID;
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Test Account", description: "Test" },
				testOrgId,
				testLedgerId,
				"debit",
				accountId.toString()
			);
			await ledgerAccountRepo.upsertLedgerAccount(entity);

			// Try to access with different organization ID
			const differentOrgId = new TypeID("org") as OrgID;
			await expect(
				ledgerAccountRepo.getLedgerAccount(differentOrgId, testLedgerId, accountId)
			).rejects.toThrow("Account not found");
		});
	});

	describe("upsertLedgerAccount", () => {
		let accountId: LedgerAccountID;

		afterEach(async () => {
			if (accountId) {
				try {
					await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
				} catch {
					// Ignore if already deleted
				}
			}
		});

		describe("create (insert) operations", () => {
			it("should create new account with valid data", async () => {
				accountId = new TypeID("lat") as LedgerAccountID;
				const entity = LedgerAccountEntity.fromRequest(
					{ name: "New Account", description: "Test account" },
					testOrgId,
					testLedgerId,
					"debit",
					accountId.toString()
				);

				const created = await ledgerAccountRepo.upsertLedgerAccount(entity);

				expect(created).toBeInstanceOf(LedgerAccountEntity);
				expect(created.id.toString()).toBe(accountId.toString());
				expect(created.name).toBe("New Account");
				expect(created.lockVersion).toBe(1); // First version after creation
			});

			it("should throw error when ledger doesn't exist", async () => {
				accountId = new TypeID("lat") as LedgerAccountID;
				const nonExistentLedgerId = new TypeID("lgr") as LedgerID;
				const entity = LedgerAccountEntity.fromRequest(
					{ name: "New Account" },
					testOrgId,
					nonExistentLedgerId,
					"debit",
					accountId.toString()
				);

				await expect(ledgerAccountRepo.upsertLedgerAccount(entity)).rejects.toThrow();
			});

			it("should create account with credit normal balance", async () => {
				accountId = new TypeID("lat") as LedgerAccountID;
				const entity = LedgerAccountEntity.fromRequest(
					{ name: "Credit Account" },
					testOrgId,
					testLedgerId,
					"credit",
					accountId.toString()
				);

				const created = await ledgerAccountRepo.upsertLedgerAccount(entity);
				expect(created.normalBalance).toBe("credit");
			});

			it("should create account with metadata", async () => {
				accountId = new TypeID("lat") as LedgerAccountID;
				const metadata = { category: "assets", subcategory: "cash" };
				const entity = LedgerAccountEntity.fromRequest(
					{ name: "Metadata Account", metadata },
					testOrgId,
					testLedgerId,
					"debit",
					accountId.toString()
				);

				const created = await ledgerAccountRepo.upsertLedgerAccount(entity);
				expect(created.metadata).toEqual(metadata);
			});
		});

		describe("update operations", () => {
			beforeEach(async () => {
				// Create a base account for update tests
				accountId = new TypeID("lat") as LedgerAccountID;
				const entity = LedgerAccountEntity.fromRequest(
					{ name: "Original Name", description: "Original description" },
					testOrgId,
					testLedgerId,
					"debit",
					accountId.toString()
				);
				await ledgerAccountRepo.upsertLedgerAccount(entity);
			});

			it("should update mutable fields (name, description, metadata)", async () => {
				const existing = await ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, accountId);

				const updated = new LedgerAccountEntity({
					...existing,
					name: "Updated Name",
					description: "Updated description",
					metadata: { updated: true },
				});

				const result = await ledgerAccountRepo.upsertLedgerAccount(updated);

				expect(result.name).toBe("Updated Name");
				expect(result.description).toBe("Updated description");
				expect(result.metadata).toEqual({ updated: true });
				expect(result.lockVersion).toBe(2); // Incremented from 1 to 2
			});

			it("should increment lock version on update", async () => {
				const existing = await ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, accountId);

				expect(existing.lockVersion).toBe(1);

				const updated = new LedgerAccountEntity({
					...existing,
					name: "Updated Name",
				});

				const result = await ledgerAccountRepo.upsertLedgerAccount(updated);
				expect(result.lockVersion).toBe(2);
			});

			it("should fail when lock version is stale (optimistic locking)", async () => {
				const existing = await ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, accountId);

				// First update - succeeds
				const updated1 = new LedgerAccountEntity({
					...existing,
					name: "Update 1",
				});
				await ledgerAccountRepo.upsertLedgerAccount(updated1);

				// Second update with stale version - should fail
				const updated2 = new LedgerAccountEntity({
					...existing, // Uses original lockVersion (1), but DB is now at 2
					name: "Update 2",
				});

				await expect(ledgerAccountRepo.upsertLedgerAccount(updated2)).rejects.toThrow(
					"Account not found, was modified by another transaction, or immutable fields"
				);
			});

			it("should fail when trying to change immutable field (ledgerId)", async () => {
				const existing = await ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, accountId);

				const differentLedgerId = new TypeID("lgr") as LedgerID;
				const updated = new LedgerAccountEntity({
					...existing,
					ledgerId: differentLedgerId, // Changing immutable field
				});

				await expect(ledgerAccountRepo.upsertLedgerAccount(updated)).rejects.toThrow();
			});

			it("should fail when trying to change immutable field (organizationId)", async () => {
				const existing = await ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, accountId);

				const differentOrgId = new TypeID("org") as OrgID;
				const updated = new LedgerAccountEntity({
					...existing,
					organizationId: differentOrgId, // Changing immutable field
				});

				await expect(ledgerAccountRepo.upsertLedgerAccount(updated)).rejects.toThrow();
			});
		});

		describe("idempotent create", () => {
			it("should create account on first call, update on second call", async () => {
				accountId = new TypeID("lat") as LedgerAccountID;
				const entity = LedgerAccountEntity.fromRequest(
					{ name: "Idempotent Account" },
					testOrgId,
					testLedgerId,
					"debit",
					accountId.toString()
				);

				// First create
				const first = await ledgerAccountRepo.upsertLedgerAccount(entity);
				expect(first.lockVersion).toBe(1);

				// Second call with same ID but fetched entity (lockVersion 1)
				const updated = new LedgerAccountEntity({
					...first,
					name: "Updated Account",
				});
				const second = await ledgerAccountRepo.upsertLedgerAccount(updated);
				expect(second.lockVersion).toBe(2);
				expect(second.name).toBe("Updated Account");
			});
		});
	});

	describe("deleteLedgerAccount", () => {
		let accountId: LedgerAccountID;

		beforeEach(async () => {
			accountId = new TypeID("lat") as LedgerAccountID;
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Account to Delete" },
				testOrgId,
				testLedgerId,
				"debit",
				accountId.toString()
			);
			await ledgerAccountRepo.upsertLedgerAccount(entity);
		});

		afterEach(async () => {
			if (accountId) {
				try {
					await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
				} catch {
					// Ignore if already deleted
				}
			}
		});

		it("should delete account successfully", async () => {
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);

			await expect(
				ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, accountId)
			).rejects.toThrow("Account not found");
		});

		it("should throw error when account not found", async () => {
			const nonExistentId = new TypeID("lat") as LedgerAccountID;
			await expect(
				ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, nonExistentId)
			).rejects.toThrow(`Account not found: ${nonExistentId.toString()}`);
		});

		it("should throw error when deleting from different organization", async () => {
			const otherOrgId = new TypeID("org") as OrgID;
			await expect(
				ledgerAccountRepo.deleteLedgerAccount(otherOrgId, testLedgerId, accountId)
			).rejects.toThrow("Account not found");
		});

		it("should throw error when deleting from different ledger", async () => {
			const otherLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				ledgerAccountRepo.deleteLedgerAccount(testOrgId, otherLedgerId, accountId)
			).rejects.toThrow(`Account not found: ${accountId.toString()}`);
		});
	});

	describe("organization tenancy isolation", () => {
		let org1Id: OrgID;
		let org2Id: OrgID;
		let ledger1Id: LedgerID;
		let ledger2Id: LedgerID;
		let account1Id: LedgerAccountID;
		let account2Id: LedgerAccountID;

		beforeAll(async () => {
			// Create two organizations with two ledgers each
			org1Id = new TypeID("org") as OrgID;
			org2Id = new TypeID("org") as OrgID;

			await organizationRepo.createOrganization(
				createOrganizationEntity({ id: org1Id, name: "Org 1" })
			);
			await organizationRepo.createOrganization(
				createOrganizationEntity({ id: org2Id, name: "Org 2" })
			);

			ledger1Id = new TypeID("lgr") as LedgerID;
			ledger2Id = new TypeID("lgr") as LedgerID;

			await ledgerRepo.upsertLedger(
				createLedgerEntity({
					id: ledger1Id,
					organizationId: org1Id,
					name: "Ledger 1",
				})
			);
			await ledgerRepo.upsertLedger(
				createLedgerEntity({
					id: ledger2Id,
					organizationId: org2Id,
					name: "Ledger 2",
				})
			);

			// Create accounts in each ledger
			account1Id = new TypeID("lat") as LedgerAccountID;
			account2Id = new TypeID("lat") as LedgerAccountID;

			await ledgerAccountRepo.upsertLedgerAccount(
				LedgerAccountEntity.fromRequest(
					{ name: "Account 1" },
					org1Id,
					ledger1Id,
					"debit",
					account1Id.toString()
				)
			);
			await ledgerAccountRepo.upsertLedgerAccount(
				LedgerAccountEntity.fromRequest(
					{ name: "Account 2" },
					org2Id,
					ledger2Id,
					"debit",
					account2Id.toString()
				)
			);
		});

		afterAll(async () => {
			// Clean up
			await ledgerAccountRepo.deleteLedgerAccount(org1Id, ledger1Id, account1Id);
			await ledgerAccountRepo.deleteLedgerAccount(org2Id, ledger2Id, account2Id);
			await ledgerRepo.deleteLedger(org1Id, ledger1Id);
			await ledgerRepo.deleteLedger(org2Id, ledger2Id);
			await organizationRepo.deleteOrganization(org1Id);
			await organizationRepo.deleteOrganization(org2Id);
		});

		it("should not allow org1 to access org2's accounts", async () => {
			await expect(ledgerAccountRepo.getLedgerAccount(org1Id, ledger2Id, account2Id)).rejects.toThrow(
				"Account not found"
			);
		});

		it("should not allow org2 to access org1's accounts", async () => {
			await expect(ledgerAccountRepo.getLedgerAccount(org2Id, ledger1Id, account1Id)).rejects.toThrow(
				"Account not found"
			);
		});

		it("should list only own organization's accounts", async () => {
			const org1Accounts = await ledgerAccountRepo.listLedgerAccounts(org1Id, ledger1Id, 0, 10);
			expect(org1Accounts).toHaveLength(1);
			expect(org1Accounts[0].id.toString()).toBe(account1Id.toString());

			const org2Accounts = await ledgerAccountRepo.listLedgerAccounts(org2Id, ledger2Id, 0, 10);
			expect(org2Accounts).toHaveLength(1);
			expect(org2Accounts[0].id.toString()).toBe(account2Id.toString());
		});
	});
});
