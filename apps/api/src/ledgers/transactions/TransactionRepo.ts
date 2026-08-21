import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import type { DateTime } from "luxon";

import { DatabaseTag, type DrizzleDatabase, isPostgresUnavailable, postgresErrorCode } from "@/db";
import { AccountNotFound, AccountVersionConflict, makeCurrency } from "@/ledgers/accounts";
import type { LedgerID, LedgerTransactionID, OrgID } from "@/repo/entities/types";
import {
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "@/repo/schema";

import {
	Transaction,
	type AccountCounterDelta,
	type TransactionCreateRequest,
	type TransactionUpdateRequest,
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
	TransactionVersionConflict,
} from "./TransactionErrors";

type TransactionListQuery = Readonly<{ offset: number; limit: number }>;

type TransactionCreateRepositoryError =
	| AccountNotFound
	| AccountVersionConflict
	| TransactionConcurrencyFailure
	| TransactionInfrastructureError
	| TransactionValidationFailure;

type TransactionUpdateRepositoryError =
	| AccountNotFound
	| AccountVersionConflict
	| TransactionConcurrencyFailure
	| TransactionInfrastructureError
	| TransactionLifecycleConflict
	| TransactionNotFound
	| TransactionValidationFailure
	| TransactionVersionConflict;

type TransactionTransitionRepositoryError = TransactionUpdateRepositoryError;

interface TransactionRepo {
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
	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionCreateRequest
	): Effect.Effect<Transaction, TransactionCreateRepositoryError>;
	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionUpdateRequest
	): Effect.Effect<Transaction, TransactionUpdateRepositoryError>;
	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		postedAt: DateTime
	): Effect.Effect<Transaction, TransactionTransitionRepositoryError>;
	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		updated: DateTime
	): Effect.Effect<Transaction, TransactionTransitionRepositoryError>;
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
	lockVersion: LedgerTransactionsTable.lockVersion,
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

const accountColumns = {
	id: LedgerAccountsTable.id,
	currencyCode: LedgerAccountsTable.currencyCode,
	minorUnitExponent: LedgerAccountsTable.minorUnitExponent,
	pendingCredits: LedgerAccountsTable.pendingCredits,
	pendingDebits: LedgerAccountsTable.pendingDebits,
	postedCredits: LedgerAccountsTable.postedCredits,
	postedDebits: LedgerAccountsTable.postedDebits,
	lockVersion: LedgerAccountsTable.lockVersion,
};

type DatabaseTransaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];
type AccountRow = Pick<typeof LedgerAccountsTable.$inferSelect, keyof typeof accountColumns>;
type ErrorContext = Readonly<{
	organizationId?: string;
	ledgerId?: string;
	transactionId?: string;
}>;

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

const mapConcurrentOrInfrastructure = (cause: unknown, errorContext: ErrorContext) =>
	postgresErrorCode(cause) === "40001" || postgresErrorCode(cause) === "40P01"
		? new TransactionConcurrencyFailure(cause, errorContext)
		: mapInfrastructureError(cause, errorContext);

const mapCreateError = (
	cause: unknown,
	errorContext: ErrorContext
): TransactionCreateRepositoryError =>
	cause instanceof AccountNotFound ||
	cause instanceof AccountVersionConflict ||
	cause instanceof TransactionValidationFailure
		? cause
		: mapConcurrentOrInfrastructure(cause, errorContext);

const mapMutationError = (
	cause: unknown,
	errorContext: ErrorContext
): TransactionUpdateRepositoryError =>
	cause instanceof AccountNotFound ||
	cause instanceof AccountVersionConflict ||
	cause instanceof TransactionLifecycleConflict ||
	cause instanceof TransactionNotFound ||
	cause instanceof TransactionPersistenceDecodingFailure ||
	cause instanceof TransactionValidationFailure ||
	cause instanceof TransactionVersionConflict
		? cause
		: mapConcurrentOrInfrastructure(cause, errorContext);

// const validateCounters = (
// 	deltas: readonly AccountCounterDelta[],
// 	accounts: ReadonlyMap<string, AccountRow>
// ): void => {
// 	for (const delta of deltas) {
// 		const account = accounts.get(delta.accountId.toString());
// 		if (account === undefined) continue;
// 		for (const counter of [
// 			"pendingCredits",
// 			"pendingDebits",
// 			"postedCredits",
// 			"postedDebits",
// 		] as const) {
// 			if (!Number.isSafeInteger(account[counter] + delta[counter])) {
// 				throw new TransactionValidationFailure(`Resulting Account ${counter} is unsafe`);
// 			}
// 		}
// 	}
// };

