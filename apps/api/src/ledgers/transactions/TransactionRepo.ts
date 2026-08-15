import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";

import { DatabaseTag, type DrizzleDatabase, isPostgresUnavailable, postgresErrorCode } from "@/db";
import { postgresConstraint } from "@/db/errors";
import {
	AccountNotFound,
	AccountVersionConflict,
	currencyEquals,
	makeCurrency,
} from "@/ledgers/accounts";
import { parseId } from "@/lib/utils";
import type {
	LedgerAccountID,
	LedgerID,
	LedgerTransactionEntryID,
	LedgerTransactionID,
	OrgID,
} from "@/repo/entities/types";
import {
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "@/repo/schema";

import {
	Entry,
	Transaction,
	type AccountCounterDelta,
	type TransactionMutation,
} from "./domain/Transaction";
import {
	TransactionConcurrencyFailure,
	type TransactionInfrastructureError,
	TransactionLifecycleConflict,
	TransactionNotFound,
	TransactionPersistenceDecodingFailure,
	TransactionPersistenceFailure,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
} from "./TransactionErrors";

type TransactionListQuery = {
	readonly offset: number;
	readonly limit: number;
};

type TransactionCreateRepositoryError =
	| AccountNotFound
	| AccountVersionConflict
	| TransactionConcurrencyFailure
	| TransactionInfrastructureError
	| TransactionValidationFailure;

type TransactionReplaceRepositoryError =
	| AccountNotFound
	| AccountVersionConflict
	| TransactionConcurrencyFailure
	| TransactionInfrastructureError
	| TransactionLifecycleConflict
	| TransactionNotFound
	| TransactionValidationFailure;

interface TransactionRepo {
	createTransaction(
		idempotencyKey: string,
		mutation: TransactionMutation
	): Effect.Effect<Transaction, TransactionCreateRepositoryError>;
	replaceTransaction(
		mutation: TransactionMutation
	): Effect.Effect<Transaction, TransactionReplaceRepositoryError>;
	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<Transaction[], TransactionInfrastructureError>;
	getTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Option.Option<Transaction>, TransactionInfrastructureError>;
	getTransactionByIdempotencyKey(
		organizationId: OrgID,
		idempotencyKey: string
	): Effect.Effect<Option.Option<Transaction>, TransactionInfrastructureError>;
}

const TransactionRepoTag = Context.Service<TransactionRepo>("TransactionRepo");

const transactionColumns = {
	id: LedgerTransactionsTable.id,
	organizationId: LedgerTransactionsTable.organizationId,
	ledgerId: LedgerTransactionsTable.ledgerId,
	status: LedgerTransactionsTable.status,
	description: LedgerTransactionsTable.description,
	metadata: LedgerTransactionsTable.metadata,
	postedAt: LedgerTransactionsTable.postedAt,
	created: LedgerTransactionsTable.created,
	updated: LedgerTransactionsTable.updated,
};

const entryColumns = {
	id: LedgerTransactionEntriesTable.id,
	transactionId: LedgerTransactionEntriesTable.transactionId,
	accountId: LedgerTransactionEntriesTable.accountId,
	direction: LedgerTransactionEntriesTable.direction,
	amount: LedgerTransactionEntriesTable.amount,
	metadata: LedgerTransactionEntriesTable.metadata,
	currencyCode: LedgerAccountsTable.currencyCode,
	minorUnitExponent: LedgerAccountsTable.minorUnitExponent,
};

type TransactionRow = typeof LedgerTransactionsTable.$inferSelect;
type PublicTransactionRow = Pick<TransactionRow, keyof typeof transactionColumns>;
type EntryRow = {
	readonly id: string;
	readonly transactionId: string;
	readonly accountId: string;
	readonly direction: "debit" | "credit";
	readonly amount: number;
	readonly metadata: string | null;
	readonly currencyCode: string;
	readonly minorUnitExponent: number;
};

type ErrorContext = {
	readonly organizationId?: string;
	readonly ledgerId?: string;
	readonly transactionId?: string;
};

const context = (
	organizationId: OrgID,
	ledgerId?: LedgerID,
	transactionId?: LedgerTransactionID
): ErrorContext => ({
	organizationId: organizationId.toString(),
	ledgerId: ledgerId?.toString(),
	transactionId: transactionId?.toString(),
});

const mapInfrastructureError = (
	cause: unknown,
	errorContext: ErrorContext
): TransactionInfrastructureError =>
	isPostgresUnavailable(cause)
		? new TransactionRepositoryUnavailable(cause, errorContext)
		: new TransactionPersistenceFailure(cause, errorContext);

const mapCreateError = (
	cause: unknown,
	mutation: TransactionMutation
): TransactionCreateRepositoryError => {
	if (
		cause instanceof AccountNotFound ||
		cause instanceof AccountVersionConflict ||
		cause instanceof TransactionConcurrencyFailure ||
		cause instanceof TransactionValidationFailure
	) {
		return cause;
	}
	const code = postgresErrorCode(cause);
	if (
		(code === "23505" &&
			postgresConstraint(cause) === "unique_ledger_transactions_organization_idempotency_key") ||
		code === "40001" ||
		code === "40P01"
	) {
		return new TransactionConcurrencyFailure(cause, {
			...context(
				mutation.transaction.organizationId,
				mutation.transaction.ledgerId,
				mutation.transaction.id
			),
		});
	}
	return mapInfrastructureError(
		cause,
		context(
			mutation.transaction.organizationId,
			mutation.transaction.ledgerId,
			mutation.transaction.id
		)
	);
};

const mapReplaceError = (
	cause: unknown,
	mutation: TransactionMutation
): TransactionReplaceRepositoryError => {
	if (
		cause instanceof AccountNotFound ||
		cause instanceof AccountVersionConflict ||
		cause instanceof TransactionConcurrencyFailure ||
		cause instanceof TransactionLifecycleConflict ||
		cause instanceof TransactionNotFound ||
		cause instanceof TransactionPersistenceDecodingFailure ||
		cause instanceof TransactionValidationFailure
	) {
		return cause;
	}
	const errorContext = context(
		mutation.transaction.organizationId,
		mutation.transaction.ledgerId,
		mutation.transaction.id
	);
	const code = postgresErrorCode(cause);
	if (code === "40001" || code === "40P01") {
		return new TransactionConcurrencyFailure(cause, errorContext);
	}
	return mapInfrastructureError(cause, errorContext);
};

const decodeMetadata = (value: string | null): Readonly<Record<string, string>> | undefined => {
	if (value === null) return undefined;
	const decoded: unknown = JSON.parse(value);
	if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
		throw new Error("Transaction metadata must be an object");
	}
	if (!Object.values(decoded).every(item => typeof item === "string")) {
		throw new Error("Transaction metadata values must be strings");
	}
	return decoded as Record<string, string>;
};

