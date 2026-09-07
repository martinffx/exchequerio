import { Layer } from "effect";
import { Organization } from "@/domains/organizations/Organization";
import { organizationRepoLayer } from "@/domains/organizations/OrganizationRepo";
import { Ledger } from "@/domains/ledgers/Ledger";
import { ledgerRepoLayer } from "@/domains/ledgers/LedgerRepo";
import { LedgerAccount } from "../LedgerAccount";
import { ledgerAccountRepoLayer } from "../LedgerAccountRepo";
import { newOrgID, newLedgerID, newLedgerAccountID } from "@/lib/ids";

import { faker } from "@faker-js/faker";
import { TypeID } from "typeid-js";
import type { Metadata } from "@/lib/schema";
import { LedgerAccountCategoryEntity } from "./LedgerAccountCategoryEntity";
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

export { createLedgerAccountCategoryFixture };

export const fixtureRepoLayer = Layer.mergeAll(
	organizationRepoLayer,
	ledgerRepoLayer,
	ledgerAccountRepoLayer
);

export function createOrganizationEntity(
	options: Partial<Pick<Organization, "id" | "name" | "description">> = {}
): Organization {
	return Organization.fromRequest(options.id ?? newOrgID(), {
		name: options.name ?? "Test Organization",
		description: options.description,
	});
}
export function createLedgerEntity(
	options: Partial<Pick<Ledger, "id" | "organizationId" | "name" | "description" | "metadata">> = {}
): Ledger {
	return Ledger.fromRequest(options.id ?? newLedgerID(), options.organizationId ?? newOrgID(), {
		name: options.name ?? "Ledger",
		description: options.description,
		metadata: options.metadata,
	});
}
export function createLedgerAccountEntity(
	options: Partial<
		Pick<
			LedgerAccount,
			"id" | "organizationId" | "ledgerId" | "name" | "description" | "normalBalance" | "metadata"
		>
	> = {}
): LedgerAccount {
	const orgId = options.organizationId ?? newOrgID();
	const asset = {
		assetId: `ast_${orgId.toString().slice(4)}`,
		assetCode: "USD",
		minorUnitExponent: 2,
	};
	return LedgerAccount.fromCreateRequest(
		options.id ?? newLedgerAccountID(),
		orgId,
		options.ledgerId ?? newLedgerID(),
		{
			name: options.name ?? "Ledger Account",
			description: options.description,
			normalBalance: options.normalBalance ?? "credit",
			assetId: asset.assetId,
			metadata: options.metadata,
		},
		asset
	);
}