// const applyDeltas = async (
// 	tx: DatabaseTransaction,
// 	transaction: Transaction,
// 	deltas: readonly AccountCounterDelta[],
// 	accounts: ReadonlyMap<string, AccountRow>
// ): Promise<void> => {
// 	for (const delta of deltas) {
// 		const accountId = delta.accountId.toString();
// 		const account = accounts.get(accountId);
// 		if (account === undefined) {
// 			throw new AccountNotFound(
// 				transaction.organizationId.toString(),
// 				transaction.ledgerId.toString(),
// 				accountId
// 			);
// 		}
// 		const updated = await tx
// 			.update(LedgerAccountsTable)
// 			.set({
// 				pendingCredits: sql`${LedgerAccountsTable.pendingCredits} + ${delta.pendingCredits}`,
// 				pendingDebits: sql`${LedgerAccountsTable.pendingDebits} + ${delta.pendingDebits}`,
// 				postedCredits: sql`${LedgerAccountsTable.postedCredits} + ${delta.postedCredits}`,
// 				postedDebits: sql`${LedgerAccountsTable.postedDebits} + ${delta.postedDebits}`,
// 				lockVersion: sql`${LedgerAccountsTable.lockVersion} + 1`,
// 				updated: transaction.updated.toJSDate(),
// 			})
// 			.where(
// 				and(
// 					eq(LedgerAccountsTable.organizationId, transaction.organizationId.toString()),
// 					eq(LedgerAccountsTable.ledgerId, transaction.ledgerId.toString()),
// 					eq(LedgerAccountsTable.id, accountId),
// 					eq(LedgerAccountsTable.lockVersion, account.lockVersion)
// 				)
// 			)
// 			.returning({ id: LedgerAccountsTable.id });
// 		if (updated.length !== 1) {
// 			throw new AccountVersionConflict(
// 				transaction.organizationId.toString(),
// 				transaction.ledgerId.toString(),
// 				accountId
// 			);
// 		}
// 	}
// };

// const requireTransaction = (
// 	transaction: Option.Option<Transaction>,
// 	organizationId: OrgID,
// 	ledgerId: LedgerID,
// 	transactionId: LedgerTransactionID
// ): Transaction => {
// 	const value = Option.getOrUndefined(transaction);
// 	if (value === undefined) {
// 		throw new TransactionNotFound(
// 			organizationId.toString(),
// 			ledgerId.toString(),
// 			transactionId.toString()
// 		);
// 	}
// 	return value;
// };

