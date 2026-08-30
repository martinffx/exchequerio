import { faker } from "@faker-js/faker";
import { TypeID } from "typeid-js";
import {
	LedgerAccountBalanceMonitorEntity,
	LedgerAccountCategoryEntity,
	LedgerAccountEntity,
	LedgerAccountStatementEntity,
	LedgerEntity,
	OrganizationEntity,
} from "@/services";

function createOrganizationFixture(): OrganizationEntity {
	return new OrganizationEntity({
		name: faker.company.name(),
		description: faker.lorem.sentence(),
	});
}

function createLedgerFixture(): LedgerEntity {
	const now = new Date();
	return new LedgerEntity({
		id: new TypeID("lgr"),
		organizationId: new TypeID("org"),
		name: faker.company.name(),
		description: faker.lorem.sentence(),
		metadata: undefined,
		created: now,
		updated: now,
	});
}

function createLedgerAccountFixture(
	overrides?: Partial<{
		id: TypeID<"lat">;
		organizationId: TypeID<"org">;
		ledgerId: TypeID<"lgr">;
		name: string;
		description?: string;
		normalBalance: "debit" | "credit";
		pendingCredits: number;
		pendingDebits: number;
		postedCredits: number;
		postedDebits: number;
		lockVersion: number;
		metadata?: Record<string, unknown>;
		created: Date;
		updated: Date;
	}>
): LedgerAccountEntity {
	const now = new Date();
	return new LedgerAccountEntity({
		id: new TypeID("lat"),
		organizationId: new TypeID("org"),
		ledgerId: new TypeID("lgr"),
		name: faker.finance.accountName(),
		description: faker.lorem.sentence(),
		normalBalance: "debit",
		pendingCredits: 0,
		pendingDebits: 0,
		postedCredits: 0,
		postedDebits: 0,
		lockVersion: 1,
		metadata: undefined,
		created: now,
		updated: now,
		...overrides,
	});
}

function createLedgerAccountCategoryFixture(
	overrides?: Partial<{
		id: TypeID<"lac">;
		ledgerId: TypeID<"lgr">;
		name: string;
		description?: string;
		normalBalance: "debit" | "credit";
		metadata?: Record<string, unknown>;
		created: Date;
		updated: Date;
	}>
): LedgerAccountCategoryEntity {
	const now = new Date();
	return new LedgerAccountCategoryEntity({
		id: new TypeID("lac"),
		ledgerId: new TypeID("lgr"),
		name: faker.finance.accountName(),
		description: faker.lorem.sentence(),
		normalBalance: "debit",
		metadata: undefined,
		created: now,
		updated: now,
		...overrides,
	});
}

function createLedgerAccountStatementFixture(
	overrides?: Partial<{
		id: TypeID<"lst">;
		ledgerId: TypeID<"lgr">;
		accountId: TypeID<"lat">;
		statementDate: Date;
		openingBalance: number;
		closingBalance: number;
		totalCredits: number;
		totalDebits: number;
		transactionCount: number;
		metadata?: Record<string, unknown>;
		created: Date;
		updated: Date;
	}>
): LedgerAccountStatementEntity {
	const now = new Date();
	// Use fixed IDs for stable snapshots when created/updated are provided
	const useFixedIds = overrides?.created !== undefined || overrides?.updated !== undefined;

	return new LedgerAccountStatementEntity({
		id: useFixedIds ? TypeID.fromString("lst_01h2x3y4z5a6b7c8d9e0f1g2h7") : new TypeID("lst"),
		ledgerId: useFixedIds ? TypeID.fromString("lgr_01h2x3y4z5a6b7c8d9e0f1g2h4") : new TypeID("lgr"),
		accountId: useFixedIds ? TypeID.fromString("lat_01h2x3y4z5a6b7c8d9e0f1g2h8") : new TypeID("lat"),
		statementDate: now,
		openingBalance: 0,
		closingBalance: 0,
		totalCredits: 0,
		totalDebits: 0,
		transactionCount: 0,
		metadata: undefined,
		created: now,
		updated: now,
		...overrides,
	});
}

function createLedgerAccountBalanceMonitorFixture(
	overrides?: Partial<{
		id: TypeID<"lbm">;
		accountId: TypeID<"lat">;
		name: string;
		description?: string;
		alertThreshold: number;
		isActive: boolean;
		metadata?: Record<string, unknown>;
		created: Date;
		updated: Date;
	}>
): LedgerAccountBalanceMonitorEntity {
	const now = new Date();
	return new LedgerAccountBalanceMonitorEntity({
		id: new TypeID("lbm"),
		accountId: new TypeID("lat"),
		name: faker.lorem.words(3),
		description: faker.lorem.sentence(),
		alertThreshold: 100000, // $1,000.00
		isActive: true,
		metadata: undefined,
		created: now,
		updated: now,
		...overrides,
	});
}

export {
	createOrganizationFixture,
	createLedgerFixture,
	createLedgerAccountFixture,
	createLedgerAccountCategoryFixture,
	createLedgerAccountStatementFixture,
	createLedgerAccountBalanceMonitorFixture,
};
