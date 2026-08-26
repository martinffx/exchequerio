import { and, asc, desc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";

import {
	DatabaseTag,
	type EffectDrizzleDatabase,
	isPostgresUnavailable,
	postgresErrorCode,
} from "@/db";
import { postgresConstraint } from "@/db/errors";
import { LedgerNotFound } from "@/ledgers/LedgerErrors";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { LedgerAccountsTable } from "@/repo/schema";

import {
	AccountHasDependents,
	type AccountInfrastructureError,
	AccountNameConflict,
	AccountPersistenceDecodingFailure,
	AccountPersistenceFailure,
	AccountRepositoryUnavailable,
	AccountVersionConflict,
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

type ErrorContext = Readonly<{
	organizationId: string;
	ledgerId: string;
	accountId?: string;
}>;

class LedgerAccountRepoLive implements LedgerAccountRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}

	listAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
	): Effect.Effect<LedgerAccount[], AccountInfrastructureError> {
		const errorContext = this.errorContext(organizationId, ledgerId);
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
				Effect.mapError(cause => this.mapInfrastructureError(cause, errorContext))
			);
	}

	getAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<LedgerAccount>, AccountInfrastructureError> {
		const errorContext = this.errorContext(organizationId, ledgerId, accountId);
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
				Effect.mapError(cause => this.mapInfrastructureError(cause, errorContext))
			);
	}

	createAccount(
		record: LedgerAccount
	): Effect.Effect<LedgerAccount, LedgerAccountCreateRepositoryError> {
		const errorContext = this.errorContext(record.organizationId, record.ledgerId, record.id);
		return this.db
			.insert(LedgerAccountsTable)
			.values(record.toRow())
			.returning()
			.pipe(
				Effect.flatMap(rows => this.requireDecoded(rows[0], errorContext)),
				Effect.mapError(cause => this.mapCreateError(cause, record))
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
				description: row.description,
				metadata: row.metadata,
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
				Effect.flatMap(rows => this.requireUpdated(rows[0], record)),
				Effect.mapError(cause => this.mapUpdateError(cause, record))
			);
	}

	deleteAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<LedgerAccount>, LedgerAccountDeleteRepositoryError> {
		const errorContext = this.errorContext(organizationId, ledgerId, accountId);
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
				Effect.mapError(cause =>
					postgresErrorCode(cause) === "23503"
						? new AccountHasDependents(
								organizationId.toString(),
								ledgerId.toString(),
								accountId.toString()
							)
						: this.mapInfrastructureError(cause, errorContext)
				)
			);
	}

	private requireDecoded(
		row: Parameters<typeof LedgerAccount.fromRow>[0],
		errorContext: ErrorContext
	): Effect.Effect<LedgerAccount, AccountInfrastructureError> {
		return LedgerAccount.fromRow(row).pipe(
			Effect.flatMap(
				Option.match({
					onNone: () =>
						Effect.fail(
							new AccountPersistenceFailure(
								new Error("Database write returned no Account row"),
								errorContext
							)
						),
					onSome: Effect.succeed,
				})
			)
		);
	}

	private requireUpdated(
		row: Parameters<typeof LedgerAccount.fromRow>[0],
		record: LedgerAccount
	): Effect.Effect<LedgerAccount, AccountInfrastructureError | AccountVersionConflict> {
		return row === undefined
			? Effect.fail(
					new AccountVersionConflict(
						record.organizationId.toString(),
						record.ledgerId.toString(),
						record.id.toString()
					)
				)
			: this.requireDecoded(row, this.errorContext(record.organizationId, record.ledgerId, record.id));
	}

	private errorContext(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId?: LedgerAccountID
	): ErrorContext {
		return {
			organizationId: organizationId.toString(),
			ledgerId: ledgerId.toString(),
			accountId: accountId?.toString(),
		};
	}

	private mapInfrastructureError(
		cause: unknown,
		errorContext: ErrorContext
	): AccountInfrastructureError {
		if (cause instanceof AccountPersistenceDecodingFailure) return cause;
		if (cause instanceof AccountPersistenceFailure) return cause;
		if (cause instanceof AccountRepositoryUnavailable) return cause;
		return isPostgresUnavailable(cause)
			? new AccountRepositoryUnavailable(cause, errorContext)
			: new AccountPersistenceFailure(cause, errorContext);
	}

	private mapCreateError(cause: unknown, record: LedgerAccount): LedgerAccountCreateRepositoryError {
		if (
			cause instanceof AccountPersistenceDecodingFailure ||
			cause instanceof AccountPersistenceFailure ||
			cause instanceof AccountRepositoryUnavailable
		) {
			return cause;
		}
		if (postgresErrorCode(cause) === "23503") {
			return new LedgerNotFound(record.organizationId.toString(), record.ledgerId.toString());
		}
		if (
			postgresErrorCode(cause) === "23505" &&
			postgresConstraint(cause) === "unique_account_name_per_ledger"
		) {
			return new AccountNameConflict(
				record.organizationId.toString(),
				record.ledgerId.toString(),
				record.name
			);
		}
		return this.mapInfrastructureError(
			cause,
			this.errorContext(record.organizationId, record.ledgerId, record.id)
		);
	}

	private mapUpdateError(cause: unknown, record: LedgerAccount): LedgerAccountUpdateRepositoryError {
		if (
			cause instanceof AccountPersistenceDecodingFailure ||
			cause instanceof AccountPersistenceFailure ||
			cause instanceof AccountRepositoryUnavailable ||
			cause instanceof AccountVersionConflict
		) {
			return cause;
		}
		return postgresErrorCode(cause) === "23505" &&
			postgresConstraint(cause) === "unique_account_name_per_ledger"
			? new AccountNameConflict(
					record.organizationId.toString(),
					record.ledgerId.toString(),
					record.name
				)
			: this.mapInfrastructureError(
					cause,
					this.errorContext(record.organizationId, record.ledgerId, record.id)
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
