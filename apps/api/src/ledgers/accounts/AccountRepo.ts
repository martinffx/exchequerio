import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DatabaseTag, type DrizzleDatabase, isPostgresUnavailable, postgresErrorCode } from "@/db";
import { makeCurrency, makeMinorUnits, type NormalBalance } from "@/ledgers/domain/Currency";
import { parseId } from "@/lib/utils";
import { LedgerNotFound } from "@/ledgers/LedgerErrors";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { LedgerAccountsTable } from "@/repo/schema";
import {
	Account,
	type AccountCreate,
	type AccountMetadata,
	type AccountUpdate,
} from "./domain/Account";
import {
	AccountHasDependents,
	type AccountInfrastructureError,
	AccountNameConflict,
	AccountPersistenceDecodingFailure,
	AccountPersistenceFailure,
	AccountRepositoryUnavailable,
	AccountVersionConflict,
} from "./AccountErrors";

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
	list(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
	): Effect.Effect<Account[], AccountInfrastructureError>;
	get(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Effect.Effect<Option.Option<Account>, AccountInfrastructureError>;
	create(record: AccountCreate): Effect.Effect<Account, AccountCreateRepositoryError>;
	update(record: AccountUpdate): Effect.Effect<Account, AccountUpdateRepositoryError>;
	delete(
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

type AccountRow = typeof LedgerAccountsTable.$inferSelect;

const decodeDate = (value: Date): Date => {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
		throw new Error("Invalid Account timestamp");
	}
	return value;
};

const decodeMetadata = (value: string | null): AccountMetadata | undefined => {
	if (value === null) return undefined;
	const decoded: unknown = JSON.parse(value);
	if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
		throw new Error("Account metadata must be an object");
	}
	if (!Object.values(decoded).every(item => typeof item === "string")) {
		throw new Error("Account metadata values must be strings");
	}
	return decoded as Record<string, string>;
};

const decodeAccount = (
	row: AccountRow | undefined
): Effect.Effect<Option.Option<Account>, AccountPersistenceDecodingFailure> => {
	if (row === undefined) return Effect.succeed(Option.none());

	return Effect.gen(function* () {
		const id = yield* parseId<"lat", LedgerAccountID>("lat", row.id);
		const organizationId = yield* parseId<"org", OrgID>("org", row.organizationId);
		const ledgerId = yield* parseId<"lgr", LedgerID>("lgr", row.ledgerId);
		const decoded = yield* Effect.try({
			try: () => ({
				currency: makeCurrency(row.currencyCode, row.minorUnitExponent),
				pendingAmount: makeMinorUnits(row.pendingAmount),
				postedAmount: makeMinorUnits(row.postedAmount),
				availableAmount: makeMinorUnits(row.availableAmount),
				pendingCredits: makeMinorUnits(row.pendingCredits),
				pendingDebits: makeMinorUnits(row.pendingDebits),
				postedCredits: makeMinorUnits(row.postedCredits),
				postedDebits: makeMinorUnits(row.postedDebits),
				availableCredits: makeMinorUnits(row.availableCredits),
				availableDebits: makeMinorUnits(row.availableDebits),
				metadata: decodeMetadata(row.metadata),
				created: decodeDate(row.created),
				updated: decodeDate(row.updated),
			}),
			catch: cause => cause,
		});
		if (!Number.isSafeInteger(row.lockVersion) || row.lockVersion < 0) {
			return yield* Effect.fail(new Error("Invalid Account lock version"));
		}
		return Option.some(
			// eslint-disable-next-line unicorn/no-array-callback-reference -- Option.some receives a value.
			new Account({
				id,
				organizationId,
				ledgerId,
				name: row.name,
				description: row.description ?? undefined,
				normalBalance: row.normalBalance as NormalBalance,
				currency: decoded.currency,
				pendingAmount: decoded.pendingAmount,
				postedAmount: decoded.postedAmount,
				availableAmount: decoded.availableAmount,
				pendingCredits: decoded.pendingCredits,
				pendingDebits: decoded.pendingDebits,
				postedCredits: decoded.postedCredits,
				postedDebits: decoded.postedDebits,
				availableCredits: decoded.availableCredits,
				availableDebits: decoded.availableDebits,
				lockVersion: row.lockVersion,
				metadata: decoded.metadata,
				created: decoded.created,
				updated: decoded.updated,
			})
		);
	}).pipe(Effect.mapError(cause => new AccountPersistenceDecodingFailure(cause)));
};

