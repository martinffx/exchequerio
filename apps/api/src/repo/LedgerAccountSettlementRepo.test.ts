import { TypeID } from "typeid-js";
import { ConflictError, NotFoundError } from "@/errors";
import { LedgerAccountSettlementEntity } from "@/repo/entities/LedgerAccountSettlementEntity";
import type {
	LedgerAccountID,
	LedgerAccountSettlementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import {
	createLedgerAccountEntity,
	createLedgerEntity,
	createLedgerTransactionEntity,
	createLedgerTransactionEntryEntity,
	createOrganizationEntity,
	getRepos,
} from "./fixtures";

describe("LedgerAccountSettlementRepo", () => {
	const { organizationRepo, ledgerRepo, ledgerAccountRepo, ledgerAccountSettlementRepo } =
		getRepos();

	// Test IDs - shared across test suite
	let testOrgId: OrgID;
	let testLedgerId: LedgerID;
	let settledAccountId: LedgerAccountID;
	let contraAccountId: LedgerAccountID;

	beforeAll(async () => {
		// Create test organization
		testOrgId = new TypeID("org") as OrgID;
		const orgEntity = createOrganizationEntity({
			id: testOrgId,
			name: "Settlement Test Org",
		});
		await organizationRepo.createOrganization(orgEntity);

		// Create test ledger
		testLedgerId = new TypeID("lgr") as LedgerID;
		const ledgerEntity = createLedgerEntity({
			id: testLedgerId,
			organizationId: testOrgId,
			name: "Settlement Test Ledger",
			currency: "USD",
			currencyExponent: 2,
		});
		await ledgerRepo.upsertLedger(ledgerEntity);

		// Create two test accounts (settled and contra)
		settledAccountId = new TypeID("lat") as LedgerAccountID;
		const settledAccount = createLedgerAccountEntity({
			id: settledAccountId,
			organizationId: testOrgId,
			ledgerId: testLedgerId,
			name: "Merchant Wallet",
			normalBalance: "debit",
		});
		await ledgerAccountRepo.upsertLedgerAccount(settledAccount);

		contraAccountId = new TypeID("lat") as LedgerAccountID;
		const contraAccount = createLedgerAccountEntity({
			id: contraAccountId,
			organizationId: testOrgId,
			ledgerId: testLedgerId,
			name: "Bank Payout",
			normalBalance: "credit",
		});
		await ledgerAccountRepo.upsertLedgerAccount(contraAccount);
	});

	afterAll(async () => {
		// Clean up test data
		await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, contraAccountId);
		await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, settledAccountId);
		await ledgerRepo.deleteLedger(testOrgId, testLedgerId);
		await organizationRepo.deleteOrganization(testOrgId);
	});

	describe("createSettlement", () => {
		it("should create a settlement in drafting status", async () => {
			const settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				amount: 0,
				normalBalance: "debit",
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				description: "Test settlement",
				externalReference: "EXT-001",
				metadata: { test: "data" },
				created: new Date(),
				updated: new Date(),
			});

			const created = await ledgerAccountSettlementRepo.createSettlement(settlement);

			expect(created.id.toString()).toBe(settlementId.toString());
			expect(created.status).toBe("drafting");
			expect(created.amount).toBe(0);
			expect(created.description).toBe("Test settlement");
			expect(created.externalReference).toBe("EXT-001");

			// Cleanup
			await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
		});

		it("should prevent settling an account to itself", async () => {
			const settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledAccountId: settledAccountId,
				contraAccountId: settledAccountId, // Same as settled account
				amount: 0,
				normalBalance: "debit",
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});

			await expect(ledgerAccountSettlementRepo.createSettlement(settlement)).rejects.toThrow(
				ConflictError
			);
			// No cleanup needed - settlement was never created
		});
	});

	describe("getSettlement", () => {
		let settlementId: LedgerAccountSettlementID;

		beforeAll(async () => {
			settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				amount: 0,
				normalBalance: "debit",
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountSettlementRepo.createSettlement(settlement);
		});

		afterAll(async () => {
			await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
		});

		it("should retrieve a settlement by ID", async () => {
			const settlement = await ledgerAccountSettlementRepo.getSettlement(testOrgId, settlementId);

			expect(settlement.id.toString()).toBe(settlementId.toString());
			expect(settlement.organizationId.toString()).toBe(testOrgId.toString());
		});

		it("should throw NotFoundError for non-existent settlement", async () => {
			const fakeId = new TypeID("las") as LedgerAccountSettlementID;

			await expect(ledgerAccountSettlementRepo.getSettlement(testOrgId, fakeId)).rejects.toThrow(
				NotFoundError
			);
		});

		it("should enforce organization tenancy", async () => {
			const wrongOrgId = new TypeID("org") as OrgID;

			await expect(
				ledgerAccountSettlementRepo.getSettlement(wrongOrgId, settlementId)
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("listSettlements", () => {
		let settlementIds: LedgerAccountSettlementID[] = [];

		beforeAll(async () => {
			// Create multiple settlements
			for (let i = 0; i < 3; i++) {
				const id = new TypeID("las") as LedgerAccountSettlementID;
				const settlement = new LedgerAccountSettlementEntity({
					id,
					organizationId: testOrgId,
					settledAccountId: settledAccountId,
					contraAccountId: contraAccountId,
					amount: 0,
					normalBalance: "debit",
					currency: "USD",
					currencyExponent: 2,
					status: "drafting",
					description: `Settlement ${i}`,
					created: new Date(),
					updated: new Date(),
				});
				await ledgerAccountSettlementRepo.createSettlement(settlement);
				settlementIds.push(id);
			}
		});

		afterAll(async () => {
			// Clean up all test settlements
			for (const id of settlementIds) {
				await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, id);
			}
			settlementIds = [];
		});

		it("should list settlements with pagination", async () => {
			const settlements = await ledgerAccountSettlementRepo.listSettlements(
				testOrgId,
				testLedgerId,
				0,
				10
			);

			expect(settlements.length).toBeGreaterThanOrEqual(3);
		});

		it("should respect pagination offset and limit", async () => {
			const page1 = await ledgerAccountSettlementRepo.listSettlements(testOrgId, testLedgerId, 0, 2);
			const page2 = await ledgerAccountSettlementRepo.listSettlements(testOrgId, testLedgerId, 2, 2);

			expect(page1).toHaveLength(2);
			expect(page1[0].id.toString()).not.toBe(page2[0]?.id.toString());
		});
	});

	describe("updateSettlement", () => {
		let settlementId: LedgerAccountSettlementID;
		let skipCleanup = false;

		beforeEach(async () => {
			settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				amount: 0,
				normalBalance: "debit",
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				description: "Original",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountSettlementRepo.createSettlement(settlement);
		});

		afterEach(async () => {
			if (!skipCleanup) {
				await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
			}
			skipCleanup = false;
		});

		it("should update a settlement in drafting status", async () => {
			const settlement = await ledgerAccountSettlementRepo.getSettlement(testOrgId, settlementId);
			const updated = new LedgerAccountSettlementEntity({
				...settlement,
				description: "Updated description",
			});

			const result = await ledgerAccountSettlementRepo.updateSettlement(updated);

			expect(result.description).toBe("Updated description");
		});

		it("should not allow updates to non-drafting settlements", async () => {
			// Change status to processing
			await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "processing");

			const settlement = await ledgerAccountSettlementRepo.getSettlement(testOrgId, settlementId);
			const updated = new LedgerAccountSettlementEntity({
				...settlement,
				description: "Should fail",
			});

			await expect(ledgerAccountSettlementRepo.updateSettlement(updated)).rejects.toThrow(
				ConflictError
			);

			// Cleanup: restore status and delete
			await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "drafting");
			await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
			skipCleanup = true;
		});
	});

	describe("deleteSettlement", () => {
		it("should delete a settlement in drafting status", async () => {
			const settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				amount: 0,
				normalBalance: "debit",
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountSettlementRepo.createSettlement(settlement);

			await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);

			await expect(ledgerAccountSettlementRepo.getSettlement(testOrgId, settlementId)).rejects.toThrow(
				NotFoundError
			);
		});

		it("should not delete non-drafting settlements", async () => {
			const settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				amount: 0,
				normalBalance: "debit",
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountSettlementRepo.createSettlement(settlement);

			// Change to processing status
			await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "processing");

			await expect(
				ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId)
			).rejects.toThrow(ConflictError);

			// Cleanup
			await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "drafting");
			await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
		});
	});

	describe("updateStatus", () => {
		let settlementId: LedgerAccountSettlementID;
		let skipCleanup = false;

		beforeEach(async () => {
			settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				amount: 0,
				normalBalance: "debit",
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountSettlementRepo.createSettlement(settlement);
		});

		afterEach(async () => {
			if (!skipCleanup) {
				await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
			}
			skipCleanup = false;
		});

		it("should update settlement status", async () => {
			const updated = await ledgerAccountSettlementRepo.updateStatus(
				testOrgId,
				settlementId,
				"processing"
			);

			expect(updated.status).toBe("processing");

			// Cleanup: restore status and delete
			await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "drafting");
			await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
			skipCleanup = true;
		});

		it("should throw NotFoundError for non-existent settlement", async () => {
			const fakeId = new TypeID("las") as LedgerAccountSettlementID;

			await expect(
				ledgerAccountSettlementRepo.updateStatus(testOrgId, fakeId, "processing")
			).rejects.toThrow(NotFoundError);
		});
	});

	describe("Settlement Entry Operations", () => {
		const { ledgerTransactionRepo } = getRepos();
		let settlementId: LedgerAccountSettlementID;
		let transactionId: string;
		let postedEntryIds: string[];

		beforeAll(async () => {
			// Create a settlement for entry operations
			settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				amount: 0,
				normalBalance: "debit",
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});
			await ledgerAccountSettlementRepo.createSettlement(settlement);

			// Create a transaction with posted entries on the settled account
			const transactionEntityId = new TypeID("ltr");
			const entries = [
				createLedgerTransactionEntryEntity({
					organizationId: testOrgId,
					transactionId: transactionEntityId,
					accountId: settledAccountId,
					direction: "debit",
					amount: 10000,
					currency: "USD",
					currencyExponent: 2,
					status: "posted",
				}),
				createLedgerTransactionEntryEntity({
					organizationId: testOrgId,
					transactionId: transactionEntityId,
					accountId: contraAccountId,
					direction: "credit",
					amount: 10000,
					currency: "USD",
					currencyExponent: 2,
					status: "posted",
				}),
			];

			const transactionEntity = createLedgerTransactionEntity({
				id: transactionEntityId,
				organizationId: testOrgId,
				ledgerId: testLedgerId,
				entries,
				description: "Test settlement transaction",
				status: "posted",
			});

			const created = await ledgerTransactionRepo.createTransaction(transactionEntity);
			transactionId = created.id.toString();
			postedEntryIds = created.entries.map(e => e.id.toString());
		});

		afterAll(async () => {
			// Clean up transaction
			await ledgerTransactionRepo.deleteTransaction(
				testOrgId.toString(),
				testLedgerId.toString(),
				transactionId
			);

			// Clean up settlement
			await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
		});

		describe("addEntriesToSettlement", () => {
			afterEach(async () => {
				// Clean up any entries attached during the test
				const entryIds = await ledgerAccountSettlementRepo.getEntryIds(settlementId);
				if (entryIds.length > 0) {
					const settlement = await ledgerAccountSettlementRepo.getSettlement(testOrgId, settlementId);
					if (settlement.status !== "drafting") {
						await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "drafting");
					}
					await ledgerAccountSettlementRepo.removeEntriesFromSettlement(
						testOrgId,
						settlementId,
						entryIds
					);
				}
			});

			it("should add entries to a drafting settlement", async () => {
				// Get the entry that belongs to the settled account
				const settledAccountEntry = postedEntryIds[0];

				await ledgerAccountSettlementRepo.addEntriesToSettlement(testOrgId, settlementId, [
					settledAccountEntry,
				]);

				const entryIds = await ledgerAccountSettlementRepo.getEntryIds(settlementId);
				expect(entryIds).toContain(settledAccountEntry);
			});

			it("should throw ConflictError when settlement is not in drafting status", async () => {
				// Change status to processing
				await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "processing");

				const settledAccountEntry = postedEntryIds[0];

				await expect(
					ledgerAccountSettlementRepo.addEntriesToSettlement(testOrgId, settlementId, [
						settledAccountEntry,
					])
				).rejects.toThrow(ConflictError);

				// Restore to drafting
				await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "drafting");
			});

			it("should throw NotFoundError for non-existent entry", async () => {
				const fakeEntryId = new TypeID("lte").toString();

				await expect(
					ledgerAccountSettlementRepo.addEntriesToSettlement(testOrgId, settlementId, [fakeEntryId])
				).rejects.toThrow(NotFoundError);
			});

			it("should throw ConflictError when entry belongs to different account", async () => {
				// Try to add an entry from the contra account (should fail)
				const contraAccountEntry = postedEntryIds[1];

				await expect(
					ledgerAccountSettlementRepo.addEntriesToSettlement(testOrgId, settlementId, [
						contraAccountEntry,
					])
				).rejects.toThrow(ConflictError);
			});

			it("should throw ConflictError when entry is already attached to settlement", async () => {
				const settledAccountEntry = postedEntryIds[0];

				// Add the entry first
				await ledgerAccountSettlementRepo.addEntriesToSettlement(testOrgId, settlementId, [
					settledAccountEntry,
				]);

				// Try to add it again - should throw ConflictError
				await expect(
					ledgerAccountSettlementRepo.addEntriesToSettlement(testOrgId, settlementId, [
						settledAccountEntry,
					])
				).rejects.toThrow(ConflictError);
			});
		});

		describe("removeEntriesFromSettlement", () => {
			beforeEach(async () => {
				// Ensure we're in drafting status
				const settlement = await ledgerAccountSettlementRepo.getSettlement(testOrgId, settlementId);
				if (settlement.status !== "drafting") {
					await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "drafting");
				}
			});

			afterEach(async () => {
				// Clean up any entries attached during the test
				const entryIds = await ledgerAccountSettlementRepo.getEntryIds(settlementId);
				if (entryIds.length > 0) {
					await ledgerAccountSettlementRepo.removeEntriesFromSettlement(
						testOrgId,
						settlementId,
						entryIds
					);
				}
			});

			it("should remove entries from a drafting settlement", async () => {
				const settledAccountEntry = postedEntryIds[0];

				// First add an entry
				await ledgerAccountSettlementRepo.addEntriesToSettlement(testOrgId, settlementId, [
					settledAccountEntry,
				]);

				// Then remove it
				await ledgerAccountSettlementRepo.removeEntriesFromSettlement(testOrgId, settlementId, [
					settledAccountEntry,
				]);

				const entryIds = await ledgerAccountSettlementRepo.getEntryIds(settlementId);
				expect(entryIds).not.toContain(settledAccountEntry);
			});

			it("should throw ConflictError when settlement is not in drafting status", async () => {
				// Change status to processing
				await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "processing");

				const settledAccountEntry = postedEntryIds[0];

				await expect(
					ledgerAccountSettlementRepo.removeEntriesFromSettlement(testOrgId, settlementId, [
						settledAccountEntry,
					])
				).rejects.toThrow(ConflictError);

				// Restore to drafting
				await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "drafting");
			});
		});

		describe("getEntryIds", () => {
			beforeEach(async () => {
				// Ensure we're in drafting status
				const settlement = await ledgerAccountSettlementRepo.getSettlement(testOrgId, settlementId);
				if (settlement.status !== "drafting") {
					await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "drafting");
				}
			});

			afterEach(async () => {
				// Clean up any entries attached during the test
				const entryIds = await ledgerAccountSettlementRepo.getEntryIds(settlementId);
				if (entryIds.length > 0) {
					await ledgerAccountSettlementRepo.removeEntriesFromSettlement(
						testOrgId,
						settlementId,
						entryIds
					);
				}
			});

			it("should return empty array when no entries attached", async () => {
				const entryIds = await ledgerAccountSettlementRepo.getEntryIds(settlementId);

				expect(entryIds).toEqual([]);
			});

			it("should return all attached entry IDs", async () => {
				const settledAccountEntry = postedEntryIds[0];

				// Add an entry
				await ledgerAccountSettlementRepo.addEntriesToSettlement(testOrgId, settlementId, [
					settledAccountEntry,
				]);

				const entryIds = await ledgerAccountSettlementRepo.getEntryIds(settlementId);

				expect(entryIds).toHaveLength(1);
				expect(entryIds).toContain(settledAccountEntry);
			});
		});

		describe("calculateAmount", () => {
			beforeEach(async () => {
				// Ensure we're in drafting status
				const settlement = await ledgerAccountSettlementRepo.getSettlement(testOrgId, settlementId);
				if (settlement.status !== "drafting") {
					await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlementId, "drafting");
				}
			});

			afterEach(async () => {
				// Clean up any entries attached during the test
				const entryIds = await ledgerAccountSettlementRepo.getEntryIds(settlementId);
				if (entryIds.length > 0) {
					await ledgerAccountSettlementRepo.removeEntriesFromSettlement(
						testOrgId,
						settlementId,
						entryIds
					);
				}
			});

			it("should return 0 when no entries attached", async () => {
				const amount = await ledgerAccountSettlementRepo.calculateAmount(settlementId);

				expect(amount).toBe(0);
			});

			it("should return sum of all attached entry amounts", async () => {
				const settledAccountEntry = postedEntryIds[0];

				// Add the entry (amount: 10000)
				await ledgerAccountSettlementRepo.addEntriesToSettlement(testOrgId, settlementId, [
					settledAccountEntry,
				]);

				const amount = await ledgerAccountSettlementRepo.calculateAmount(settlementId);

				expect(amount).toBe(10000);
			});
		});
	});
});
