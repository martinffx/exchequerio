import { TypeID } from "typeid-js";
import { NotFoundError } from "@/errors";
import type {
	LedgerAccountBalanceMonitorID,
	LedgerAccountID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import {
	createLedgerAccountBalanceMonitorEntity,
	createLedgerAccountEntity,
	createLedgerEntity,
	createOrganizationEntity,
	getRepos,
} from "./fixtures";

describe("LedgerAccountBalanceMonitorRepo", () => {
	const { organizationRepo, ledgerRepo, ledgerAccountRepo, ledgerAccountBalanceMonitorRepo } =
		getRepos();

	// Test IDs - shared across test suite
	let testOrgId: OrgID;
	let testLedgerId: LedgerID;
	let testAccountId: LedgerAccountID;

	beforeAll(async () => {
		// Create test organization
		testOrgId = new TypeID("org") as OrgID;
		const orgEntity = createOrganizationEntity({
			id: testOrgId,
			name: "Balance Monitor Test Org",
		});
		await organizationRepo.createOrganization(orgEntity);

		// Create test ledger
		testLedgerId = new TypeID("lgr") as LedgerID;
		const ledgerEntity = createLedgerEntity({
			id: testLedgerId,
			organizationId: testOrgId,
			name: "Balance Monitor Test Ledger",
			currency: "USD",
			currencyExponent: 2,
		});
		await ledgerRepo.upsertLedger(ledgerEntity);

		// Create test account
		testAccountId = new TypeID("lat") as LedgerAccountID;
		const accountEntity = createLedgerAccountEntity({
			id: testAccountId,
			organizationId: testOrgId,
			ledgerId: testLedgerId,
			name: "Test Account for Monitors",
			normalBalance: "debit",
		});
		await ledgerAccountRepo.upsertLedgerAccount(accountEntity);
	});

	afterAll(async () => {
		// Clean up test data in reverse order
		await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, testAccountId);
		await ledgerRepo.deleteLedger(testOrgId, testLedgerId);
		await organizationRepo.deleteOrganization(testOrgId);
	});

	describe("listMonitors", () => {
		let monitorIds: LedgerAccountBalanceMonitorID[] = [];

		beforeAll(async () => {
			// Create multiple monitors for listing tests
			for (let i = 0; i < 5; i++) {
				const monitorId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;
				const monitor = createLedgerAccountBalanceMonitorEntity({
					id: monitorId,
					accountId: testAccountId,
					name: `Monitor ${i}`,
					alertThreshold: 1000 * (i + 1),
					isActive: i % 2 === 0,
				});
				await ledgerAccountBalanceMonitorRepo.createMonitor(monitor);
				monitorIds.push(monitorId);
			}
		});

		afterAll(async () => {
			// Clean up monitors
			for (const id of monitorIds) {
				await ledgerAccountBalanceMonitorRepo.deleteMonitor(id);
			}
			monitorIds = [];
		});

		it("should list monitors with pagination", async () => {
			const monitors = await ledgerAccountBalanceMonitorRepo.listMonitors(0, 10);

			expect(monitors.length).toBeGreaterThanOrEqual(5);
			expect(monitors[0].accountId.toString()).toBe(testAccountId.toString());
		});

		it("should respect offset and limit", async () => {
			const page1 = await ledgerAccountBalanceMonitorRepo.listMonitors(0, 2);
			const page2 = await ledgerAccountBalanceMonitorRepo.listMonitors(2, 2);

			expect(page1).toHaveLength(2);
			expect(page2.length).toBeGreaterThanOrEqual(2);
			// Ensure different results (ordering by created desc means first page != second page)
			expect(page1[0].id.toString()).not.toBe(page2[0].id.toString());
		});

		it("should return empty array when offset exceeds available records", async () => {
			const monitors = await ledgerAccountBalanceMonitorRepo.listMonitors(10000, 10);

			expect(monitors).toEqual([]);
		});
	});

	describe("getMonitor", () => {
		let monitorId: LedgerAccountBalanceMonitorID;

		beforeAll(async () => {
			monitorId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;
			const monitor = createLedgerAccountBalanceMonitorEntity({
				id: monitorId,
				accountId: testAccountId,
				name: "Get Test Monitor",
				description: "Test description",
				alertThreshold: 5000,
				isActive: true,
				metadata: { test: "data" },
			});
			await ledgerAccountBalanceMonitorRepo.createMonitor(monitor);
		});

		afterAll(async () => {
			await ledgerAccountBalanceMonitorRepo.deleteMonitor(monitorId);
		});

		it("should retrieve monitor by ID", async () => {
			const monitor = await ledgerAccountBalanceMonitorRepo.getMonitor(monitorId);

			expect(monitor.id.toString()).toBe(monitorId.toString());
			expect(monitor.accountId.toString()).toBe(testAccountId.toString());
			expect(monitor.name).toBe("Get Test Monitor");
			expect(monitor.description).toBe("Test description");
			expect(monitor.alertThreshold).toBe(5000);
			expect(monitor.isActive).toBe(true);
			expect(monitor.metadata).toEqual({ test: "data" });
		});

		it("should throw NotFoundError for non-existent monitor", async () => {
			const fakeId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;

			await expect(ledgerAccountBalanceMonitorRepo.getMonitor(fakeId)).rejects.toThrow(NotFoundError);
		});
	});

	describe("createMonitor", () => {
		let monitorId: LedgerAccountBalanceMonitorID;

		afterEach(async () => {
			if (monitorId) {
				await ledgerAccountBalanceMonitorRepo.deleteMonitor(monitorId);
			}
		});

		it("should create a new balance monitor", async () => {
			monitorId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;
			const monitor = createLedgerAccountBalanceMonitorEntity({
				id: monitorId,
				accountId: testAccountId,
				name: "Create Test Monitor",
				description: "Monitor for low balance",
				alertThreshold: 10000,
				isActive: true,
				metadata: { priority: "high" },
			});

			const created = await ledgerAccountBalanceMonitorRepo.createMonitor(monitor);

			expect(created.id.toString()).toBe(monitorId.toString());
			expect(created.accountId.toString()).toBe(testAccountId.toString());
			expect(created.name).toBe("Create Test Monitor");
			expect(created.description).toBe("Monitor for low balance");
			expect(created.alertThreshold).toBe(10000);
			expect(created.isActive).toBe(true);
			expect(created.metadata).toEqual({ priority: "high" });
		});

		it("should create monitor with minimal fields", async () => {
			monitorId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;
			const monitor = createLedgerAccountBalanceMonitorEntity({
				id: monitorId,
				accountId: testAccountId,
				name: "Minimal Monitor",
				alertThreshold: 0,
				isActive: false,
			});

			const created = await ledgerAccountBalanceMonitorRepo.createMonitor(monitor);

			expect(created.id.toString()).toBe(monitorId.toString());
			expect(created.name).toBe("Minimal Monitor");
			expect(created.description).toBeUndefined();
			expect(created.metadata).toBeUndefined();
		});
	});

	describe("updateMonitor", () => {
		let monitorId: LedgerAccountBalanceMonitorID;

		beforeEach(async () => {
			monitorId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;
			const monitor = createLedgerAccountBalanceMonitorEntity({
				id: monitorId,
				accountId: testAccountId,
				name: "Original Name",
				description: "Original description",
				alertThreshold: 1000,
				isActive: true,
			});
			await ledgerAccountBalanceMonitorRepo.createMonitor(monitor);
		});

		afterEach(async () => {
			await ledgerAccountBalanceMonitorRepo.deleteMonitor(monitorId);
		});

		it("should update an existing monitor", async () => {
			const existing = await ledgerAccountBalanceMonitorRepo.getMonitor(monitorId);
			const updated = createLedgerAccountBalanceMonitorEntity({
				...existing,
				name: "Updated Name",
				description: "Updated description",
				alertThreshold: 5000,
				isActive: false,
				metadata: { updated: true },
			});

			const result = await ledgerAccountBalanceMonitorRepo.updateMonitor(monitorId, updated);

			expect(result.id.toString()).toBe(monitorId.toString());
			expect(result.name).toBe("Updated Name");
			expect(result.description).toBe("Updated description");
			expect(result.alertThreshold).toBe(5000);
			expect(result.isActive).toBe(false);
			expect(result.metadata).toEqual({ updated: true });
		});

		it("should throw NotFoundError for non-existent monitor", async () => {
			const fakeId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;
			const monitor = createLedgerAccountBalanceMonitorEntity({
				id: fakeId,
				accountId: testAccountId,
				name: "Should Fail",
			});

			await expect(ledgerAccountBalanceMonitorRepo.updateMonitor(fakeId, monitor)).rejects.toThrow(
				NotFoundError
			);
		});
	});

	describe("deleteMonitor", () => {
		it("should delete an existing monitor", async () => {
			const monitorId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;
			const monitor = createLedgerAccountBalanceMonitorEntity({
				id: monitorId,
				accountId: testAccountId,
				name: "To Delete",
			});
			await ledgerAccountBalanceMonitorRepo.createMonitor(monitor);

			await ledgerAccountBalanceMonitorRepo.deleteMonitor(monitorId);

			await expect(ledgerAccountBalanceMonitorRepo.getMonitor(monitorId)).rejects.toThrow(
				NotFoundError
			);
		});

		it("should throw NotFoundError for non-existent monitor", async () => {
			const fakeId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;

			await expect(ledgerAccountBalanceMonitorRepo.deleteMonitor(fakeId)).rejects.toThrow(
				NotFoundError
			);
		});
	});
});
