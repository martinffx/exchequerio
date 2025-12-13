import { TypeID } from "typeid-js";
import { LedgerAccountCategoryEntity } from "@/repo/entities/LedgerAccountCategoryEntity";
import type {
	LedgerAccountCategoryID,
	LedgerAccountID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import {
	createLedgerAccountEntity,
	createLedgerEntity,
	createOrganizationEntity,
	getRepos,
} from "./fixtures";

describe("LedgerAccountCategoryRepo", () => {
	const { organizationRepo, ledgerRepo, ledgerAccountRepo, ledgerAccountCategoryRepo } = getRepos();

	// Test IDs - shared across test suite
	let testOrgId: OrgID;
	let testLedgerId: LedgerID;
	let testCounter = 0;

	beforeAll(async () => {
		// Create test organization
		testOrgId = new TypeID("org") as OrgID;
		const orgEntity = createOrganizationEntity({
			id: testOrgId,
			name: "Category Test Org",
		});
		await organizationRepo.createOrganization(orgEntity);

		// Create test ledger
		testLedgerId = new TypeID("lgr") as LedgerID;
		const ledgerEntity = createLedgerEntity({
			id: testLedgerId,
			organizationId: testOrgId,
			name: "Category Test Ledger",
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

	describe("listLedgerAccountCategories", () => {
		it("should return empty array when no categories exist", async () => {
			const categories = await ledgerAccountCategoryRepo.listLedgerAccountCategories(
				testLedgerId,
				0,
				10
			);
			expect(categories).toEqual([]);
		});

		it("should list categories with pagination", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId: testLedgerId,
				name: "Assets",
				description: "Asset accounts",
				normalBalance: "debit",
				metadata: { type: "top-level" },
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);

			const categories = await ledgerAccountCategoryRepo.listLedgerAccountCategories(
				testLedgerId,
				0,
				10
			);
			expect(categories).toHaveLength(1);
			expect(categories[0].name).toBe("Assets");
			expect(categories[0].normalBalance).toBe("debit");

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});

		it("should order categories by created date (descending)", async () => {
			const category1Id = new TypeID("lac") as LedgerAccountCategoryID;
			const category2Id = new TypeID("lac") as LedgerAccountCategoryID;

			// Create first category
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: category1Id,
					ledgerId: testLedgerId,
					name: "First Category",
					normalBalance: "debit",
					created: new Date("2024-01-01"),
					updated: new Date("2024-01-01"),
				})
			);

			// Create second category (newer)
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: category2Id,
					ledgerId: testLedgerId,
					name: "Second Category",
					normalBalance: "credit",
					created: new Date("2024-01-02"),
					updated: new Date("2024-01-02"),
				})
			);

			const categories = await ledgerAccountCategoryRepo.listLedgerAccountCategories(
				testLedgerId,
				0,
				10
			);

			expect(categories).toHaveLength(2);
			// Newer category should be first
			expect(categories[0].name).toBe("Second Category");
			expect(categories[1].name).toBe("First Category");

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, category1Id);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, category2Id);
		});
	});

	describe("getLedgerAccountCategory", () => {
		it("should throw error when category not found", async () => {
			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				ledgerAccountCategoryRepo.getLedgerAccountCategory(testLedgerId, nonExistentId)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);
		});

		it("should return category when found", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId: testLedgerId,
				name: "Liabilities",
				description: "Liability accounts",
				normalBalance: "credit",
				metadata: { code: "2000" },
				created: new Date(),
				updated: new Date(),
			});

			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);

			const category = await ledgerAccountCategoryRepo.getLedgerAccountCategory(
				testLedgerId,
				categoryId
			);
			expect(category).toBeInstanceOf(LedgerAccountCategoryEntity);
			expect(category.id.toString()).toBe(categoryId.toString());
			expect(category.name).toBe("Liabilities");
			expect(category.description).toBe("Liability accounts");
			expect(category.normalBalance).toBe("credit");
			expect(category.metadata).toEqual({ code: "2000" });

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});

		it("should throw error when category belongs to different ledger", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId: testLedgerId,
				name: "Test Category",
				normalBalance: "debit",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);

			// Try to access with different ledger ID
			const differentLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				ledgerAccountCategoryRepo.getLedgerAccountCategory(differentLedgerId, categoryId)
			).rejects.toThrow("Category not found");

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});
	});

	describe("upsertLedgerAccountCategory", () => {
		describe("create (insert) operations", () => {
			it("should create new category with valid data", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: "Revenue",
					description: "Revenue accounts",
					normalBalance: "credit",
					metadata: { type: "income" },
					created: new Date(),
					updated: new Date(),
				});

				const created = await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);

				expect(created).toBeInstanceOf(LedgerAccountCategoryEntity);
				expect(created.id.toString()).toBe(categoryId.toString());
				expect(created.name).toBe("Revenue");
				expect(created.normalBalance).toBe("credit");
				expect(created.metadata).toEqual({ type: "income" });

				// Cleanup
				await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
			});

			it("should throw error when ledger doesn't exist", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const nonExistentLedgerId = new TypeID("lgr") as LedgerID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: nonExistentLedgerId,
					name: "Test Category",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});

				await expect(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity)).rejects.toThrow(
					`Ledger not found: ${nonExistentLedgerId.toString()}`
				);
				// No cleanup needed - category was never created
			});

			it("should create category with debit normal balance", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: "Expenses",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});

				const created = await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);
				expect(created.normalBalance).toBe("debit");

				// Cleanup
				await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
			});

			it("should create category without description or metadata", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: "Minimal Category",
					normalBalance: "credit",
					created: new Date(),
					updated: new Date(),
				});

				const created = await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);
				expect(created.description).toBeUndefined();
				expect(created.metadata).toBeUndefined();

				// Cleanup
				await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
			});
		});

		describe("update operations", () => {
			it("should update mutable fields (name, description, metadata)", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: "Original Name",
					description: "Original description",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});
				await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);

				const existing = await ledgerAccountCategoryRepo.getLedgerAccountCategory(
					testLedgerId,
					categoryId
				);

				const updated = new LedgerAccountCategoryEntity({
					...existing,
					name: "Updated Name",
					description: "Updated description",
					metadata: { updated: true },
				});

				const result = await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(updated);

				expect(result.name).toBe("Updated Name");
				expect(result.description).toBe("Updated description");
				expect(result.metadata).toEqual({ updated: true });

				// Cleanup
				await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
			});

			it("should fail when trying to change ledgerId", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: "Original Name",
					description: "Original description",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});
				await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);

				const existing = await ledgerAccountCategoryRepo.getLedgerAccountCategory(
					testLedgerId,
					categoryId
				);

				const differentLedgerId = new TypeID("lgr") as LedgerID;
				const updated = new LedgerAccountCategoryEntity({
					...existing,
					ledgerId: differentLedgerId,
				});

				await expect(ledgerAccountCategoryRepo.upsertLedgerAccountCategory(updated)).rejects.toThrow();

				// Cleanup
				await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
			});
		});

		describe("idempotent create", () => {
			it("should handle create on first call, update on second call", async () => {
				const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
				const entity = new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: "Idempotent Category",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				});

				// First create
				const first = await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);
				expect(first.name).toBe("Idempotent Category");

				// Second call with same ID but different name (update)
				const updated = new LedgerAccountCategoryEntity({
					...first,
					name: "Updated Category",
				});
				const second = await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(updated);
				expect(second.name).toBe("Updated Category");

				// Cleanup
				await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
			});
		});
	});

	describe("deleteLedgerAccountCategory", () => {
		it("should delete category successfully", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId: testLedgerId,
				name: "Category to Delete",
				normalBalance: "debit",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);

			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);

			await expect(
				ledgerAccountCategoryRepo.getLedgerAccountCategory(testLedgerId, categoryId)
			).rejects.toThrow("Category not found");
			// No cleanup needed - resource was deleted
		});

		it("should throw error when category not found", async () => {
			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, nonExistentId)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);
			// No cleanup needed - no resource was created
		});

		it("should throw error when deleting from different ledger", async () => {
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId: testLedgerId,
				name: "Category to Delete",
				normalBalance: "debit",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);

			const otherLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				ledgerAccountCategoryRepo.deleteLedgerAccountCategory(otherLedgerId, categoryId)
			).rejects.toThrow("Category not found");

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});

		it("should cascade delete category-account links", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			const entity = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId: testLedgerId,
				name: "Category to Delete",
				normalBalance: "debit",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);

			// Create an account
			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Delete Cascade Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// Link account to category
			await ledgerAccountCategoryRepo.linkAccountToCategory(testLedgerId, categoryId, accountId);

			// Delete category (should cascade delete link)
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);

			// Verify category is deleted
			await expect(
				ledgerAccountCategoryRepo.getLedgerAccountCategory(testLedgerId, categoryId)
			).rejects.toThrow("Category not found");

			// Cleanup account
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			// No cleanup needed for category - it was deleted by the test
		});
	});

	describe("linkAccountToCategory", () => {
		it("should link account to category successfully", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: `Link Test Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			await ledgerAccountCategoryRepo.linkAccountToCategory(testLedgerId, categoryId, accountId);

			// Verify link was created (no error means success)
			expect(true).toBe(true);

			// Cleanup
			await ledgerAccountCategoryRepo.unlinkAccountFromCategory(testLedgerId, categoryId, accountId);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});

		it("should be idempotent (linking twice should not error)", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: `Link Test Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// First link
			await ledgerAccountCategoryRepo.linkAccountToCategory(testLedgerId, categoryId, accountId);

			// Second link should succeed (onConflictDoNothing)
			await expect(
				ledgerAccountCategoryRepo.linkAccountToCategory(testLedgerId, categoryId, accountId)
			).resolves.not.toThrow();

			// Cleanup
			await ledgerAccountCategoryRepo.unlinkAccountFromCategory(testLedgerId, categoryId, accountId);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});

		it("should throw error when category doesn't exist", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: `Link Test Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			const nonExistentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				ledgerAccountCategoryRepo.linkAccountToCategory(testLedgerId, nonExistentCategoryId, accountId)
			).rejects.toThrow(`Category not found: ${nonExistentCategoryId.toString()}`);

			// Cleanup
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});

		it("should throw error when account doesn't exist", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: `Link Test Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			const nonExistentAccountId = new TypeID("lat") as LedgerAccountID;
			await expect(
				ledgerAccountCategoryRepo.linkAccountToCategory(testLedgerId, categoryId, nonExistentAccountId)
			).rejects.toThrow(`Account not found: ${nonExistentAccountId.toString()}`);

			// Cleanup
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});

		it("should throw error when category belongs to different ledger", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: `Link Test Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Link Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			const otherLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				ledgerAccountCategoryRepo.linkAccountToCategory(otherLedgerId, categoryId, accountId)
			).rejects.toThrow("Category not found");

			// Cleanup
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});
	});

	describe("unlinkAccountFromCategory", () => {
		it("should unlink account from category successfully", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: `Unlink Test Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Unlink Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// Link them
			await ledgerAccountCategoryRepo.linkAccountToCategory(testLedgerId, categoryId, accountId);

			await ledgerAccountCategoryRepo.unlinkAccountFromCategory(testLedgerId, categoryId, accountId);

			// Try to unlink again - should fail
			await expect(
				ledgerAccountCategoryRepo.unlinkAccountFromCategory(testLedgerId, categoryId, accountId)
			).rejects.toThrow(
				`Account ${accountId.toString()} not linked to category ${categoryId.toString()}`
			);

			// Cleanup
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});

		it("should throw error when link doesn't exist", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: `Unlink Test Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Unlink Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// Link them
			await ledgerAccountCategoryRepo.linkAccountToCategory(testLedgerId, categoryId, accountId);

			const unlinkedAccountId = new TypeID("lat") as LedgerAccountID;
			await expect(
				ledgerAccountCategoryRepo.unlinkAccountFromCategory(testLedgerId, categoryId, unlinkedAccountId)
			).rejects.toThrow(
				`Account ${unlinkedAccountId.toString()} not linked to category ${categoryId.toString()}`
			);

			// Cleanup
			await ledgerAccountCategoryRepo.unlinkAccountFromCategory(testLedgerId, categoryId, accountId);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});

		it("should throw error when category doesn't exist", async () => {
			testCounter++;
			const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId: testLedgerId,
					name: `Unlink Test Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const accountId = new TypeID("lat") as LedgerAccountID;
			const accountEntity = createLedgerAccountEntity({
				id: accountId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				name: `Unlink Test Account ${testCounter}`,
				normalBalance: "debit",
			});
			await ledgerAccountRepo.upsertLedgerAccount(accountEntity);

			// Link them
			await ledgerAccountCategoryRepo.linkAccountToCategory(testLedgerId, categoryId, accountId);

			const nonExistentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				ledgerAccountCategoryRepo.unlinkAccountFromCategory(
					testLedgerId,
					nonExistentCategoryId,
					accountId
				)
			).rejects.toThrow(`Category not found: ${nonExistentCategoryId.toString()}`);

			// Cleanup
			await ledgerAccountCategoryRepo.unlinkAccountFromCategory(testLedgerId, categoryId, accountId);
			await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, accountId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, categoryId);
		});
	});

	describe("linkCategoryToParent", () => {
		it("should link category to parent successfully", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			await ledgerAccountCategoryRepo.linkCategoryToParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);

			// Verify link was created (no error means success)
			expect(true).toBe(true);

			// Cleanup
			await ledgerAccountCategoryRepo.unlinkCategoryFromParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});

		it("should be idempotent (linking twice should not error)", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			// First link
			await ledgerAccountCategoryRepo.linkCategoryToParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);

			// Second link should succeed (onConflictDoNothing)
			await expect(
				ledgerAccountCategoryRepo.linkCategoryToParent(testLedgerId, childCategoryId, parentCategoryId)
			).resolves.not.toThrow();

			// Cleanup
			await ledgerAccountCategoryRepo.unlinkCategoryFromParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});

		it("should allow multiple parents (many-to-many)", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			// Create second parent
			const parent2Id = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parent2Id,
					ledgerId: testLedgerId,
					name: "Second Parent Category",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			// Link to first parent
			await ledgerAccountCategoryRepo.linkCategoryToParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);

			// Link to second parent - should succeed
			await expect(
				ledgerAccountCategoryRepo.linkCategoryToParent(testLedgerId, childCategoryId, parent2Id)
			).resolves.not.toThrow();

			// Cleanup
			await ledgerAccountCategoryRepo.unlinkCategoryFromParent(
				testLedgerId,
				childCategoryId,
				parent2Id
			);
			await ledgerAccountCategoryRepo.unlinkCategoryFromParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parent2Id);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});

		it("should prevent self-referential parent link", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			await expect(
				ledgerAccountCategoryRepo.linkCategoryToParent(testLedgerId, childCategoryId, childCategoryId)
			).rejects.toThrow("Category cannot be its own parent");

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});

		it("should throw error when child category doesn't exist", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				ledgerAccountCategoryRepo.linkCategoryToParent(testLedgerId, nonExistentId, parentCategoryId)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});

		it("should throw error when parent category doesn't exist", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				ledgerAccountCategoryRepo.linkCategoryToParent(testLedgerId, childCategoryId, nonExistentId)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});

		it("should throw error when categories belong to different ledgers", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			// Create another ledger
			const otherLedgerId = new TypeID("lgr") as LedgerID;
			await expect(
				ledgerAccountCategoryRepo.linkCategoryToParent(otherLedgerId, childCategoryId, parentCategoryId)
			).rejects.toThrow("Category not found");

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});
	});

	describe("unlinkCategoryFromParent", () => {
		it("should unlink category from parent successfully", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			// Link them
			await ledgerAccountCategoryRepo.linkCategoryToParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);

			await ledgerAccountCategoryRepo.unlinkCategoryFromParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);

			// Try to unlink again - should fail
			await expect(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testLedgerId,
					childCategoryId,
					parentCategoryId
				)
			).rejects.toThrow(
				`Category ${childCategoryId.toString()} not linked to parent ${parentCategoryId.toString()}`
			);

			// Cleanup
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});

		it("should throw error when link doesn't exist", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			// Link them
			await ledgerAccountCategoryRepo.linkCategoryToParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);

			const unlinkedParentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testLedgerId,
					childCategoryId,
					unlinkedParentId
				)
			).rejects.toThrow(
				`Category ${childCategoryId.toString()} not linked to parent ${unlinkedParentId.toString()}`
			);

			// Cleanup
			await ledgerAccountCategoryRepo.unlinkCategoryFromParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});

		it("should throw error when child category doesn't exist", async () => {
			testCounter++;
			const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: parentCategoryId,
					ledgerId: testLedgerId,
					name: `Parent Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			const childCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: childCategoryId,
					ledgerId: testLedgerId,
					name: `Child Category ${testCounter}`,
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);

			// Link them
			await ledgerAccountCategoryRepo.linkCategoryToParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);

			const nonExistentId = new TypeID("lac") as LedgerAccountCategoryID;
			await expect(
				ledgerAccountCategoryRepo.unlinkCategoryFromParent(
					testLedgerId,
					nonExistentId,
					parentCategoryId
				)
			).rejects.toThrow(`Category not found: ${nonExistentId.toString()}`);

			// Cleanup
			await ledgerAccountCategoryRepo.unlinkCategoryFromParent(
				testLedgerId,
				childCategoryId,
				parentCategoryId
			);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, childCategoryId);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(testLedgerId, parentCategoryId);
		});
	});

	describe("ledger isolation", () => {
		let ledger1Id: LedgerID;
		let ledger2Id: LedgerID;
		let category1Id: LedgerAccountCategoryID;
		let category2Id: LedgerAccountCategoryID;

		beforeAll(async () => {
			// Create two ledgers in the same organization
			ledger1Id = new TypeID("lgr") as LedgerID;
			ledger2Id = new TypeID("lgr") as LedgerID;

			await ledgerRepo.upsertLedger(
				createLedgerEntity({
					id: ledger1Id,
					organizationId: testOrgId,
					name: "Ledger 1",
				})
			);
			await ledgerRepo.upsertLedger(
				createLedgerEntity({
					id: ledger2Id,
					organizationId: testOrgId,
					name: "Ledger 2",
				})
			);

			// Create categories in each ledger
			category1Id = new TypeID("lac") as LedgerAccountCategoryID;
			category2Id = new TypeID("lac") as LedgerAccountCategoryID;

			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: category1Id,
					ledgerId: ledger1Id,
					name: "Category 1",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);
			await ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
				new LedgerAccountCategoryEntity({
					id: category2Id,
					ledgerId: ledger2Id,
					name: "Category 2",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				})
			);
		});

		afterAll(async () => {
			// Clean up
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(ledger1Id, category1Id);
			await ledgerAccountCategoryRepo.deleteLedgerAccountCategory(ledger2Id, category2Id);
			await ledgerRepo.deleteLedger(testOrgId, ledger1Id);
			await ledgerRepo.deleteLedger(testOrgId, ledger2Id);
		});

		it("should not allow ledger1 to access ledger2's categories", async () => {
			await expect(
				ledgerAccountCategoryRepo.getLedgerAccountCategory(ledger1Id, category2Id)
			).rejects.toThrow("Category not found");
		});

		it("should not allow ledger2 to access ledger1's categories", async () => {
			await expect(
				ledgerAccountCategoryRepo.getLedgerAccountCategory(ledger2Id, category1Id)
			).rejects.toThrow("Category not found");
		});

		it("should list only own ledger's categories", async () => {
			const ledger1Categories = await ledgerAccountCategoryRepo.listLedgerAccountCategories(
				ledger1Id,
				0,
				10
			);
			expect(ledger1Categories).toHaveLength(1);
			expect(ledger1Categories[0].id.toString()).toBe(category1Id.toString());

			const ledger2Categories = await ledgerAccountCategoryRepo.listLedgerAccountCategories(
				ledger2Id,
				0,
				10
			);
			expect(ledger2Categories).toHaveLength(1);
			expect(ledger2Categories[0].id.toString()).toBe(category2Id.toString());
		});
	});
});
