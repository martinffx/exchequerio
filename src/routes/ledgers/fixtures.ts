import { faker } from "@faker-js/faker";
import { TypeID } from "typeid-js";
import {
	LedgerAccountCategoryEntity,
	LedgerAccountEntity,
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

export {
	createOrganizationFixture,
	createLedgerFixture,
	createLedgerAccountFixture,
	createLedgerAccountCategoryFixture,
};