const decodeDate = (value: Date, label: string): DateTime => {
	const decoded = DateTime.fromJSDate(value, { zone: "utc" });
	if (!decoded.isValid) throw new Error(`Invalid Transaction ${label}`);
	return decoded;
};

type LockedAccount = Pick<
	typeof LedgerAccountsTable.$inferSelect,
	| "id"
	| "currencyCode"
	| "minorUnitExponent"
	| "pendingCredits"
	| "pendingDebits"
	| "postedCredits"
	| "postedDebits"
	| "lockVersion"
>;

const addSafe = (left: number, right: number, message: string): number => {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new TransactionValidationFailure(message);
	return value;
};

const validateAndAggregateCreate = (
	mutation: TransactionMutation,
	accounts: ReadonlyMap<string, LockedAccount>
): readonly AccountCounterDelta[] => {
	const totals = new Map<string, { debits: number; credits: number }>();
	const deltas = new Map<string, AccountCounterDelta>();
	for (const entry of mutation.transaction.entries) {
		const account = accounts.get(entry.accountId.toString());
		if (account === undefined) {
			throw new AccountNotFound(
				mutation.transaction.organizationId.toString(),
				mutation.transaction.ledgerId.toString(),
				entry.accountId.toString()
			);
		}
		if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
			throw new TransactionValidationFailure("Entry Amount must be a positive safe integer");
		}
		const accountCurrency = makeCurrency(account.currencyCode, account.minorUnitExponent);
		if (!currencyEquals(entry.currency, accountCurrency)) {
			throw new TransactionValidationFailure(
				`Entry Currency does not match Account: ${entry.accountId.toString()}`
			);
		}

		const currencyKey = `${entry.currency.code}\u0000${entry.currency.minorUnitExponent}`;
		const total = totals.get(currencyKey) ?? { debits: 0, credits: 0 };
		if (entry.direction === "debit") {
			total.debits = addSafe(total.debits, entry.amount, "Transaction Debit total is unsafe");
		} else {
			total.credits = addSafe(total.credits, entry.amount, "Transaction Credit total is unsafe");
		}
		totals.set(currencyKey, total);

		const existing = deltas.get(account.id) ?? {
			accountId: entry.accountId,
			pendingCredits: 0,
			pendingDebits: 0,
			postedCredits: 0,
			postedDebits: 0,
		};
		const side = entry.direction === "credit" ? "Credits" : "Debits";
		const pendingKey = `pending${side}` as "pendingCredits" | "pendingDebits";
		const postedKey = `posted${side}` as "postedCredits" | "postedDebits";
		const next = {
			...existing,
			[pendingKey]: addSafe(existing[pendingKey], entry.amount, "Pending Account delta is unsafe"),
		};
		if (mutation.transaction.status === "posted") {
			next[postedKey] = addSafe(existing[postedKey], entry.amount, "Posted Account delta is unsafe");
		}
		deltas.set(account.id, next);
	}

	for (const total of totals.values()) {
		if (total.debits !== total.credits) {
			throw new TransactionValidationFailure("Transaction Entries must balance by Currency");
		}
	}
	for (const [accountId, delta] of deltas) {
		const account = accounts.get(accountId)!;
		for (const counter of [
			"pendingCredits",
			"pendingDebits",
			"postedCredits",
			"postedDebits",
		] as const) {
			addSafe(account[counter], delta[counter], `Resulting Account ${counter} is unsafe`);
		}
	}
	return [...deltas.values()].sort((left, right) =>
		left.accountId.toString().localeCompare(right.accountId.toString())
	);
};

