import { TypeID } from "typeid-js";
import { NotFoundError } from "@/errors";
import type {
	LedgerAccountID,
	LedgerAccountStatementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import {
	createLedgerAccountEntity,
	createLedgerAccountStatementEntity,
	createLedgerEntity,
	createOrganizationEntity,
	getRepos,
} from "./fixtures";

describe("LedgerAccountStatementRepo", () => {
	const { organizationRepo, ledgerRepo, ledgerAccountRepo, ledgerAccountStatementRepo } = getRepos();

	// Test IDs - shared across test suite
	let testOrgId: OrgID;
	let testLedgerId: LedgerID;
	let testAccountId: LedgerAccountID;

	// Track all created statement IDs for cleanup
	const allStatementIds: LedgerAccountStatementID[] = [];
	beforeAll(async () => {
		// Create test organization
		testOrgId = new TypeID("org") as OrgID;
		const orgEntity = createOrganizationEntity({
			id: testOrgId,
			name: "Statement Test Org",
		});
		await organizationRepo.createOrganization(orgEntity);

		// Create test ledger
		testLedgerId = new TypeID("lgr") as LedgerID;
		const ledgerEntity = createLedgerEntity({
			id: testLedgerId,
			organizationId: testOrgId,
			name: "Statement Test Ledger",
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
			name: "Test Account for Statements",
			normalBalance: "debit",
		});
		await ledgerAccountRepo.upsertLedgerAccount(accountEntity);
	});

	afterAll(async () => {
		// Clean up test data in reverse order
		// Delete all statements first using the repo
		for (const statementId of allStatementIds) {
			await ledgerAccountStatementRepo.deleteStatement(statementId);
		}

		await ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, testAccountId);
		await ledgerRepo.deleteLedger(testOrgId, testLedgerId);
		await organizationRepo.deleteOrganization(testOrgId);
	});

	describe("getStatement", () => {
		let statementId: LedgerAccountStatementID;

		beforeAll(async () => {
			statementId = new TypeID("lst") as LedgerAccountStatementID;
			allStatementIds.push(statementId);

			const statement = createLedgerAccountStatementEntity({
				id: statementId,
				ledgerId: testLedgerId,
				accountId: testAccountId,
				statementDate: new Date("2024-01-01"),
				openingBalance: 0,
				closingBalance: 50000,
				totalCredits: 75000,
				totalDebits: 25000,
				transactionCount: 10,
				metadata: { period: "monthly" },
			});
			await ledgerAccountStatementRepo.createStatement(statement);
		});

		it("should retrieve statement by ID", async () => {
			const statement = await ledgerAccountStatementRepo.getStatement(statementId);

			expect(statement.id.toString()).toBe(statementId.toString());
			expect(statement.accountId.toString()).toBe(testAccountId.toString());
			expect(statement.statementDate.toISOString()).toBe(new Date("2024-01-01").toISOString());
			expect(statement.openingBalance).toBe(0);
			expect(statement.closingBalance).toBe(50000);
			expect(statement.totalCredits).toBe(75000);
			expect(statement.totalDebits).toBe(25000);
			expect(statement.transactionCount).toBe(10);
			expect(statement.metadata).toEqual({ period: "monthly" });
		});

		it("should throw NotFoundError for non-existent statement", async () => {
			const fakeId = new TypeID("lst") as LedgerAccountStatementID;

			await expect(ledgerAccountStatementRepo.getStatement(fakeId)).rejects.toThrow(NotFoundError);
		});
	});

	describe("createStatement", () => {
		it("should create a new statement with all fields", async () => {
			const statementId = new TypeID("lst") as LedgerAccountStatementID;
			allStatementIds.push(statementId);

			const statement = createLedgerAccountStatementEntity({
				id: statementId,
				ledgerId: testLedgerId,
				accountId: testAccountId,
				statementDate: new Date("2024-02-01"),
				openingBalance: 50000,
				closingBalance: 75000,
				totalCredits: 30000,
				totalDebits: 5000,
				transactionCount: 5,
				metadata: { period: "monthly", year: 2024, month: 2 },
			});

			const created = await ledgerAccountStatementRepo.createStatement(statement);

			expect(created.id.toString()).toBe(statementId.toString());
			expect(created.accountId.toString()).toBe(testAccountId.toString());
			expect(created.statementDate.toISOString()).toBe(new Date("2024-02-01").toISOString());
			expect(created.openingBalance).toBe(50000);
			expect(created.closingBalance).toBe(75000);
			expect(created.totalCredits).toBe(30000);
			expect(created.totalDebits).toBe(5000);
			expect(created.transactionCount).toBe(5);
			expect(created.metadata).toEqual({ period: "monthly", year: 2024, month: 2 });
		});

		it("should create statement with minimal fields", async () => {
			const statementId = new TypeID("lst") as LedgerAccountStatementID;
			allStatementIds.push(statementId);

			const statement = createLedgerAccountStatementEntity({
				id: statementId,
				ledgerId: testLedgerId,
				accountId: testAccountId,
				statementDate: new Date("2024-03-01"),
				openingBalance: 0,
				closingBalance: 0,
				totalCredits: 0,
				totalDebits: 0,
				transactionCount: 0,
			});

			const created = await ledgerAccountStatementRepo.createStatement(statement);

			expect(created.id.toString()).toBe(statementId.toString());
			expect(created.openingBalance).toBe(0);
			expect(created.closingBalance).toBe(0);
			expect(created.totalCredits).toBe(0);
			expect(created.totalDebits).toBe(0);
			expect(created.transactionCount).toBe(0);
			expect(created.metadata).toBeUndefined();
		});

		it("should create statement with zero balances", async () => {
			const statementId = new TypeID("lst") as LedgerAccountStatementID;
			allStatementIds.push(statementId);

			const statement = createLedgerAccountStatementEntity({
				id: statementId,
				ledgerId: testLedgerId,
				accountId: testAccountId,
				statementDate: new Date("2024-04-01"),
				openingBalance: 0,
				closingBalance: 0,
				totalCredits: 0,
				totalDebits: 0,
				transactionCount: 0,
			});

			const created = await ledgerAccountStatementRepo.createStatement(statement);

			expect(created.openingBalance).toBe(0);
			expect(created.closingBalance).toBe(0);
		});

		it("should create statement with large numbers", async () => {
			const statementId = new TypeID("lst") as LedgerAccountStatementID;
			allStatementIds.push(statementId);

			const statement = createLedgerAccountStatementEntity({
				id: statementId,
				ledgerId: testLedgerId,
				accountId: testAccountId,
				statementDate: new Date("2024-05-01"),
				openingBalance: 1000000000, // 1 billion cents = $10M
				closingBalance: 2000000000, // 2 billion cents = $20M
				totalCredits: 1500000000,
				totalDebits: 500000000,
				transactionCount: 1000,
			});

			const created = await ledgerAccountStatementRepo.createStatement(statement);

			expect(created.openingBalance).toBe(1000000000);
			expect(created.closingBalance).toBe(2000000000);
			expect(created.totalCredits).toBe(1500000000);
			expect(created.totalDebits).toBe(500000000);
			expect(created.transactionCount).toBe(1000);
		});
	});
});
