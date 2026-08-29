import { and, asc, desc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";

import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import { LedgerNotFound } from "@/ledgers/LedgerErrors";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { LedgerAccountsTable } from "@/repo/schema";

import {
	AccountHasDependents,
	type AccountInfrastructureError,
	AccountNameConflict,
	AccountVersionConflict,
	mapAccountCreateError,
	mapAccountDeleteError,
	mapAccountInfrastructureError,
	mapAccountUpdateError,
	requireCreatedAccount,
	requireUpdatedAccount,
} from "./AccountErrors";
import type { AccountListQuery } from "./AccountSchema";
import { LedgerAccount } from "./domain/LedgerAccount";

type LedgerAccountCreateRepositoryError =
	| AccountInfrastructureError
	| LedgerNotFound
	| AccountNameConflict;
type LedgerAccountUpdateRepositoryError =
	| AccountInfrastructureError
	| AccountNameConflict
	| AccountVersionConflict;
type LedgerAccountDeleteRepositoryError = AccountInfrastructureError | AccountHasDependents;

/**
 * Persists Accounts and their stored Balance projections within a Ledger.
 *
 * Expected failures are returned through each operation's Effect error channel.
 */
interface LedgerAccountRepo {
	/**
	 * Lists Accounts for one Organization and Ledger.
	 *
	 * @param organizationId - Organization that owns the Accounts.
	 * @param ledgerId - Ledger that contains the Accounts.
	 * @param query - Pagination parameters for the result set.
	 * @returns An Effect containing the requested page of Accounts.
	 */
	listAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
	): Effect.Effect<LedgerAccount[], AccountInfrastructureError>;
	/**
	 * Finds an Account within one Organization and Ledger.
	 *
	 * @param organizationId - Organization that owns the Account.
	 * @param ledgerId - Ledger that contains the Account.
	 * @param accountId - Account to find.
	 * @returns An Effect containing the Account when found, or `Option.none()` otherwise.
	 */
	getAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<LedgerAccount>, AccountInfrastructureError>;
	/**
	 * Creates an Account from a validated domain record.
	 *
	 * @param record - Account to persist, including its initial Balance projections.
	 * @returns An Effect containing the created Account.
	 */
	createAccount(
		record: LedgerAccount
	): Effect.Effect<LedgerAccount, LedgerAccountCreateRepositoryError>;
	/**
	 * Updates an Account using optimistic concurrency control.
	 *
	 * @param record - Account state and lock version to persist.
	 * @returns An Effect containing the updated Account.
	 */
	updateAccount(
		record: LedgerAccount
	): Effect.Effect<LedgerAccount, LedgerAccountUpdateRepositoryError>;
	/**
	 * Deletes an Account within one Organization and Ledger.
	 *
	 * @param organizationId - Organization that owns the Account.
	 * @param ledgerId - Ledger that contains the Account.
	 * @param accountId - Account to delete.
	 * @returns An Effect containing the deleted Account, or `Option.none()` when absent.
	 */
	deleteAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<LedgerAccount>, LedgerAccountDeleteRepositoryError>;
}

const LedgerAccountRepoTag = Context.Service<LedgerAccountRepo>("LedgerAccountRepo");

/** PostgreSQL implementation of the Account repository contract. */
class LedgerAccountRepoLive implements LedgerAccountRepo {
	/**
	 * Creates an Account repository backed by an Effect-enabled Drizzle database.
	 *
	 * @param db - Database used for all Account reads and writes.
	 */
	constructor(private readonly db: EffectDrizzleDatabase) {}

