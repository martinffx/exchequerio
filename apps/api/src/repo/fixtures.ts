import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { DateTime } from "luxon";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import { Config } from "@/config";
import { LedgerAccountEntity, LedgerEntity, OrganizationEntity } from "@/repo/entities";
import type { LedgerAccountBalanceMonitorEntityOpts } from "@/repo/entities/LedgerAccountBalanceMonitorEntity";
import { LedgerAccountBalanceMonitorEntity } from "@/repo/entities/LedgerAccountBalanceMonitorEntity";
import type { LedgerAccountEntityOpts } from "@/repo/entities/LedgerAccountEntity";
import type { LedgerAccountStatementEntityOpts } from "@/repo/entities/LedgerAccountStatementEntity";
import { LedgerAccountStatementEntity } from "@/repo/entities/LedgerAccountStatementEntity";
import type { LedgerEntityOpts } from "@/repo/entities/LedgerEntity";
import type { OrgEntityOpts } from "@/repo/entities/OrganizationEntity";
import type { LedgerID } from "@/repo/entities/types";
import { LedgerAccountBalanceMonitorRepo } from "./LedgerAccountBalanceMonitorRepo";
import { LedgerAccountCategoryRepo } from "./LedgerAccountCategoryRepo";
import { LedgerAccountRepo } from "./LedgerAccountRepo";
import { LedgerAccountSettlementRepo } from "./LedgerAccountSettlementRepo";
import { LedgerAccountStatementRepo } from "./LedgerAccountStatementRepo";
import { LedgerRepo } from "./LedgerRepo";
import * as schema from "./schema";
import type { DrizzleDB, Repos } from "./types";

interface OrganizationFixtureRepo {
	createOrganization(record: OrganizationEntity): Promise<OrganizationEntity>;
	deleteOrganization(id: TypeID<"org">): Promise<void>;
}

type TestRepos = Repos & {
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
	const ledgerAccountCategoryRepo = new LedgerAccountCategoryRepo(db);
	const ledgerAccountSettlementRepo = new LedgerAccountSettlementRepo(db);
	const ledgerAccountStatementRepo = new LedgerAccountStatementRepo(db);
	const ledgerAccountBalanceMonitorRepo = new LedgerAccountBalanceMonitorRepo(db);

	repos = {
		db,
		organizationRepo,
		ledgerRepo,
		ledgerAccountRepo,
		ledgerAccountCategoryRepo,
		ledgerAccountSettlementRepo,
		ledgerAccountStatementRepo,
		ledgerAccountBalanceMonitorRepo,
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

/**
 * Creates a LedgerAccountBalanceMonitorEntity with sensible test defaults.
 *
 * @param options - Partial options to override defaults
 * @returns A new LedgerAccountBalanceMonitorEntity instance
 *
 * @example
 * ```typescript
 * const monitor = createLedgerAccountBalanceMonitorEntity({
 *   accountId: accountId,
 *   name: "Low Balance Alert",
 *   alertThreshold: 1000
 * });
 * ```
 */
function createLedgerAccountBalanceMonitorEntity(
	options: Partial<LedgerAccountBalanceMonitorEntityOpts> = {}
): LedgerAccountBalanceMonitorEntity {
	const now = new Date();
	return new LedgerAccountBalanceMonitorEntity({
		id: options.id ?? new TypeID("lbm"),
		accountId: options.accountId ?? new TypeID("lat"),
		name: options.name ?? "Test Balance Monitor",
		description: options.description,
		alertThreshold: options.alertThreshold ?? 0,
		isActive: options.isActive ?? true,
		metadata: options.metadata,
		created: options.created ?? now,
		updated: options.updated ?? now,
	});
}

/**
 * Creates a LedgerAccountStatementEntity with sensible test defaults.
 *
 * @param options - Partial options to override defaults
 * @returns A new LedgerAccountStatementEntity instance
 *
 * @example
 * ```typescript
 * const statement = createLedgerAccountStatementEntity({
 *   accountId: accountId,
 *   statementDate: new Date('2024-01-01'),
 *   closingBalance: 50000
 * });
 * ```
 */
function createLedgerAccountStatementEntity(
	options: Partial<LedgerAccountStatementEntityOpts> = {}
): LedgerAccountStatementEntity {
	const now = new Date();
	return new LedgerAccountStatementEntity({
		id: options.id ?? new TypeID("lst"),
		ledgerId: options.ledgerId ?? (new TypeID("lgr") as LedgerID),
		accountId: options.accountId ?? new TypeID("lat"),
		statementDate: options.statementDate ?? now,
		openingBalance: options.openingBalance ?? 0,
		closingBalance: options.closingBalance ?? 0,
		totalCredits: options.totalCredits ?? 0,
		totalDebits: options.totalDebits ?? 0,
		transactionCount: options.transactionCount ?? 0,
		metadata: options.metadata,
		created: options.created ?? now,
		updated: options.updated ?? now,
	});
}

export {
	getRepos,
	createOrganizationEntity,
	createLedgerEntity,
	createLedgerAccountEntity,
	createLedgerAccountBalanceMonitorEntity,
	createLedgerAccountStatementEntity,
};
