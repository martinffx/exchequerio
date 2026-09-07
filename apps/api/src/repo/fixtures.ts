import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { DateTime } from "luxon";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import { Config } from "@/config";
import { LedgerAccountEntity, LedgerEntity, OrganizationEntity } from "@/repo/entities";
import type { LedgerAccountEntityOpts } from "@/repo/entities/LedgerAccountEntity";
import type { LedgerEntityOpts } from "@/repo/entities/LedgerEntity";
import type { OrgEntityOpts } from "@/repo/entities/OrganizationEntity";
import { LedgerAccountRepo } from "./LedgerAccountRepo";
import { LedgerRepo } from "./LedgerRepo";
import * as schema from "./schema";
import type { DrizzleDB } from "./types";

interface OrganizationFixtureRepo {
	createOrganization(record: OrganizationEntity): Promise<OrganizationEntity>;
	deleteOrganization(id: TypeID<"org">): Promise<void>;
}

type TestRepos = {
	db: DrizzleDB;
	organizationRepo: OrganizationFixtureRepo;
	ledgerRepo: LedgerRepo;
	ledgerAccountRepo: LedgerAccountRepo;
};

let repos: TestRepos | undefined;
function getRepos(): TestRepos {
	if (repos !== undefined) {
		return repos;
	}

	const config = new Config();
	const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
	const db = drizzle({ client: pool, relations: schema.schemaRelations });

	const organizationRepo: OrganizationFixtureRepo = {
		createOrganization: async record => {
			await db.insert(schema.OrganizationsTable).values({
				id: record.id.toString(),
				name: record.name,
				description: record.description,
				created: record.created?.toJSDate(),
				updated: record.updated?.toJSDate(),
			});
			return record;
		},
		deleteOrganization: async id => {
			await db
				.delete(schema.OrganizationsTable)
				.where(eq(schema.OrganizationsTable.id, id.toString()));
		},
	};
	const ledgerRepo = new LedgerRepo(db);
	const ledgerAccountRepo = new LedgerAccountRepo(db);

	repos = {
		db,
		organizationRepo,
		ledgerRepo,
		ledgerAccountRepo,
	};

	return repos;
}

/**
 * Creates an OrganizationEntity with sensible test defaults.
 *
 * @param options - Partial options to override defaults
 * @returns A new OrganizationEntity instance
 *
 * @example
 * ```typescript
 * const org = createOrganizationEntity({ name: "Acme Corp" });
 * ```
 */
function createOrganizationEntity(options: Partial<OrgEntityOpts> = {}): OrganizationEntity {
	const now = DateTime.utc();
	return new OrganizationEntity({
		id: options.id ?? new TypeID("org"),
		name: options.name ?? "Test Organization",
		description: options.description,
		created: options.created ?? now,
		updated: options.updated ?? now,
	});
}

/**
 * Creates a LedgerEntity with sensible test defaults.
 *
 * @param options - Partial options to override defaults
 * @returns A new LedgerEntity instance
 *
 * @example
 * ```typescript
 * const ledger = createLedgerEntity({ name: "USD Ledger", currency: "USD" });
 * ```
 */
function createLedgerEntity(options: Partial<LedgerEntityOpts> = {}): LedgerEntity {
	const now = new Date();
	return new LedgerEntity({
		id: options.id ?? new TypeID("lgr"),
		organizationId: options.organizationId ?? new TypeID("org"),
		name: options.name ?? "Ledger",
		description: options.description,
		metadata: options.metadata,
		created: options.created ?? now,
		updated: options.updated ?? now,
	});
}

/**
 * Creates a LedgerAccountEntity with sensible test defaults.
 *
 * @param options - Partial options to override defaults
 * @returns A new LedgerAccountEntity instance
 *
 * @example
 * ```typescript
 * const account = createLedgerAccountEntity({ name: "Cash Account", normalBalance: "debit" });
 * ```
 */
function createLedgerAccountEntity(
	options: Partial<LedgerAccountEntityOpts> = {}
): LedgerAccountEntity {
	const now = new Date();
	return new LedgerAccountEntity({
		id: options.id ?? new TypeID("lat"),
		organizationId: options.organizationId ?? new TypeID("org"),
		ledgerId: options.ledgerId ?? new TypeID("lgr"),
		name: options.name ?? "Ledger Account",
		description: options.description,
		normalBalance: options.normalBalance ?? "credit",
		pendingCredits: options.pendingCredits ?? 0,
		pendingDebits: options.pendingDebits ?? 0,
		postedCredits: options.postedCredits ?? 0,
		postedDebits: options.postedDebits ?? 0,
		lockVersion: options.lockVersion ?? 0,
		metadata: options.metadata,
		created: options.created ?? now,
		updated: options.updated ?? now,
	});
}

export { getRepos, createOrganizationEntity, createLedgerEntity, createLedgerAccountEntity };
