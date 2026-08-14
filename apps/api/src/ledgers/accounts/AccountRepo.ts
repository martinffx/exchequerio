import { and, asc, desc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type DrizzleDatabase, isPostgresUnavailable, postgresErrorCode } from "@/db";
import { LedgerNotFound } from "@/ledgers/LedgerErrors";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { type AccountRow, LedgerAccountsTable } from "@/repo/schema";
import { Account } from "./domain/Account";
import {
	AccountHasDependents,
	type AccountInfrastructureError,
	AccountNameConflict,
	AccountPersistenceFailure,
	AccountRepositoryUnavailable,
	AccountVersionConflict,
} from "./AccountErrors";
import { postgresConstraint } from "@/db/errors";

type AccountListQuery = {
	readonly offset: number;
	readonly limit: number;
};

type AccountCreateRepositoryError =
	| AccountInfrastructureError
	| LedgerNotFound
	| AccountNameConflict;
type AccountUpdateRepositoryError =
	| AccountInfrastructureError
	| AccountNameConflict
	| AccountVersionConflict;
type AccountDeleteRepositoryError = AccountInfrastructureError | AccountHasDependents;

interface AccountRepo {
	listAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
	): Effect.Effect<Account[], AccountInfrastructureError>;
	getAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<Account>, AccountInfrastructureError>;
	createAccount(record: Account): Effect.Effect<Account, AccountCreateRepositoryError>;
	updateAccount(record: Account): Effect.Effect<Account, AccountUpdateRepositoryError>;
	deleteAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<Account>, AccountDeleteRepositoryError>;
}

const AccountRepoTag = Context.Service<AccountRepo>("AccountRepo");

const publicColumns = {
	id: LedgerAccountsTable.id,
	organizationId: LedgerAccountsTable.organizationId,
	ledgerId: LedgerAccountsTable.ledgerId,
	name: LedgerAccountsTable.name,
	description: LedgerAccountsTable.description,
	normalBalance: LedgerAccountsTable.normalBalance,
	currencyCode: LedgerAccountsTable.currencyCode,
	minorUnitExponent: LedgerAccountsTable.minorUnitExponent,
	pendingAmount: LedgerAccountsTable.pendingAmount,
	postedAmount: LedgerAccountsTable.postedAmount,
	availableAmount: LedgerAccountsTable.availableAmount,
	pendingCredits: LedgerAccountsTable.pendingCredits,
	pendingDebits: LedgerAccountsTable.pendingDebits,
	postedCredits: LedgerAccountsTable.postedCredits,
	postedDebits: LedgerAccountsTable.postedDebits,
	availableCredits: LedgerAccountsTable.availableCredits,
	availableDebits: LedgerAccountsTable.availableDebits,
	lockVersion: LedgerAccountsTable.lockVersion,
	metadata: LedgerAccountsTable.metadata,
	created: LedgerAccountsTable.created,
	updated: LedgerAccountsTable.updated,
};

const context = (organizationId: OrgID, ledgerId: LedgerID, accountId?: LedgerAccountID) => ({
	organizationId: organizationId.toString(),
	ledgerId: ledgerId.toString(),
	accountId: accountId?.toString() ?? undefined,
});

const mapInfrastructureError = (
	cause: unknown,
	errorContext: ReturnType<typeof context>
): AccountInfrastructureError =>
	isPostgresUnavailable(cause)
		? new AccountRepositoryUnavailable(cause, errorContext)
		: new AccountPersistenceFailure(cause, errorContext);

const mapCreateError = (cause: unknown, record: Account): AccountCreateRepositoryError => {
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
	return mapInfrastructureError(cause, context(record.organizationId, record.ledgerId, record.id));
};

const mapUpdateError = (cause: unknown, record: Account): AccountUpdateRepositoryError =>
	postgresErrorCode(cause) === "23505" &&
	postgresConstraint(cause) === "unique_account_name_per_ledger"
		? new AccountNameConflict(
				record.organizationId.toString(),
				record.ledgerId.toString(),
				record.name
			)
		: mapInfrastructureError(cause, context(record.organizationId, record.ledgerId, record.id));

const requireDecoded = (
	row: AccountRow | undefined,
	errorContext: ReturnType<typeof context>
): Effect.Effect<Account, AccountInfrastructureError> =>
	Account.fromRow(row).pipe(
		Effect.flatMap(
			Option.match({
				onNone: () =>
					Effect.fail(
						new AccountPersistenceFailure(
							new Error("Database write returned no Account row"),
							errorContext
						)
					),
				onSome: value => Effect.succeed(value),
			})
		)
	);

