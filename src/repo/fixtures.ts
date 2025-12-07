import { drizzle } from "drizzle-orm/node-postgres";
import { DateTime } from "luxon";
import { Pool } from "pg";
import { TypeID } from "typeid-js";
import { Config } from "@/config";
import {
	LedgerAccountEntity,
	LedgerEntity,
	LedgerTransactionEntity,
	LedgerTransactionEntryEntity,
	OrganizationEntity,
} from "@/repo/entities";
import type { LedgerAccountBalanceMonitorEntityOpts } from "@/repo/entities/LedgerAccountBalanceMonitorEntity";
import { LedgerAccountBalanceMonitorEntity } from "@/repo/entities/LedgerAccountBalanceMonitorEntity";
import type { LedgerAccountEntityOpts } from "@/repo/entities/LedgerAccountEntity";
import type { LedgerAccountStatementEntityOpts } from "@/repo/entities/LedgerAccountStatementEntity";
import { LedgerAccountStatementEntity } from "@/repo/entities/LedgerAccountStatementEntity";
import type { LedgerEntityOpts } from "@/repo/entities/LedgerEntity";
import type { LedgerTransactionEntityOpts } from "@/repo/entities/LedgerTransactionEntity";
import type { LedgerTransactionEntryEntityOpts } from "@/repo/entities/LedgerTransactionEntryEntity";
import type { OrgEntityOpts } from "@/repo/entities/OrganizationEntity";
import { LedgerAccountBalanceMonitorRepo } from "./LedgerAccountBalanceMonitorRepo";
import { LedgerAccountCategoryRepo } from "./LedgerAccountCategoryRepo";
import { LedgerAccountRepo } from "./LedgerAccountRepo";
import { LedgerAccountSettlementRepo } from "./LedgerAccountSettlementRepo";
import { LedgerAccountStatementRepo } from "./LedgerAccountStatementRepo";
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
	const ledgerAccountCategoryRepo = new LedgerAccountCategoryRepo(db);
	const ledgerAccountSettlementRepo = new LedgerAccountSettlementRepo(db);
	const ledgerAccountStatementRepo = new LedgerAccountStatementRepo(db);
	const ledgerAccountBalanceMonitorRepo = new LedgerAccountBalanceMonitorRepo(db);
	const ledgerTransactionRepo = new LedgerTransactionRepo(db);

	repos = {
		organizationRepo,
		ledgerRepo,
		ledgerAccountRepo,
		ledgerAccountCategoryRepo,
		ledgerAccountSettlementRepo,
		ledgerAccountStatementRepo,
		ledgerAccountBalanceMonitorRepo,
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
		// Individual balance fields (integer minor units)
		pendingAmount: options.pendingAmount ?? 0,
		postedAmount: options.postedAmount ?? 0,
		availableAmount: options.availableAmount ?? 0,
		pendingCredits: options.pendingCredits ?? 0,
		pendingDebits: options.pendingDebits ?? 0,
		postedCredits: options.postedCredits ?? 0,
		postedDebits: options.postedDebits ?? 0,
		availableCredits: options.availableCredits ?? 0,
		availableDebits: options.availableDebits ?? 0,
		lockVersion: options.lockVersion ?? 0,
		metadata: options.metadata,
		created: options.created ?? now,
		updated: options.updated ?? now,
	});
}

/**
 * Creates a LedgerTransactionEntryEntity with sensible test defaults.
 *
 * @param options - Partial options to override defaults
 * @returns A new LedgerTransactionEntryEntity instance
 *
 * @example
 * ```typescript
 * const entry = createLedgerTransactionEntryEntity({
 *   transactionId: txId,
 *   accountId: accountId,
 *   direction: "debit",
 *   amount: 10000
 * });
 * ```
 */
function createLedgerTransactionEntryEntity(
	options: Partial<LedgerTransactionEntryEntityOpts> & {
		transactionId: TypeID<"ltr">;
		accountId: TypeID<"lat">;
		direction: "debit" | "credit";
		amount: number;
	}
): LedgerTransactionEntryEntity {
	const now = new Date();
	return new LedgerTransactionEntryEntity({
		id: options.id ?? new TypeID("lte"),
		organizationId: options.organizationId ?? new TypeID("org"),
		transactionId: options.transactionId,
		accountId: options.accountId,
		direction: options.direction,
		amount: options.amount,
		currency: options.currency ?? "USD",
		currencyExponent: options.currencyExponent ?? 2,
		status: options.status ?? "pending",
		metadata: options.metadata,
		created: options.created ?? now,
		updated: options.updated ?? now,
	});
}

/**
 * Creates a LedgerTransactionEntity with sensible test defaults.
 *
 * @param options - Partial options to override defaults
 * @returns A new LedgerTransactionEntity instance
 *
 * @example
 * ```typescript
 * const transaction = createLedgerTransactionEntity({
 *   organizationId: orgId,
 *   ledgerId: ledgerId,
 *   entries: [debitEntry, creditEntry]
 * });
 * ```
 */
function createLedgerTransactionEntity(
	options: Partial<LedgerTransactionEntityOpts> & {
		entries: LedgerTransactionEntityOpts["entries"];
	}
): LedgerTransactionEntity {
	const now = new Date();
	return new LedgerTransactionEntity({
		id: options.id ?? new TypeID("ltr"),
		organizationId: options.organizationId ?? new TypeID("org"),
		ledgerId: options.ledgerId ?? new TypeID("lgr"),
		entries: options.entries,
		idempotencyKey: options.idempotencyKey,
		description: options.description ?? "Test transaction",
		status: options.status ?? "pending",
		effectiveAt: options.effectiveAt ?? now,
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
	createLedgerTransactionEntryEntity,
	createLedgerTransactionEntity,
	createLedgerAccountBalanceMonitorEntity,
	createLedgerAccountStatementEntity,
};
