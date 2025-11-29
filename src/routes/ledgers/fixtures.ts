import { faker } from "@faker-js/faker";
import { TypeID } from "typeid-js";
import { LedgerEntity, OrganizationEntity } from "@/services";

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

export { createOrganizationFixture, createLedgerFixture };
