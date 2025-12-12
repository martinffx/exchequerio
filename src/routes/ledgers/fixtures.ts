import { faker } from "@faker-js/faker";
import { TypeID } from "typeid-js";
import { LedgerTransactionEntryEntity } from "@/repo/entities/LedgerTransactionEntryEntity";
import {
	LedgerAccountBalanceMonitorEntity,
	LedgerAccountCategoryEntity,
	LedgerAccountEntity,
	LedgerAccountSettlementEntity,
	LedgerAccountStatementEntity,
	LedgerEntity,
	LedgerTransactionEntity,
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
		currency: "USD",
		currencyExponent: 2,
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
		pendingAmount: number;
		postedAmount: number;
		availableAmount: number;
		pendingCredits: number;
		pendingDebits: number;
		postedCredits: number;
		postedDebits: number;
		availableCredits: number;
		availableDebits: number;
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

function createLedgerTransactionFixture(
	overrides?: Partial<{
		id: TypeID<"ltr">;
		organizationId: TypeID<"org">;
		ledgerId: TypeID<"lgr">;
		entries: LedgerTransactionEntryEntity[];
		idempotencyKey?: string;
		description?: string;
		status: "pending" | "posted" | "archived";
		effectiveAt: Date;
		metadata?: Record<string, unknown>;
		created: Date;
		updated: Date;
	}>
): LedgerTransactionEntity {
	const now = new Date();
	const transactionId = overrides?.id ?? new TypeID("ltr");
	const orgId = overrides?.organizationId ?? new TypeID("org");
	const ledgerId = overrides?.ledgerId ?? new TypeID("lgr");
	const currency = "USD";
	const currencyExponent = 2;
	const amount = 10000; // $100.00
	const created = overrides?.created ?? now;
	const updated = overrides?.updated ?? now;

	// Use fixed IDs for stable snapshots when created/updated are provided
	const useFixedIds = overrides?.created !== undefined || overrides?.updated !== undefined;

	// Create default entries if not provided
	const defaultEntries = overrides?.entries ?? [
		new LedgerTransactionEntryEntity({
			id: useFixedIds ? TypeID.fromString("lte_01h2x3y4z5a6b7c8d9e0f1g2h9") : new TypeID("lte"),
			organizationId: orgId,
			transactionId,
			accountId: useFixedIds ? TypeID.fromString("lat_01h2x3y4z5a6b7c8d9e0f1g2j0") : new TypeID("lat"),
			direction: "debit",
			amount,
			currency,
			currencyExponent,
			status: overrides?.status ?? "pending",
			created,
			updated,
		}),
		new LedgerTransactionEntryEntity({
			id: useFixedIds ? TypeID.fromString("lte_01h2x3y4z5a6b7c8d9e0f1g2j1") : new TypeID("lte"),
			organizationId: orgId,
			transactionId,
			accountId: useFixedIds ? TypeID.fromString("lat_01h2x3y4z5a6b7c8d9e0f1g2j2") : new TypeID("lat"),
			direction: "credit",
			amount,
			currency,
			currencyExponent,
			status: overrides?.status ?? "pending",
			created,
			updated,
		}),
	];

	return new LedgerTransactionEntity({
		id: transactionId,
		organizationId: orgId,
		ledgerId,
		entries: defaultEntries,
		description: faker.lorem.sentence(),
		status: "pending",
		effectiveAt: now,
		metadata: undefined,
		created: now,
		updated: now,
		...overrides,
	});
}

function createLedgerAccountSettlementFixture(
	overrides?: Partial<{
		id: TypeID<"las">;
		organizationId: TypeID<"org">;
		transactionId?: TypeID<"ltr">;
		settledAccountId: TypeID<"lat">;
		contraAccountId: TypeID<"lat">;
		amount: number;
		normalBalance: "debit" | "credit";
		currency: string;
		currencyExponent: number;
		status: "drafting" | "processing" | "pending" | "posted" | "archiving" | "archived";
		description?: string;
		externalReference?: string;
		effectiveAtUpperBound?: Date;
		metadata?: Record<string, unknown>;
		created: Date;
		updated: Date;
	}>
): LedgerAccountSettlementEntity {
	const now = new Date();
	return new LedgerAccountSettlementEntity({
		id: new TypeID("las"),
		organizationId: new TypeID("org"),
		transactionId: undefined,
		settledAccountId: new TypeID("lat"),
		contraAccountId: new TypeID("lat"),
		amount: 0,
		normalBalance: "debit",
		currency: "USD",
		currencyExponent: 2,
		status: "drafting",
		description: faker.lorem.sentence(),
		externalReference: undefined,
		effectiveAtUpperBound: undefined,
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
	createLedgerTransactionFixture,
	createLedgerAccountSettlementFixture,
	createLedgerAccountStatementFixture,
	createLedgerAccountBalanceMonitorFixture,
};