const context = (organizationId: OrgID, ledgerId: LedgerID, accountId?: LedgerAccountID) => ({
	organizationId: organizationId.toString(),
	ledgerId: ledgerId.toString(),
	...(accountId === undefined ? {} : { accountId: accountId.toString() }),
});

const mapInfrastructureError = (
	cause: unknown,
	errorContext: ReturnType<typeof context>
): AccountInfrastructureError =>
	isPostgresUnavailable(cause)
		? new AccountRepositoryUnavailable(cause, errorContext)
		: new AccountPersistenceFailure(cause, errorContext);

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
	typeof value === "object" && value !== null;

const postgresConstraint = (cause: unknown, seen = new Set<object>()): string | undefined => {
	if (!isRecord(cause) || seen.has(cause)) return undefined;
	seen.add(cause);
	if (typeof cause.constraint === "string") return cause.constraint;
	const nested = postgresConstraint(cause.cause, seen);
	if (nested !== undefined) return nested;
	if (!Array.isArray(cause.errors)) return undefined;
	for (const error of cause.errors) {
		const constraint = postgresConstraint(error, seen);
		if (constraint !== undefined) return constraint;
	}
	return undefined;
};

const mapCreateError = (cause: unknown, record: AccountCreate): AccountCreateRepositoryError => {
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

const mapUpdateError = (cause: unknown, record: AccountUpdate): AccountUpdateRepositoryError =>
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
	decodeAccount(row).pipe(
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
	record: AccountUpdate
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

	list(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: AccountListQuery
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
					.limit(query.limit)
					.offset(query.offset),
			catch: cause => mapInfrastructureError(cause, context(organizationId, ledgerId)),
		}).pipe(
			Effect.flatMap(rows => Effect.all(rows.map(row => decodeAccount(row)))),
			Effect.map(accounts => accounts.flatMap(account => Option.toArray(account)))
		);
	}

	get(
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
		}).pipe(Effect.flatMap(rows => decodeAccount(rows[0])));
	}

	create(record: AccountCreate): Effect.Effect<Account, AccountCreateRepositoryError> {
		const errorContext = context(record.organizationId, record.ledgerId, record.id);
		return Effect.tryPromise({
			try: () =>
				this.db
					.insert(LedgerAccountsTable)
					.values({
						id: record.id.toString(),
						organizationId: record.organizationId.toString(),
						ledgerId: record.ledgerId.toString(),
						name: record.name,
						description: record.description,
						normalBalance: record.normalBalance,
						currencyCode: record.currency.code,
						minorUnitExponent: record.currency.minorUnitExponent,
						metadata: record.metadata === undefined ? undefined : JSON.stringify(record.metadata),
						lockVersion: 1,
					})
					.returning(publicColumns),
			catch: cause => mapCreateError(cause, record),
		}).pipe(Effect.flatMap(rows => requireDecoded(rows[0], errorContext)));
	}

	update(record: AccountUpdate): Effect.Effect<Account, AccountUpdateRepositoryError> {
		return Effect.tryPromise({
			try: () =>
				this.db
					.update(LedgerAccountsTable)
					.set({
						name: record.name,
						// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
						description: record.description ?? null,
						// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
						metadata: record.metadata === undefined ? null : JSON.stringify(record.metadata),
						lockVersion: sql`${LedgerAccountsTable.lockVersion} + 1`,
						updated: sql`CURRENT_TIMESTAMP`,
					})
					.where(
						and(
							eq(LedgerAccountsTable.organizationId, record.organizationId.toString()),
							eq(LedgerAccountsTable.ledgerId, record.ledgerId.toString()),
							eq(LedgerAccountsTable.id, record.id.toString()),
							eq(LedgerAccountsTable.lockVersion, record.expectedLockVersion)
						)
					)
					.returning(publicColumns),
			catch: cause => mapUpdateError(cause, record),
		}).pipe(Effect.flatMap(rows => requireUpdated(rows[0], record)));
	}

	delete(
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
		}).pipe(Effect.flatMap(rows => decodeAccount(rows[0])));
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
