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
		// Note: Settlements must be deleted before accounts due to foreign key constraints
		// Delete any remaining settlements that tests might have left behind
		try {
			const remainingSettlements = await ledgerAccountSettlementRepo.listSettlements(
				testOrgId,
				testLedgerId,
				0,
				100
			);
			for (const settlement of remainingSettlements) {
				try {
					// Try to transition to drafting first if not already
					if (settlement.status !== "drafting") {
						await ledgerAccountSettlementRepo.updateStatus(testOrgId, settlement.id, "drafting");
					}
					await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlement.id);
				} catch {
					// Ignore - settlement might not allow transitions
				}
			}
		} catch {
			// Ignore - settlements might not exist
		}

		await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, contraAccountId);
		await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, settledAccountId);
		await ledgerRepo.deleteLedger(testOrgId, testLedgerId);
		await organizationRepo.deleteOrganization(testOrgId);
	});

	describe("createSettlement", () => {
		let settlementId: LedgerAccountSettlementID;

		afterEach(async () => {
			// Clean up settlements created in tests
			if (settlementId) {
				try {
					await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
				} catch {
					// Ignore if already deleted
				}
			}
		});

		it("should create a settlement in drafting status", async () => {
			settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledLedgerAccountId: settledAccountId,
				contraLedgerAccountId: contraAccountId,
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
		});

		it("should prevent settling an account to itself", async () => {
			settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledLedgerAccountId: settledAccountId,
				contraLedgerAccountId: settledAccountId, // Same as settled account
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
		});
	});

	describe("getSettlement", () => {
		let settlementId: LedgerAccountSettlementID;

		beforeAll(async () => {
			settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledLedgerAccountId: settledAccountId,
				contraLedgerAccountId: contraAccountId,
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
					settledLedgerAccountId: settledAccountId,
					contraLedgerAccountId: contraAccountId,
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
				try {
					await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, id);
				} catch {
					// Ignore
				}
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

		beforeEach(async () => {
			settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledLedgerAccountId: settledAccountId,
				contraLedgerAccountId: contraAccountId,
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
			try {
				await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
			} catch {
				// Ignore
			}
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
		});
	});

	describe("deleteSettlement", () => {
		it("should delete a settlement in drafting status", async () => {
			const settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledLedgerAccountId: settledAccountId,
				contraLedgerAccountId: contraAccountId,
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
				settledLedgerAccountId: settledAccountId,
				contraLedgerAccountId: contraAccountId,
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

		beforeEach(async () => {
			settlementId = new TypeID("las") as LedgerAccountSettlementID;
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: testOrgId,
				settledLedgerAccountId: settledAccountId,
				contraLedgerAccountId: contraAccountId,
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
			try {
				await ledgerAccountSettlementRepo.deleteSettlement(testOrgId, settlementId);
			} catch {
				// Ignore - may have been transitioned out of drafting
			}
		});

		it("should update settlement status", async () => {
			const updated = await ledgerAccountSettlementRepo.updateStatus(
				testOrgId,
				settlementId,
				"processing"
			);

			expect(updated.status).toBe("processing");
		});

		it("should throw NotFoundError for non-existent settlement", async () => {
			const fakeId = new TypeID("las") as LedgerAccountSettlementID;

			await expect(
				ledgerAccountSettlementRepo.updateStatus(testOrgId, fakeId, "processing")
			).rejects.toThrow(NotFoundError);
		});
	});
});
