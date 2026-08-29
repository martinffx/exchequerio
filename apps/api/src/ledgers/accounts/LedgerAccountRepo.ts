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

interface LedgerAccountRepo {
	listAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
	): Effect.Effect<LedgerAccount[], AccountInfrastructureError>;
	getAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<LedgerAccount>, AccountInfrastructureError>;
	createAccount(
		record: LedgerAccount
	): Effect.Effect<LedgerAccount, LedgerAccountCreateRepositoryError>;
	updateAccount(
		record: LedgerAccount
	): Effect.Effect<LedgerAccount, LedgerAccountUpdateRepositoryError>;
	deleteAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<LedgerAccount>, LedgerAccountDeleteRepositoryError>;
}

const LedgerAccountRepoTag = Context.Service<LedgerAccountRepo>("LedgerAccountRepo");

class LedgerAccountRepoLive implements LedgerAccountRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}

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