const requireUpdated = (
	row: AccountRow | undefined,
	record: Account
): Effect.Effect<Account, AccountInfrastructureError | AccountVersionConflict> =>
	row === undefined
		? Effect.fail(
				new AccountVersionConflict(
					record.organizationId.toString(),
					record.ledgerId.toString(),
					record.id.toString()
				)
			)
		: requireDecoded(row, context(record.organizationId, record.ledgerId, record.id));

class AccountRepoLive implements AccountRepo {
	constructor(private readonly db: DrizzleDatabase) {}

	listAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		{ offset, limit }: AccountListQuery
	): Effect.Effect<Account[], AccountInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(publicColumns)
					.from(LedgerAccountsTable)
					.where(
						and(
							eq(LedgerAccountsTable.organizationId, organizationId.toString()),
							eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
						)
					)
					.orderBy(desc(LedgerAccountsTable.created), asc(LedgerAccountsTable.id))
					.limit(limit)
					.offset(offset),
			catch: cause => mapInfrastructureError(cause, context(organizationId, ledgerId)),
		}).pipe(
			Effect.flatMap(rows => Effect.all(rows.map(row => Account.fromRow(row)))),
			Effect.map(accounts => accounts.flatMap(account => Option.toArray(account)))
		);
	}

	getAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<Account>, AccountInfrastructureError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(publicColumns)
					.from(LedgerAccountsTable)
					.where(
						and(
							eq(LedgerAccountsTable.organizationId, organizationId.toString()),
							eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
							eq(LedgerAccountsTable.id, accountId.toString())
						)
					)
					.limit(1),
			catch: cause => mapInfrastructureError(cause, context(organizationId, ledgerId, accountId)),
		}).pipe(Effect.flatMap(rows => Account.fromRow(rows[0])));
	}

	createAccount(record: Account): Effect.Effect<Account, AccountCreateRepositoryError> {
		const errorContext = context(record.organizationId, record.ledgerId, record.id);
		return Effect.tryPromise({
			try: () => {
				const row = record.toRow();
				return this.db
					.insert(LedgerAccountsTable)
					.values({
						id: row.id,
						organizationId: row.organizationId,
						ledgerId: row.ledgerId,
						name: row.name,
						description: row.description,
						normalBalance: row.normalBalance,
						currencyCode: row.currencyCode,
						minorUnitExponent: row.minorUnitExponent,
						metadata: row.metadata,
						lockVersion: row.lockVersion,
					})
					.returning(publicColumns);
			},
			catch: cause => mapCreateError(cause, record),
		}).pipe(Effect.flatMap(rows => requireDecoded(rows[0], errorContext)));
	}

	updateAccount(record: Account): Effect.Effect<Account, AccountUpdateRepositoryError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.update(LedgerAccountsTable)
					.set({ ...record.toRow(), lockVersion: record.lockVersion + 1 })
					.where(
						and(
							eq(LedgerAccountsTable.organizationId, record.organizationId.toString()),
							eq(LedgerAccountsTable.ledgerId, record.ledgerId.toString()),
							eq(LedgerAccountsTable.id, record.id.toString()),
							eq(LedgerAccountsTable.lockVersion, record.lockVersion)
						)
					)
					.returning(publicColumns),
			catch: cause => mapUpdateError(cause, record),
		}).pipe(Effect.flatMap(rows => requireUpdated(rows[0], record)));
	}

	deleteAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<Account>, AccountDeleteRepositoryError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.delete(LedgerAccountsTable)
					.where(
						and(
							eq(LedgerAccountsTable.organizationId, organizationId.toString()),
							eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
							eq(LedgerAccountsTable.id, accountId.toString())
						)
					)
					.returning(publicColumns),
			catch: cause =>
				postgresErrorCode(cause) === "23503"
					? new AccountHasDependents(
							organizationId.toString(),
							ledgerId.toString(),
							accountId.toString()
						)
					: mapInfrastructureError(cause, context(organizationId, ledgerId, accountId)),
		}).pipe(Effect.flatMap(rows => Account.fromRow(rows[0])));
	}
}

const accountRepoLayer = Layer.effect(
	AccountRepoTag,
	DatabaseTag.pipe(Effect.map(database => new AccountRepoLive(database.db)))
);

export type {
	AccountCreateRepositoryError,
	AccountDeleteRepositoryError,
	AccountListQuery,
	AccountRepo,
	AccountUpdateRepositoryError,
};
export { AccountRepoLive, AccountRepoTag, accountRepoLayer };