const encodeMetadata = (metadata: Readonly<Record<string, string>> | undefined) =>
	metadata === undefined ? undefined : JSON.stringify(metadata);

const decodeEntry = (row: EntryRow) =>
	Effect.gen(function* () {
		const id = yield* parseId<"lte", LedgerTransactionEntryID>("lte", row.id);
		const accountId = yield* parseId<"lat", LedgerAccountID>("lat", row.accountId);
		const decoded = yield* Effect.try({
			try: () => ({
				currency: makeCurrency(row.currencyCode, row.minorUnitExponent),
				metadata: decodeMetadata(row.metadata),
			}),
			catch: cause => cause,
		});
		return yield* Entry.make({
			id,
			accountId,
			direction: row.direction,
			amount: row.amount,
			currency: decoded.currency,
			metadata: decoded.metadata,
		});
	});

const decodeTransaction = (row: PublicTransactionRow, entryRows: readonly EntryRow[]) =>
	Effect.gen(function* () {
		const id = yield* parseId<"ltr", LedgerTransactionID>("ltr", row.id);
		const organizationId = yield* parseId<"org", OrgID>("org", row.organizationId);
		const ledgerId = yield* parseId<"lgr", LedgerID>("lgr", row.ledgerId);
		const entries = yield* Effect.all(entryRows.map(row => decodeEntry(row)));
		const decoded = yield* Effect.try({
			try: () => ({
				metadata: decodeMetadata(row.metadata),
				postedAt: row.postedAt === null ? undefined : decodeDate(row.postedAt, "Posted Time"),
				created: decodeDate(row.created, "Created Time"),
				updated: decodeDate(row.updated, "Updated Time"),
			}),
			catch: cause => cause,
		});
		return yield* Transaction.make({
			id,
			organizationId,
			ledgerId,
			status: row.status,
			description: row.description ?? undefined,
			metadata: decoded.metadata,
			entries,
			postedAt: decoded.postedAt,
			created: decoded.created,
			updated: decoded.updated,
		});
	}).pipe(Effect.mapError(cause => new TransactionPersistenceDecodingFailure(cause)));

