import { faker } from "@faker-js/faker";
import { TypeID } from "typeid-js";
import type { Metadata } from "@/lib/schema";
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
		metadata?: Metadata;
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
		organizationId: TypeID<"org">;
		ledgerId: TypeID<"lgr">;
		name: string;
		description?: string;
		normalBalance: "debit" | "credit";
		metadata?: Metadata;
		created: Date;
		updated: Date;
	}>
): LedgerAccountCategoryEntity {
	const now = new Date();
	return new LedgerAccountCategoryEntity({
		id: new TypeID("lac"),
		organizationId: new TypeID("org"),
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
