import { TypeID } from "typeid-js";
import { ConflictError } from "@/errors";
import { LedgerEntity } from "@/repo/entities/LedgerEntity";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import { createLedgerEntity, createOrganizationEntity, getRepos } from "./fixtures";

describe("LedgerRepo", () => {
	const { organizationRepo, ledgerRepo } = getRepos();

	// Test IDs - shared across test suite
	let testOrgId: OrgID;

	beforeAll(async () => {
		// Create test organization
		testOrgId = new TypeID("org") as OrgID;
		const orgEntity = createOrganizationEntity({
			id: testOrgId,
			name: "Ledger Test Org",
		});
		await organizationRepo.createOrganization(orgEntity);
	});

	afterAll(async () => {
		// Clean up test data
		await organizationRepo.deleteOrganization(testOrgId);
	});

	describe("getLedger", () => {
		it("should throw error when ledger not found", async () => {
			const nonExistentId = new TypeID("lgr") as LedgerID;
			await expect(ledgerRepo.getLedger(testOrgId, nonExistentId)).rejects.toThrow(
				`Ledger not found: ${nonExistentId.toString()}`
			);
		});

		it("should return ledger when found", async () => {
			const ledgerId = new TypeID("lgr") as LedgerID;
			const entity = createLedgerEntity({
				id: ledgerId,
				organizationId: testOrgId,
				name: "Test Ledger",
				currency: "USD",
				currencyExponent: 2,
			});

			await ledgerRepo.upsertLedger(entity);

			const ledger = await ledgerRepo.getLedger(testOrgId, ledgerId);
			expect(ledger).toBeInstanceOf(LedgerEntity);
			expect(ledger.id.toString()).toBe(ledgerId.toString());
			expect(ledger.name).toBe("Test Ledger");
			expect(ledger.currency).toBe("USD");

			// Cleanup
			await ledgerRepo.deleteLedger(testOrgId, ledgerId);
		});

		it("should throw error when ledger belongs to different organization", async () => {
			const ledgerId = new TypeID("lgr") as LedgerID;
			const entity = createLedgerEntity({
				id: ledgerId,
				organizationId: testOrgId,
				name: "Test Ledger",
			});
			await ledgerRepo.upsertLedger(entity);

			// Try to access with different organization ID
			const differentOrgId = new TypeID("org") as OrgID;
			await expect(ledgerRepo.getLedger(differentOrgId, ledgerId)).rejects.toThrow("Ledger not found");

			// Cleanup
			await ledgerRepo.deleteLedger(testOrgId, ledgerId);
		});
	});

	describe("listLedgers", () => {
		it("should return empty array when no ledgers exist", async () => {
			const ledgers = await ledgerRepo.listLedgers(testOrgId, 0, 10);
			expect(ledgers).toEqual([]);
		});

		it("should list ledgers with pagination", async () => {
			const ledgerId = new TypeID("lgr") as LedgerID;
			const entity = createLedgerEntity({
				id: ledgerId,
				organizationId: testOrgId,
				name: "Ledger 1",
				currency: "USD",
				currencyExponent: 2,
			});
			await ledgerRepo.upsertLedger(entity);

			const ledgers = await ledgerRepo.listLedgers(testOrgId, 0, 10);
			expect(ledgers).toHaveLength(1);
			expect(ledgers[0].name).toBe("Ledger 1");

			// Cleanup
			await ledgerRepo.deleteLedger(testOrgId, ledgerId);
		});

		it("should return only ledgers for the specified organization", async () => {
			const ledgerId = new TypeID("lgr") as LedgerID;
			const entity = createLedgerEntity({
				id: ledgerId,
				organizationId: testOrgId,
				name: "Org Ledger",
			});
			await ledgerRepo.upsertLedger(entity);

			// Different org should see empty list
			const differentOrgId = new TypeID("org") as OrgID;
			const ledgers = await ledgerRepo.listLedgers(differentOrgId, 0, 10);
			expect(ledgers).toEqual([]);

			// Cleanup
			await ledgerRepo.deleteLedger(testOrgId, ledgerId);
		});
	});

	describe("upsertLedger", () => {
		describe("create (insert) operations", () => {
			it("should create new ledger with valid data", async () => {
				const ledgerId = new TypeID("lgr") as LedgerID;
				const entity = createLedgerEntity({
					id: ledgerId,
					organizationId: testOrgId,
					name: "New Ledger",
					description: "Test ledger",
					currency: "USD",
					currencyExponent: 2,
				});

				const created = await ledgerRepo.upsertLedger(entity);

				expect(created).toBeInstanceOf(LedgerEntity);
				expect(created.id.toString()).toBe(ledgerId.toString());
				expect(created.name).toBe("New Ledger");
				expect(created.currency).toBe("USD");
				expect(created.currencyExponent).toBe(2);

				// Cleanup
				await ledgerRepo.deleteLedger(testOrgId, ledgerId);
			});

			it("should throw error when organization doesn't exist", async () => {
				const ledgerId = new TypeID("lgr") as LedgerID;
				const nonExistentOrgId = new TypeID("org") as OrgID;
				const entity = createLedgerEntity({
					id: ledgerId,
					organizationId: nonExistentOrgId,
					name: "New Ledger",
				});

				// Should throw an error (either FK violation or NotFoundError)
				await expect(ledgerRepo.upsertLedger(entity)).rejects.toThrow();
				// No cleanup needed - ledger was never created
			});

			it("should create ledger with metadata", async () => {
				const ledgerId = new TypeID("lgr") as LedgerID;
				const metadata = { purpose: "testing", region: "us-east" };
				const entity = createLedgerEntity({
					id: ledgerId,
					organizationId: testOrgId,
					name: "Metadata Ledger",
					metadata,
				});

				const created = await ledgerRepo.upsertLedger(entity);
				expect(created.metadata).toEqual(metadata);

				// Cleanup
				await ledgerRepo.deleteLedger(testOrgId, ledgerId);
			});
		});

		describe("update operations", () => {
			it("should update mutable fields (name, description, metadata)", async () => {
				const ledgerId = new TypeID("lgr") as LedgerID;
				const entity = createLedgerEntity({
					id: ledgerId,
					organizationId: testOrgId,
					name: "Original Name",
					description: "Original description",
					currency: "USD",
					currencyExponent: 2,
				});
				await ledgerRepo.upsertLedger(entity);

				const existing = await ledgerRepo.getLedger(testOrgId, ledgerId);

				const updated = new LedgerEntity({
					...existing,
					name: "Updated Name",
					description: "Updated description",
					metadata: { updated: true },
				});

				const result = await ledgerRepo.upsertLedger(updated);

				expect(result.name).toBe("Updated Name");
				expect(result.description).toBe("Updated description");
				expect(result.metadata).toEqual({ updated: true });

				// Cleanup
				await ledgerRepo.deleteLedger(testOrgId, ledgerId);
			});

			it("should fail when trying to change immutable currency fields", async () => {
				const ledgerId = new TypeID("lgr") as LedgerID;
				const entity = createLedgerEntity({
					id: ledgerId,
					organizationId: testOrgId,
					name: "Currency Test",
					description: "Testing currency immutability",
					currency: "USD",
					currencyExponent: 2,
				});
				await ledgerRepo.upsertLedger(entity);

				const existing = await ledgerRepo.getLedger(testOrgId, ledgerId);

				const updatedCurrency = new LedgerEntity({
					...existing,
					currency: "EUR",
				});

				await expect(ledgerRepo.upsertLedger(updatedCurrency)).rejects.toThrow(ConflictError);

				const updatedExponent = new LedgerEntity({
					...existing,
					currencyExponent: 3,
				});

				await expect(ledgerRepo.upsertLedger(updatedExponent)).rejects.toThrow(ConflictError);

				// Cleanup
				await ledgerRepo.deleteLedger(testOrgId, ledgerId);
			});

			it("should fail when trying to change immutable field (organizationId)", async () => {
				const ledgerId = new TypeID("lgr") as LedgerID;
				const entity = createLedgerEntity({
					id: ledgerId,
					organizationId: testOrgId,
					name: "Original Name",
					description: "Original description",
					currency: "USD",
					currencyExponent: 2,
				});
				await ledgerRepo.upsertLedger(entity);

				const existing = await ledgerRepo.getLedger(testOrgId, ledgerId);

				const differentOrgId = new TypeID("org") as OrgID;
				const updated = new LedgerEntity({
					...existing,
					organizationId: differentOrgId, // Changing immutable field
				});

				await expect(ledgerRepo.upsertLedger(updated)).rejects.toThrow();

				// Cleanup
				await ledgerRepo.deleteLedger(testOrgId, ledgerId);
			});
		});

		describe("idempotent create", () => {
			it("should create ledger on first call, update on second call", async () => {
				const ledgerId = new TypeID("lgr") as LedgerID;
				const entity = createLedgerEntity({
					id: ledgerId,
					organizationId: testOrgId,
					name: "Idempotent Ledger",
				});

				// First create
				const first = await ledgerRepo.upsertLedger(entity);
				expect(first.name).toBe("Idempotent Ledger");

				// Second call with same ID but updated name
				const updated = new LedgerEntity({
					...first,
					name: "Updated Ledger",
				});
				const second = await ledgerRepo.upsertLedger(updated);
				expect(second.name).toBe("Updated Ledger");

				// Cleanup
				await ledgerRepo.deleteLedger(testOrgId, ledgerId);
			});
		});
	});

	describe("deleteLedger", () => {
		it("should delete ledger successfully", async () => {
			const ledgerId = new TypeID("lgr") as LedgerID;
			const entity = createLedgerEntity({
				id: ledgerId,
				organizationId: testOrgId,
				name: "Ledger to Delete",
			});
			await ledgerRepo.upsertLedger(entity);

			await ledgerRepo.deleteLedger(testOrgId, ledgerId);

			await expect(ledgerRepo.getLedger(testOrgId, ledgerId)).rejects.toThrow("Ledger not found");
			// No cleanup needed - resource was deleted
		});

		it("should throw error when ledger not found", async () => {
			const nonExistentId = new TypeID("lgr") as LedgerID;
			await expect(ledgerRepo.deleteLedger(testOrgId, nonExistentId)).rejects.toThrow(
				`Ledger not found: ${nonExistentId.toString()}`
			);
			// No cleanup needed - no resource was created
		});

		it("should throw error when deleting from different organization", async () => {
			const ledgerId = new TypeID("lgr") as LedgerID;
			const entity = createLedgerEntity({
				id: ledgerId,
				organizationId: testOrgId,
				name: "Ledger to Delete",
			});
			await ledgerRepo.upsertLedger(entity);

			const otherOrgId = new TypeID("org") as OrgID;
			await expect(ledgerRepo.deleteLedger(otherOrgId, ledgerId)).rejects.toThrow("Ledger not found");

			// Cleanup
			await ledgerRepo.deleteLedger(testOrgId, ledgerId);
		});
	});

	describe("organization tenancy isolation", () => {
		let org1Id: OrgID;
		let org2Id: OrgID;
		let ledger1Id: LedgerID;
		let ledger2Id: LedgerID;

		beforeAll(async () => {
			// Create two organizations
			org1Id = new TypeID("org") as OrgID;
			org2Id = new TypeID("org") as OrgID;

			await organizationRepo.createOrganization(
				createOrganizationEntity({ id: org1Id, name: "Org 1" })
			);
			await organizationRepo.createOrganization(
				createOrganizationEntity({ id: org2Id, name: "Org 2" })
			);

			// Create ledgers for each organization
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
		});

		afterAll(async () => {
			// Clean up
			await ledgerRepo.deleteLedger(org1Id, ledger1Id);
			await ledgerRepo.deleteLedger(org2Id, ledger2Id);
			await organizationRepo.deleteOrganization(org1Id);
			await organizationRepo.deleteOrganization(org2Id);
		});

		it("should not allow org1 to access org2's ledgers", async () => {
			await expect(ledgerRepo.getLedger(org1Id, ledger2Id)).rejects.toThrow("Ledger not found");
		});

		it("should not allow org2 to access org1's ledgers", async () => {
			await expect(ledgerRepo.getLedger(org2Id, ledger1Id)).rejects.toThrow("Ledger not found");
		});

		it("should list only own organization's ledgers", async () => {
			const org1Ledgers = await ledgerRepo.listLedgers(org1Id, 0, 10);
			expect(org1Ledgers).toHaveLength(1);
			expect(org1Ledgers[0].id.toString()).toBe(ledger1Id.toString());

			const org2Ledgers = await ledgerRepo.listLedgers(org2Id, 0, 10);
			expect(org2Ledgers).toHaveLength(1);
			expect(org2Ledgers[0].id.toString()).toBe(ledger2Id.toString());
		});
	});
});