class TransactionRepoLive implements TransactionRepo {
	constructor(private readonly db: DrizzleDatabase) {}

	createTransaction(
		idempotencyKey: string,
		mutation: TransactionMutation
	): Effect.Effect<Transaction, TransactionCreateRepositoryError> {
		const transaction = mutation.transaction;
		return Effect.tryPromise({
			try: () =>
				this.db.transaction(async tx => {
					const postedAtValid =
						DateTime.isDateTime(transaction.postedAt) && transaction.postedAt.isValid;
					if (
						(transaction.status !== "pending" && transaction.status !== "posted") ||
						(transaction.status === "pending" &&
							transaction.postedAt !== undefined &&
							transaction.postedAt !== null) ||
						(transaction.status === "posted" && !postedAtValid)
					) {
						throw new TransactionValidationFailure(
							"Create Transaction lifecycle or Posted Time is invalid"
						);
					}
					await tx.insert(LedgerTransactionsTable).values({
						id: transaction.id.toString(),
						organizationId: transaction.organizationId.toString(),
						ledgerId: transaction.ledgerId.toString(),
						idempotencyKey,
						status: transaction.status,
						description: transaction.description,
						metadata: encodeMetadata(transaction.metadata),
						postedAt: transaction.postedAt?.toJSDate(),
						created: transaction.created.toJSDate(),
						updated: transaction.updated.toJSDate(),
					});

					const accountIds = [
						...new Set(transaction.entries.map(entry => entry.accountId.toString())),
					].sort();
					const accounts = await tx
						.select({
							id: LedgerAccountsTable.id,
							currencyCode: LedgerAccountsTable.currencyCode,
							minorUnitExponent: LedgerAccountsTable.minorUnitExponent,
							pendingCredits: LedgerAccountsTable.pendingCredits,
							pendingDebits: LedgerAccountsTable.pendingDebits,
							postedCredits: LedgerAccountsTable.postedCredits,
							postedDebits: LedgerAccountsTable.postedDebits,
							lockVersion: LedgerAccountsTable.lockVersion,
						})
						.from(LedgerAccountsTable)
						.where(
							and(
								eq(LedgerAccountsTable.organizationId, transaction.organizationId.toString()),
								eq(LedgerAccountsTable.ledgerId, transaction.ledgerId.toString()),
								inArray(LedgerAccountsTable.id, accountIds)
							)
						)
						.orderBy(asc(LedgerAccountsTable.id))
						.for("update");
					const accountsById = new Map(accounts.map(account => [account.id, account]));
					const missingId = accountIds.find(accountId => !accountsById.has(accountId));
					if (missingId !== undefined) {
						throw new AccountNotFound(
							transaction.organizationId.toString(),
							transaction.ledgerId.toString(),
							missingId
						);
					}
					const deltas = validateAndAggregateCreate(mutation, accountsById);

					await tx.insert(LedgerTransactionEntriesTable).values(
						transaction.entries.map(entry => ({
							id: entry.id.toString(),
							transactionId: transaction.id.toString(),
							accountId: entry.accountId.toString(),
							organizationId: transaction.organizationId.toString(),
							ledgerId: transaction.ledgerId.toString(),
							direction: entry.direction,
							amount: entry.amount,
							metadata: encodeMetadata(entry.metadata),
							created: transaction.created.toJSDate(),
						}))
					);

					for (const delta of deltas) {
						const account = accountsById.get(delta.accountId.toString())!;
						const updated = await tx
							.update(LedgerAccountsTable)
							.set({
								pendingCredits: sql`${LedgerAccountsTable.pendingCredits} + ${delta.pendingCredits}`,
								pendingDebits: sql`${LedgerAccountsTable.pendingDebits} + ${delta.pendingDebits}`,
								postedCredits: sql`${LedgerAccountsTable.postedCredits} + ${delta.postedCredits}`,
								postedDebits: sql`${LedgerAccountsTable.postedDebits} + ${delta.postedDebits}`,
								lockVersion: sql`${LedgerAccountsTable.lockVersion} + 1`,
								updated: transaction.updated.toJSDate(),
							})
							.where(
								and(
									eq(LedgerAccountsTable.organizationId, transaction.organizationId.toString()),
									eq(LedgerAccountsTable.ledgerId, transaction.ledgerId.toString()),
									eq(LedgerAccountsTable.id, account.id),
									eq(LedgerAccountsTable.lockVersion, account.lockVersion)
								)
							)
							.returning({ id: LedgerAccountsTable.id });
						if (updated.length !== 1) {
							throw new AccountVersionConflict(
								transaction.organizationId.toString(),
								transaction.ledgerId.toString(),
								account.id
							);
						}
					}
					return transaction;
				}),
			catch: cause => mapCreateError(cause, mutation),
		});
	}