class TransactionRepoLive implements TransactionRepo {
	constructor(private readonly db: DrizzleDatabase) {}

	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<Transaction[], TransactionInfrastructureError> {
		const errorContext = context(organizationId, ledgerId);
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
					.limit(query.limit)
					.offset(query.offset),
			catch: cause => mapInfrastructureError(cause, errorContext),
		}).pipe(Effect.flatMap(rows => Effect.all(rows.map(row => Transaction.fromRow(row)))));
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
					.select({ transaction: transactionColumns, entry: entryColumns })
					.from(LedgerTransactionsTable)
					.leftJoin(
						LedgerTransactionEntriesTable,
						and(
							eq(LedgerTransactionEntriesTable.transactionId, LedgerTransactionsTable.id),
							eq(LedgerTransactionEntriesTable.organizationId, LedgerTransactionsTable.organizationId),
							eq(LedgerTransactionEntriesTable.ledgerId, LedgerTransactionsTable.ledgerId)
						)
					)
					.where(
						and(
							eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
							eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
							eq(LedgerTransactionsTable.id, transactionId.toString())
						)
					)
					.orderBy(asc(LedgerTransactionEntriesTable.created), asc(LedgerTransactionEntriesTable.id)),
			catch: cause => mapInfrastructureError(cause, errorContext),
		}).pipe(Effect.flatMap(rows => Transaction.fromRows(rows)));
	}

	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionCreateRequest
	): Effect.Effect<Transaction, TransactionCreateRepositoryError> {
		const errorContext = context(organizationId, ledgerId, transactionId);
		return Effect.tryPromise({
			try: () =>
				this.db.transaction(async tx => {
					const accountIds = [...new Set(request.ledgerEntries.map(entry => entry.accountId))].sort();
					const accounts = await tx
						.select(accountColumns)
						.from(LedgerAccountsTable)
						.where(
							and(
								eq(LedgerAccountsTable.organizationId, organizationId.toString()),
								eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
								inArray(LedgerAccountsTable.id, accountIds)
							)
						)
						.orderBy(asc(LedgerAccountsTable.id));
					const accountsById = new Map(accounts.map(account => [account.id, account]));
					const missingId = accountIds.find(accountId => !accountsById.has(accountId));
					if (missingId !== undefined) {
						throw new AccountNotFound(organizationId.toString(), ledgerId.toString(), missingId);
					}
					const currencies = new Map(
						accounts.map(account => [
							account.id,
							makeCurrency(account.currencyCode, account.minorUnitExponent),
						])
					);
					const transaction = await Effect.runPromise(
						Transaction.fromRequest(transactionId, organizationId, ledgerId, request, currencies)
					);
					const mutation = transaction.createMutation();
					validateCounters(mutation.deltas, accountsById);
					await tx.insert(LedgerTransactionsTable).values(transaction.toRow());
					await tx
						.insert(LedgerTransactionEntriesTable)
						.values(Option.getOrThrow(transaction.entries).map(entry => entry.toRow(transaction)));
					await applyDeltas(tx, transaction, mutation.deltas, accountsById);
					return transaction;
				}),
			catch: cause => mapCreateError(cause, errorContext),
		});
	}

	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionUpdateRequest
	): Effect.Effect<Transaction, TransactionUpdateRepositoryError> {
		const errorContext = context(organizationId, ledgerId, transactionId);
		return Effect.tryPromise({
			try: () =>
				this.db.transaction(async tx => {
					const rows = await tx
						.select({ transaction: transactionColumns, entry: entryColumns })
						.from(LedgerTransactionsTable)
						.leftJoin(
							LedgerTransactionEntriesTable,
							and(
								eq(LedgerTransactionEntriesTable.transactionId, LedgerTransactionsTable.id),
								eq(LedgerTransactionEntriesTable.organizationId, LedgerTransactionsTable.organizationId),
								eq(LedgerTransactionEntriesTable.ledgerId, LedgerTransactionsTable.ledgerId)
							)
						)
						.leftJoin(
							LedgerAccountsTable,
							and(
								eq(LedgerAccountsTable.id, LedgerTransactionEntriesTable.accountId),
								eq(LedgerAccountsTable.organizationId, LedgerTransactionEntriesTable.organizationId),
								eq(LedgerAccountsTable.ledgerId, LedgerTransactionEntriesTable.ledgerId)
							)
						)
						.where(
							and(
								eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
								eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
								eq(LedgerTransactionsTable.id, transactionId.toString())
							)
						)
						.orderBy(asc(LedgerTransactionEntriesTable.created), asc(LedgerTransactionEntriesTable.id));
					const current = requireTransaction(
						await Effect.runPromise(Transaction.fromRows(rows)),
						organizationId,
						ledgerId,
						transactionId
					);
					const currentEntries = Option.getOrThrow(current.entries);
					const accountIds = [
						...new Set([
							...currentEntries.map(entry => entry.accountId.toString()),
							...request.ledgerEntries.map(entry => entry.accountId),
						]),
					].sort();
					const accounts = await tx
						.select(accountColumns)
						.from(LedgerAccountsTable)
						.where(
							and(
								eq(LedgerAccountsTable.organizationId, organizationId.toString()),
								eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
								inArray(LedgerAccountsTable.id, accountIds)
							)
						)
						.orderBy(asc(LedgerAccountsTable.id));
					const accountsById = new Map(accounts.map(account => [account.id, account]));
					const missingId = accountIds.find(accountId => !accountsById.has(accountId));
					if (missingId !== undefined) {
						throw new AccountNotFound(organizationId.toString(), ledgerId.toString(), missingId);
					}
					const currencies = new Map(
						accounts.map(account => [
							account.id,
							makeCurrency(account.currencyCode, account.minorUnitExponent),
						])
					);
					const mutation = await Effect.runPromise(current.updateFromRequest(request, currencies));
					validateCounters(mutation.deltas, accountsById);
					const transaction = mutation.transaction;
					const row = transaction.toRow();
					const updatedRows = await tx
						.update(LedgerTransactionsTable)
						.set({
							description: row.description,
							metadata: row.metadata,
							lockVersion: transaction.lockVersion,
							updated: row.updated,
						})
						.where(
							and(
								eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
								eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
								eq(LedgerTransactionsTable.id, transactionId.toString()),
								eq(LedgerTransactionsTable.lockVersion, current.lockVersion)
							)
						)
						.returning({ id: LedgerTransactionsTable.id });
					if (updatedRows.length !== 1) {
						throw new TransactionVersionConflict(
							organizationId.toString(),
							ledgerId.toString(),
							transactionId.toString()
						);
					}
					await tx
						.delete(LedgerTransactionEntriesTable)
						.where(
							and(
								eq(LedgerTransactionEntriesTable.organizationId, organizationId.toString()),
								eq(LedgerTransactionEntriesTable.ledgerId, ledgerId.toString()),
								eq(LedgerTransactionEntriesTable.transactionId, transactionId.toString())
							)
						);
					await tx
						.insert(LedgerTransactionEntriesTable)
						.values(Option.getOrThrow(transaction.entries).map(entry => entry.toRow(transaction)));
					await applyDeltas(tx, transaction, mutation.deltas, accountsById);
					return transaction;
				}),
			catch: cause => mapMutationError(cause, errorContext),
		});
	}

	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		postedAt: DateTime
	): Effect.Effect<Transaction, TransactionTransitionRepositoryError> {
		const errorContext = context(organizationId, ledgerId, transactionId);
		return Effect.tryPromise({
			try: () =>
				this.db.transaction(async tx => {
					const rows = await tx
						.select({ transaction: transactionColumns, entry: entryColumns })
						.from(LedgerTransactionsTable)
						.leftJoin(
							LedgerTransactionEntriesTable,
							and(
								eq(LedgerTransactionEntriesTable.transactionId, LedgerTransactionsTable.id),
								eq(LedgerTransactionEntriesTable.organizationId, LedgerTransactionsTable.organizationId),
								eq(LedgerTransactionEntriesTable.ledgerId, LedgerTransactionsTable.ledgerId)
							)
						)
						.leftJoin(
							LedgerAccountsTable,
							and(
								eq(LedgerAccountsTable.id, LedgerTransactionEntriesTable.accountId),
								eq(LedgerAccountsTable.organizationId, LedgerTransactionEntriesTable.organizationId),
								eq(LedgerAccountsTable.ledgerId, LedgerTransactionEntriesTable.ledgerId)
							)
						)
						.where(
							and(
								eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
								eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
								eq(LedgerTransactionsTable.id, transactionId.toString())
							)
						)
						.orderBy(asc(LedgerTransactionEntriesTable.created), asc(LedgerTransactionEntriesTable.id));
					const current = requireTransaction(
						await Effect.runPromise(Transaction.fromRows(rows)),
						organizationId,
						ledgerId,
						transactionId
					);
					const mutation = await Effect.runPromise(current.post(postedAt));
					if (mutation.deltas.length === 0) return current;
					const entries = Option.getOrThrow(current.entries);
					const accountIds = [...new Set(entries.map(entry => entry.accountId.toString()))].sort();
					const accounts = await tx
						.select(accountColumns)
						.from(LedgerAccountsTable)
						.where(
							and(
								eq(LedgerAccountsTable.organizationId, organizationId.toString()),
								eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
								inArray(LedgerAccountsTable.id, accountIds)
							)
						)
						.orderBy(asc(LedgerAccountsTable.id));
					const accountsById = new Map(accounts.map(account => [account.id, account]));
					const missingId = accountIds.find(accountId => !accountsById.has(accountId));
					if (missingId !== undefined) {
						throw new AccountNotFound(organizationId.toString(), ledgerId.toString(), missingId);
					}
					validateCounters(mutation.deltas, accountsById);
					const transaction = mutation.transaction;
					const row = transaction.toRow();
					const updatedRows = await tx
						.update(LedgerTransactionsTable)
						.set({
							status: transaction.status,
							postedAt: row.postedAt,
							lockVersion: transaction.lockVersion,
							updated: row.updated,
						})
						.where(
							and(
								eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
								eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
								eq(LedgerTransactionsTable.id, transactionId.toString()),
								eq(LedgerTransactionsTable.lockVersion, current.lockVersion)
							)
						)
						.returning({ id: LedgerTransactionsTable.id });
					if (updatedRows.length !== 1) {
						throw new TransactionVersionConflict(
							organizationId.toString(),
							ledgerId.toString(),
							transactionId.toString()
						);
					}
					await applyDeltas(tx, transaction, mutation.deltas, accountsById);
					return transaction;
				}),
			catch: cause => mapMutationError(cause, errorContext),
		});
	}

	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		updated: DateTime
	): Effect.Effect<Transaction, TransactionTransitionRepositoryError> {
		const errorContext = context(organizationId, ledgerId, transactionId);
		return Effect.tryPromise({
			try: () =>
				this.db.transaction(async tx => {
					const rows = await tx
						.select({ transaction: transactionColumns, entry: entryColumns })
						.from(LedgerTransactionsTable)
						.leftJoin(
							LedgerTransactionEntriesTable,
							and(
								eq(LedgerTransactionEntriesTable.transactionId, LedgerTransactionsTable.id),
								eq(LedgerTransactionEntriesTable.organizationId, LedgerTransactionsTable.organizationId),
								eq(LedgerTransactionEntriesTable.ledgerId, LedgerTransactionsTable.ledgerId)
							)
						)
						.leftJoin(
							LedgerAccountsTable,
							and(
								eq(LedgerAccountsTable.id, LedgerTransactionEntriesTable.accountId),
								eq(LedgerAccountsTable.organizationId, LedgerTransactionEntriesTable.organizationId),
								eq(LedgerAccountsTable.ledgerId, LedgerTransactionEntriesTable.ledgerId)
							)
						)
						.where(
							and(
								eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
								eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
								eq(LedgerTransactionsTable.id, transactionId.toString())
							)
						)
						.orderBy(asc(LedgerTransactionEntriesTable.created), asc(LedgerTransactionEntriesTable.id));
					const current = requireTransaction(
						await Effect.runPromise(Transaction.fromRows(rows)),
						organizationId,
						ledgerId,
						transactionId
					);
					const mutation = await Effect.runPromise(current.void(updated));
					if (mutation.deltas.length === 0) return current;
					const entries = Option.getOrThrow(current.entries);
					const accountIds = [...new Set(entries.map(entry => entry.accountId.toString()))].sort();
					const accounts = await tx
						.select(accountColumns)
						.from(LedgerAccountsTable)
						.where(
							and(
								eq(LedgerAccountsTable.organizationId, organizationId.toString()),
								eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
								inArray(LedgerAccountsTable.id, accountIds)
							)
						)
						.orderBy(asc(LedgerAccountsTable.id));
					const accountsById = new Map(accounts.map(account => [account.id, account]));
					const missingId = accountIds.find(accountId => !accountsById.has(accountId));
					if (missingId !== undefined) {
						throw new AccountNotFound(organizationId.toString(), ledgerId.toString(), missingId);
					}
					validateCounters(mutation.deltas, accountsById);
					const transaction = mutation.transaction;
					const row = transaction.toRow();
					const updatedRows = await tx
						.update(LedgerTransactionsTable)
						.set({
							status: transaction.status,
							lockVersion: transaction.lockVersion,
							updated: row.updated,
						})
						.where(
							and(
								eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
								eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
								eq(LedgerTransactionsTable.id, transactionId.toString()),
								eq(LedgerTransactionsTable.lockVersion, current.lockVersion)
							)
						)
						.returning({ id: LedgerTransactionsTable.id });
					if (updatedRows.length !== 1) {
						throw new TransactionVersionConflict(
							organizationId.toString(),
							ledgerId.toString(),
							transactionId.toString()
						);
					}
					await applyDeltas(tx, transaction, mutation.deltas, accountsById);
					return transaction;
				}),
			catch: cause => mapMutationError(cause, errorContext),
		});
	}
}

const transactionRepoLayer = Layer.effect(
	TransactionRepoTag,
	DatabaseTag.pipe(Effect.map(database => new TransactionRepoLive(database.db)))
);

export type {
	TransactionCreateRepositoryError,
	TransactionListQuery,
	TransactionRepo,
	TransactionTransitionRepositoryError,
	TransactionUpdateRepositoryError,
};
export { TransactionRepoLive, TransactionRepoTag, transactionRepoLayer };