	/**
	 * Lists tenant-scoped Accounts by creation time with a stable identifier tie-breaker.
	 *
	 * @param organizationId - Organization that owns the Accounts.
	 * @param ledgerId - Ledger that contains the Accounts.
	 * @param query - Offset and limit for the result page.
	 * @returns An Effect containing decoded Accounts in stable order.
	 */
	listAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
	): Effect.Effect<LedgerAccount[], AccountInfrastructureError> {
		return this.db
			.select()
			.from(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			)
			.orderBy(desc(LedgerAccountsTable.created), asc(LedgerAccountsTable.id))
			.limit(query.limit)
			.offset(query.offset)
			.pipe(
				Effect.flatMap(rows => Effect.all(rows.map(row => LedgerAccount.fromRow(row)))),
				Effect.map(accounts => accounts.flatMap(account => Option.toArray(account))),
				Effect.mapError(mapAccountInfrastructureError)
			);
	}

	/**
	 * Reads one Account scoped to its Organization and Ledger.
	 *
	 * @param organizationId - Organization that owns the Account.
	 * @param ledgerId - Ledger that contains the Account.
	 * @param accountId - Account to read.
	 * @returns An Effect containing the decoded Account, or `Option.none()` when absent.
	 */
	getAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<LedgerAccount>, AccountInfrastructureError> {
		return this.db
			.select()
			.from(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					eq(LedgerAccountsTable.id, accountId.toString())
				)
			)
			.limit(1)
			.pipe(
				Effect.flatMap(rows => LedgerAccount.fromRow(rows[0])),
				Effect.mapError(mapAccountInfrastructureError)
			);
	}

	/**
	 * Inserts an Account with every stored Balance projection supplied by the domain record.
	 *
	 * @param record - Account to insert.
	 * @returns An Effect containing the inserted Account.
	 */
	createAccount(
		record: LedgerAccount
	): Effect.Effect<LedgerAccount, LedgerAccountCreateRepositoryError> {
		return this.db
			.insert(LedgerAccountsTable)
			.values(record.toRow())
			.returning()
			.pipe(
				Effect.flatMap(rows => LedgerAccount.fromRow(rows[0])),
				Effect.flatMap(requireCreatedAccount),
				Effect.mapError(cause => mapAccountCreateError(cause, record.name))
			);
	}

	/**
	 * Updates mutable Account fields when the stored lock version matches the record.
	 *
	 * The write increments the lock version. A missing row, tenant mismatch, or stale version returns
	 * an Account version conflict through the Effect error channel.
	 *
	 * @param record - Account state and current lock version to persist.
	 * @returns An Effect containing the updated Account with its incremented lock version.
	 */
	updateAccount(
		record: LedgerAccount
	): Effect.Effect<LedgerAccount, LedgerAccountUpdateRepositoryError> {
		const row = record.toRow();
		return this.db
			.update(LedgerAccountsTable)
			.set({
				name: row.name,
				// oxlint-disable-next-line unicorn/no-null -- Drizzle requires null to clear a SQL column.
				description: row.description ?? null,
				// oxlint-disable-next-line unicorn/no-null -- Drizzle requires null to clear a SQL column.
				metadata: row.metadata ?? null,
				updated: row.updated,
				lockVersion: record.lockVersion + 1,
			})
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, record.organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, record.ledgerId.toString()),
					eq(LedgerAccountsTable.id, record.id.toString()),
					eq(LedgerAccountsTable.lockVersion, record.lockVersion)
				)
			)
			.returning()
			.pipe(
				Effect.flatMap(rows => LedgerAccount.fromRow(rows[0])),
				Effect.flatMap(requireUpdatedAccount),
				Effect.mapError(cause => mapAccountUpdateError(cause, record.name))
			);
	}

	/**
	 * Deletes a tenant-scoped Account and rejects Accounts with dependent records.
	 *
	 * @param organizationId - Organization that owns the Account.
	 * @param ledgerId - Ledger that contains the Account.
	 * @param accountId - Account to delete.
	 * @returns An Effect containing the deleted Account, or `Option.none()` when no row matches.
	 */
	deleteAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<LedgerAccount>, LedgerAccountDeleteRepositoryError> {
		return this.db
			.delete(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					eq(LedgerAccountsTable.id, accountId.toString())
				)
			)
			.returning()
			.pipe(
				Effect.flatMap(rows => LedgerAccount.fromRow(rows[0])),
				Effect.mapError(mapAccountDeleteError)
			);
	}
}

const ledgerAccountRepoLayer = Layer.effect(
	LedgerAccountRepoTag,
	DatabaseTag.pipe(Effect.map(database => new LedgerAccountRepoLive(database.effectDb)))
);

export type {
	LedgerAccountCreateRepositoryError,
	LedgerAccountDeleteRepositoryError,
	LedgerAccountRepo,
	LedgerAccountUpdateRepositoryError,
};
export { LedgerAccountRepoLive, LedgerAccountRepoTag, ledgerAccountRepoLayer };