	replaceTransaction(
		mutation: TransactionMutation
	): Effect.Effect<Transaction, TransactionReplaceRepositoryError> {
		const requested = mutation.transaction;
		return Effect.tryPromise({
			try: () =>
				this.db.transaction(async tx => {
					const [row] = await tx
						.select(transactionColumns)
						.from(LedgerTransactionsTable)
						.where(
							and(
								eq(LedgerTransactionsTable.organizationId, requested.organizationId.toString()),
								eq(LedgerTransactionsTable.ledgerId, requested.ledgerId.toString()),
								eq(LedgerTransactionsTable.id, requested.id.toString())
							)
						)
						.limit(1)
						.for("update");
					if (row === undefined) {
						throw new TransactionNotFound(
							requested.organizationId.toString(),
							requested.ledgerId.toString(),
							requested.id.toString()
						);
					}
					if (row.status !== "pending") {
						throw new TransactionLifecycleConflict(
							row.id,
							row.status,
							"pending",
							context(requested.organizationId, requested.ledgerId, requested.id)
						);
					}

					const oldEntryRows = await tx
						.select(entryColumns)
						.from(LedgerTransactionEntriesTable)
						.innerJoin(
							LedgerAccountsTable,
							and(
								eq(LedgerAccountsTable.id, LedgerTransactionEntriesTable.accountId),
								eq(LedgerAccountsTable.organizationId, LedgerTransactionEntriesTable.organizationId),
								eq(LedgerAccountsTable.ledgerId, LedgerTransactionEntriesTable.ledgerId)
							)
						)
						.where(eq(LedgerTransactionEntriesTable.transactionId, row.id))
						.orderBy(asc(LedgerTransactionEntriesTable.created), asc(LedgerTransactionEntriesTable.id));
					const current = await Effect.runPromise(decodeTransaction(row, oldEntryRows));
					const replacement = await Effect.runPromise(
						current.replace(
							{
								description: requested.description,
								metadata: requested.metadata,
								entries: requested.entries,
							},
							requested.updated
						)
					);
					const replacementAccountIds = new Set(
						replacement.transaction.entries.map(entry => entry.accountId.toString())
					);
					if (replacementAccountIds.size > 200) {
						throw new TransactionValidationFailure(
							"Transaction may reference at most 200 distinct Accounts"
						);
					}
					const accountIds = [
						...new Set([
							...current.entries.map(entry => entry.accountId.toString()),
							...replacementAccountIds,
						]),
					].sort();
					const accounts = await tx
						.select({
							id: LedgerAccountsTable.id,
							currencyCode: LedgerAccountsTable.currencyCode,
							minorUnitExponent: LedgerAccountsTable.minorUnitExponent,
							pendingCredits: LedgerAccountsTable.pendingCredits,
							pendingDebits: LedgerAccountsTable.pendingDebits,
							postedCredits: LedgerAccountsTable.postedCredits,
							postedDebits: LedgerAccountsTable.postedDebits,
							lockVersion: LedgerAccountsTable.lockVersion,
						})
						.from(LedgerAccountsTable)
						.where(
							and(
								eq(LedgerAccountsTable.organizationId, requested.organizationId.toString()),
								eq(LedgerAccountsTable.ledgerId, requested.ledgerId.toString()),
								inArray(LedgerAccountsTable.id, accountIds)
							)
						)
						.orderBy(asc(LedgerAccountsTable.id))
						.for("update");
					const accountsById = new Map(accounts.map(account => [account.id, account]));
					const missingId = accountIds.find(accountId => !accountsById.has(accountId));
					if (missingId !== undefined) {
						throw new AccountNotFound(
							requested.organizationId.toString(),
							requested.ledgerId.toString(),
							missingId
						);
					}
					for (const entry of replacement.transaction.entries) {
						const account = accountsById.get(entry.accountId.toString())!;
						if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
							throw new TransactionValidationFailure("Entry Amount must be a positive safe integer");
						}
						if (
							!currencyEquals(
								entry.currency,
								makeCurrency(account.currencyCode, account.minorUnitExponent)
							)
						) {
							throw new TransactionValidationFailure(
								`Entry Currency does not match Account: ${entry.accountId.toString()}`
							);
						}
					}
					const deltas = new Map(replacement.deltas.map(delta => [delta.accountId.toString(), delta]));
					for (const accountId of accountIds) {
						const account = accountsById.get(accountId)!;
						const delta = deltas.get(accountId)!;
						for (const counter of [
							"pendingCredits",
							"pendingDebits",
							"postedCredits",
							"postedDebits",
						] as const) {
							addSafe(account[counter], delta[counter], `Resulting Account ${counter} is unsafe`);
						}
					}

					await tx
						.update(LedgerTransactionsTable)
						.set({
							description: replacement.transaction.description ?? sql`null`,
							metadata: encodeMetadata(replacement.transaction.metadata) ?? sql`null`,
							updated: replacement.transaction.updated.toJSDate(),
						})
						.where(
							and(
								eq(LedgerTransactionsTable.organizationId, requested.organizationId.toString()),
								eq(LedgerTransactionsTable.ledgerId, requested.ledgerId.toString()),
								eq(LedgerTransactionsTable.id, requested.id.toString())
							)
						);
					await tx
						.delete(LedgerTransactionEntriesTable)
						.where(eq(LedgerTransactionEntriesTable.transactionId, row.id));
					await tx.insert(LedgerTransactionEntriesTable).values(
						replacement.transaction.entries.map(entry => ({
							id: entry.id.toString(),
							transactionId: row.id,
							accountId: entry.accountId.toString(),
							organizationId: row.organizationId,
							ledgerId: row.ledgerId,
							direction: entry.direction,
							amount: entry.amount,
							metadata: encodeMetadata(entry.metadata),
							created: replacement.transaction.updated.toJSDate(),
						}))
					);
					for (const accountId of accountIds) {
						const account = accountsById.get(accountId)!;
						const delta = deltas.get(accountId)!;
						const updated = await tx
							.update(LedgerAccountsTable)
							.set({
								pendingCredits: sql`${LedgerAccountsTable.pendingCredits} + ${delta.pendingCredits}`,
								pendingDebits: sql`${LedgerAccountsTable.pendingDebits} + ${delta.pendingDebits}`,
								postedCredits: sql`${LedgerAccountsTable.postedCredits} + ${delta.postedCredits}`,
								postedDebits: sql`${LedgerAccountsTable.postedDebits} + ${delta.postedDebits}`,
								lockVersion: sql`${LedgerAccountsTable.lockVersion} + 1`,
								updated: replacement.transaction.updated.toJSDate(),
							})
							.where(
								and(
									eq(LedgerAccountsTable.organizationId, row.organizationId),
									eq(LedgerAccountsTable.ledgerId, row.ledgerId),
									eq(LedgerAccountsTable.id, accountId),
									eq(LedgerAccountsTable.lockVersion, account.lockVersion)
								)
							)
							.returning({ id: LedgerAccountsTable.id });
						if (updated.length !== 1) {
							throw new AccountVersionConflict(row.organizationId, row.ledgerId, accountId);
						}
					}
					return replacement.transaction;
				}),
			catch: cause => mapReplaceError(cause, mutation),
		});
	}

	private loadTransactions(
		rows: readonly PublicTransactionRow[],
		errorContext: ErrorContext
	): Effect.Effect<Transaction[], TransactionInfrastructureError> {
		if (rows.length === 0) return Effect.succeed([]);
		const transactionIds = rows.map(row => row.id);
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(entryColumns)
					.from(LedgerTransactionEntriesTable)
					.innerJoin(
						LedgerAccountsTable,
						and(
							eq(LedgerAccountsTable.id, LedgerTransactionEntriesTable.accountId),
							eq(LedgerAccountsTable.organizationId, LedgerTransactionEntriesTable.organizationId),
							eq(LedgerAccountsTable.ledgerId, LedgerTransactionEntriesTable.ledgerId)
						)
					)
					.where(inArray(LedgerTransactionEntriesTable.transactionId, transactionIds))
					.orderBy(asc(LedgerTransactionEntriesTable.created), asc(LedgerTransactionEntriesTable.id)),
			catch: cause => mapInfrastructureError(cause, errorContext),
		}).pipe(
			Effect.flatMap(entryRows => {
				const byTransaction = new Map<string, EntryRow[]>();
				for (const row of entryRows) {
					const transactionEntries = byTransaction.get(row.transactionId) ?? [];
					transactionEntries.push(row);
					byTransaction.set(row.transactionId, transactionEntries);
				}
				return Effect.all(rows.map(row => decodeTransaction(row, byTransaction.get(row.id) ?? [])));
			})
		);
	}

	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<Transaction[], TransactionInfrastructureError> {
		const errorContext = context(organizationId, ledgerId);
		const limit = Math.min(Math.max(Math.trunc(query.limit), 1), 100);
		const offset = Math.min(Math.max(Math.trunc(query.offset), 0), 10_000);
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(transactionColumns)
					.from(LedgerTransactionsTable)
					.where(
						and(
							eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
							eq(LedgerTransactionsTable.ledgerId, ledgerId.toString())
						)
					)
					.orderBy(desc(LedgerTransactionsTable.created), desc(LedgerTransactionsTable.id))
					.limit(limit)
					.offset(offset),
			catch: cause => mapInfrastructureError(cause, errorContext),
		}).pipe(Effect.flatMap(rows => this.loadTransactions(rows, errorContext)));
	}

	getTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Option.Option<Transaction>, TransactionInfrastructureError> {
		const errorContext = context(organizationId, ledgerId, transactionId);
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(transactionColumns)
					.from(LedgerTransactionsTable)
					.where(
						and(
							eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
							eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
							eq(LedgerTransactionsTable.id, transactionId.toString())
						)
					)
					.limit(1),
			catch: cause => mapInfrastructureError(cause, errorContext),
		}).pipe(
			Effect.flatMap(rows => this.loadTransactions(rows, errorContext)),
			Effect.map(transactions => Option.fromNullishOr(transactions[0]))
		);
	}

	getTransactionByIdempotencyKey(
		organizationId: OrgID,
		idempotencyKey: string
	): Effect.Effect<Option.Option<Transaction>, TransactionInfrastructureError> {
		const errorContext = context(organizationId);
		return Effect.tryPromise({
			try: () =>
				this.db
					.select(transactionColumns)
					.from(LedgerTransactionsTable)
					.where(
						and(
							eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
							eq(LedgerTransactionsTable.idempotencyKey, idempotencyKey)
						)
					)
					.limit(1),
			catch: cause => mapInfrastructureError(cause, errorContext),
		}).pipe(
			Effect.flatMap(rows => this.loadTransactions(rows, errorContext)),
			Effect.map(transactions => Option.fromNullishOr(transactions[0]))
		);
	}
}

const transactionRepoLayer = Layer.effect(
	TransactionRepoTag,
	DatabaseTag.pipe(Effect.map(database => new TransactionRepoLive(database.db)))
);

export type {
	TransactionCreateRepositoryError,
	TransactionListQuery,
	TransactionReplaceRepositoryError,
	TransactionRepo,
};
export { TransactionRepoLive, TransactionRepoTag, transactionRepoLayer };
