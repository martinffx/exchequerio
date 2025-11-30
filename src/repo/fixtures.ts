import { drizzle } from "drizzle-orm/node-postgres";
import { DateTime } from "luxon";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import { Config } from "@/config";
import { LedgerAccountEntity, LedgerEntity, OrganizationEntity } from "@/services/entities";
import type { LedgerAccountEntityOpts } from "@/services/entities/LedgerAccountEntity";
import type { LedgerEntityOpts } from "@/services/entities/LedgerEntity";
import type { OrgEntityOpts } from "@/services/entities/OrganizationEntity";
import { LedgerAccountRepo } from "./LedgerAccountRepo";
import { LedgerRepo } from "./LedgerRepo";
import { LedgerTransactionRepo } from "./LedgerTransactionRepo";
import { OrganizationRepo } from "./OrganizationRepo";
import * as schema from "./schema";
import type { Repos } from "./types";

let repos: Repos | undefined;
function getRepos(): Repos {
	if (repos !== undefined) {
		return repos;
	}

	const config = new Config();
	const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
	const db = drizzle(pool, { schema });

	const organizationRepo = new OrganizationRepo(db);
	const ledgerRepo = new LedgerRepo(db);
	const ledgerAccountRepo = new LedgerAccountRepo(db);
	const ledgerTransactionRepo = new LedgerTransactionRepo(db);

	repos = {
		organizationRepo,
		ledgerRepo,
		ledgerAccountRepo,
		ledgerTransactionRepo,
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
		currency: options.currency ?? "EUR",
		currencyExponent: options.currencyExponent ?? 2,
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
		balanceAmount: options.balanceAmount ?? "0",
		lockVersion: options.lockVersion ?? 0,
		metadata: options.metadata,
		created: options.created ?? now,
		updated: options.updated ?? now,
	});
}

export { getRepos, createOrganizationEntity, createLedgerEntity, createLedgerAccountEntity };
