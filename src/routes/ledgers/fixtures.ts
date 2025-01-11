import { LedgerEntity, OrganizationEntity } from "@/services";
import { faker } from "@faker-js/faker";

function createOrganizationFixture(): OrganizationEntity {
	return new OrganizationEntity({
		name: faker.company.name(),
		description: faker.lorem.sentence(),
	});
}

function createLedgerFixture(): LedgerEntity {
	return new LedgerEntity({
		name: faker.company.name(),
		description: faker.lorem.sentence(),
	});
}

export { createOrganizationFixture, createLedgerFixture };
