import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import type { DateTime } from "luxon";

import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import {
	AccountNotFound,
	AccountVersionConflict,
	LedgerAccount,
	LedgerAccountCurrencyMismatch,
	requireAccount,
	requireAccountWrite,
} from "@/ledgers/accounts";
import type { LedgerID, LedgerTransactionID, OrgID } from "@/repo/entities/types";
import {
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "@/repo/schema";

import { LedgerTransaction } from "./domain/LedgerTransaction";
import type { LedgerTransactionEntry } from "./domain/LedgerTransactionEntry";
import {
	TransactionConcurrencyFailure,
	type TransactionInfrastructureError,
	TransactionLifecycleConflict,
	TransactionNotFound,
	TransactionValidationFailure,
	TransactionVersionConflict,
	mapTransactionCreateError,
	mapTransactionInfrastructureError,
	mapTransactionMutationError,
	requireTransaction,
	requireTransactionWrite,
} from "./TransactionErrors";
import type {
	TransactionCreateRequest,
	TransactionListQuery,
	TransactionUpdateRequest,
} from "./TransactionSchema";

type LedgerTransactionCreateRepositoryError =
	| AccountNotFound
	| AccountVersionConflict
	| LedgerAccountCurrencyMismatch
	| TransactionConcurrencyFailure
	| TransactionInfrastructureError
	| TransactionValidationFailure;

type LedgerTransactionUpdateRepositoryError =
	| AccountNotFound
	| AccountVersionConflict
	| LedgerAccountCurrencyMismatch
	| TransactionConcurrencyFailure
	| TransactionInfrastructureError
	| TransactionLifecycleConflict
	| TransactionNotFound
	| TransactionValidationFailure
	| TransactionVersionConflict;

type LedgerTransactionTransitionRepositoryError = LedgerTransactionUpdateRepositoryError;

/**
 * Persists Transactions, their Entries, and the resulting Account projections.
 *
 * Expected failures are returned through each operation's Effect error channel.
 */
interface LedgerTransactionRepo {
	/**
	 * Lists Transactions for one Organization and Ledger in reverse creation order.
	 *
	 * @param organizationId - Organization that owns the Transactions.
	 * @param ledgerId - Ledger that contains the Transactions.
	 * @param query - Pagination parameters for the result set.
	 * @returns An Effect containing the requested page of Transactions.
	 */
	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<LedgerTransaction[], TransactionInfrastructureError>;
	/**
	 * Finds a Transaction and its ordered Entries within one Organization and Ledger.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to find.
	 * @returns An Effect containing the Transaction when found, or `Option.none()` otherwise.
	 */
	getTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Option.Option<LedgerTransaction>, TransactionInfrastructureError>;
	/**
	 * Creates a Transaction and updates every affected Account atomically.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that will contain the Transaction.
	 * @param transactionId - Server-generated identifier for the Transaction.
	 * @param request - Validated Transaction creation request.
	 * @returns An Effect containing the created Transaction.
	 */
	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionCreateRequest
	): Effect.Effect<LedgerTransaction, LedgerTransactionCreateRepositoryError>;
	/**
	 * Replaces a pending Transaction's mutable fields and Entries atomically.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to update.
	 * @param request - Validated replacement values and Entries.
	 * @returns An Effect containing the updated Transaction.
	 */
	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionUpdateRequest
	): Effect.Effect<LedgerTransaction, LedgerTransactionUpdateRepositoryError>;
	/**
	 * Posts a pending Transaction and moves its Entry effects into posted Account projections.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to post.
	 * @param postedAt - Time at which the Transaction becomes posted.
	 * @returns An Effect containing the posted Transaction, or the existing posted Transaction.
	 */
	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		postedAt: DateTime
	): Effect.Effect<LedgerTransaction, LedgerTransactionTransitionRepositoryError>;
	/**
	 * Voids a pending Transaction and removes its effects from Account projections.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to void.
	 * @param updated - Time at which the Transaction becomes voided.
	 * @returns An Effect containing the voided Transaction, or the existing voided Transaction.
	 */
	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		updated: DateTime
	): Effect.Effect<LedgerTransaction, LedgerTransactionTransitionRepositoryError>;
}

const LedgerTransactionRepoTag = Context.Service<LedgerTransactionRepo>("LedgerTransactionRepo");

type DatabaseTransaction = Parameters<Parameters<EffectDrizzleDatabase["transaction"]>[0]>[0];
type AccountsById = Map<string, LedgerAccount>;

/** PostgreSQL implementation of the Transaction repository contract. */
class LedgerTransactionRepoLive implements LedgerTransactionRepo {
	/**
	 * Creates a Transaction repository backed by an Effect-enabled Drizzle database.
	 *
	 * @param db - Database used for all Transaction and Account reads and writes.
	 */
	constructor(private readonly db: EffectDrizzleDatabase) {}

	/**
	 * Lists tenant-scoped Transactions in descending creation and identifier order.
	 *
	 * @param organizationId - Organization that owns the Transactions.
	 * @param ledgerId - Ledger that contains the Transactions.
	 * @param query - Offset and limit for the result page.
	 * @returns An Effect containing decoded Transactions without their Entries.
	 */
	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<LedgerTransaction[], TransactionInfrastructureError> {
		return this.db
			.select()
			.from(LedgerTransactionsTable)
			.where(
				and(
					eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
					eq(LedgerTransactionsTable.ledgerId, ledgerId.toString())
				)
			)
			.orderBy(desc(LedgerTransactionsTable.created), desc(LedgerTransactionsTable.id))
			.limit(query.limit)
			.offset(query.offset)
			.pipe(
				Effect.flatMap(rows => Effect.all(rows.map(row => LedgerTransaction.fromRow(row)))),
				Effect.mapError(mapTransactionInfrastructureError)
			);
	}

	/**
	 * Reads one tenant-scoped Transaction with Entries ordered by creation time and identifier.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to read.
	 * @returns An Effect containing the decoded Transaction, or `Option.none()` when absent.
	 */
	getTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Option.Option<LedgerTransaction>, TransactionInfrastructureError> {
		return this.db.query.LedgerTransactionsTable.findMany({
			where: {
				organizationId: organizationId.toString(),
				ledgerId: ledgerId.toString(),
				id: transactionId.toString(),
			},
			with: {
				entries: {
					orderBy: {
						created: "asc",
						id: "asc",
					},
				},
			},
		}).pipe(
			Effect.flatMap(rows => LedgerTransaction.fromRows(rows)),
			Effect.mapError(mapTransactionInfrastructureError)
		);
	}

	/**
	 * Creates a Transaction, its Entries, and updated Account projections in one database transaction.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that will contain the Transaction.
	 * @param transactionId - Server-generated identifier for the Transaction.
	 * @param request - Validated Transaction creation request.
	 * @returns An Effect containing the created Transaction.
	 */
	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionCreateRequest
	): Effect.Effect<LedgerTransaction, LedgerTransactionCreateRepositoryError> {
		return Effect.gen({ self: this }, function* () {
			const accountIds = [...new Set(request.ledgerEntries.map(entry => entry.accountId))].sort();
			const accounts = yield* this.readAccounts(organizationId, ledgerId, accountIds);
			const transaction = yield* LedgerTransaction.fromCreateRequest(
				transactionId,
				organizationId,
				ledgerId,
				request
			);
			const entries = Option.getOrThrow(transaction.entries);
			const updatedAccounts = yield* this.applyEntriesToAccounts(
				accounts,
				entries,
				transaction.updated
			);

			yield* this.db.transaction(tx =>
				tx
					.insert(LedgerTransactionsTable)
					.values(transaction.toRow())
					.pipe(
						Effect.andThen(
							tx
								.insert(LedgerTransactionEntriesTable)
								.values(entries.map(entry => entry.toRow(transaction)))
						),
						Effect.andThen(this.writeAccounts(tx, organizationId, ledgerId, accounts, updatedAccounts))
					)
			);

			return transaction;
		}).pipe(Effect.mapError(mapTransactionCreateError));
	}

	/**
	 * Replaces a pending Transaction and recalculates affected Account projections atomically.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to replace.
	 * @param request - Validated replacement values and Entries.
	 * @returns An Effect containing the updated Transaction.
	 */
	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionUpdateRequest
	): Effect.Effect<LedgerTransaction, LedgerTransactionUpdateRepositoryError> {
		return Effect.gen({ self: this }, function* () {
			const current = yield* this.readTransaction(organizationId, ledgerId, transactionId);
			const currentEntries = Option.getOrThrow(current.entries);
			const accountIds = [
				...new Set([
					...currentEntries.map(entry => entry.accountId.toString()),
					...request.ledgerEntries.map(entry => entry.accountId),
				]),
			].sort();
			const accounts = yield* this.readAccounts(organizationId, ledgerId, accountIds);
			const transaction = yield* current.fromUpdateRequest(request);
			const entries = Option.getOrThrow(transaction.entries);
			const withoutCurrentEntries = this.removeEntriesFromAccounts(
				accounts,
				currentEntries,
				transaction.updated
			);
			const updatedAccounts = yield* this.applyEntriesToAccounts(
				withoutCurrentEntries,
				entries,
				transaction.updated
			);

			yield* this.db.transaction(tx =>
				this.writeTransaction(tx, current, transaction).pipe(
					Effect.andThen(this.replaceEntries(tx, transaction, entries)),
					Effect.andThen(this.writeAccounts(tx, organizationId, ledgerId, accounts, updatedAccounts))
				)
			);

			return transaction;
		}).pipe(Effect.mapError(mapTransactionMutationError));
	}

	/**
	 * Posts a Transaction and recalculates its pending, posted, and available Account projections.
	 *
	 * A Transaction that is already posted is returned without issuing writes.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to post.
	 * @param postedAt - Time at which the Transaction becomes posted.
	 * @returns An Effect containing the posted Transaction.
	 */
	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		postedAt: DateTime
	): Effect.Effect<LedgerTransaction, LedgerTransactionTransitionRepositoryError> {
		return Effect.gen({ self: this }, function* () {
			const current = yield* this.readTransaction(organizationId, ledgerId, transactionId);
			if (current.status === "posted") return current;

			const currentEntries = Option.getOrThrow(current.entries);
			const accountIds = [...new Set(currentEntries.map(entry => entry.accountId.toString()))].sort();
			const accounts = yield* this.readAccounts(organizationId, ledgerId, accountIds);
			const transaction = yield* current.toPosted(postedAt as DateTime<true>);
			const entries = Option.getOrThrow(transaction.entries);
			const withoutCurrentEntries = this.removeEntriesFromAccounts(
				accounts,
				currentEntries,
				transaction.updated
			);
			const updatedAccounts = yield* this.applyEntriesToAccounts(
				withoutCurrentEntries,
				entries,
				transaction.updated
			);

			yield* this.db.transaction(tx =>
				this.writeTransaction(tx, current, transaction).pipe(
					Effect.andThen(this.writeEntryStatus(tx, transaction)),
					Effect.andThen(this.writeAccounts(tx, organizationId, ledgerId, accounts, updatedAccounts))
				)
			);

			return transaction;
		}).pipe(Effect.mapError(mapTransactionMutationError));
	}

	/**
	 * Voids a Transaction and removes its Entry effects from Account projections atomically.
	 *
	 * A Transaction that is already voided is returned without issuing writes.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to void.
	 * @param updated - Time at which the Transaction becomes voided.
	 * @returns An Effect containing the voided Transaction.
	 */
	voidTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		updated: DateTime
	): Effect.Effect<LedgerTransaction, LedgerTransactionTransitionRepositoryError> {
		return Effect.gen({ self: this }, function* () {
			const current = yield* this.readTransaction(organizationId, ledgerId, transactionId);
			if (current.status === "voided") return current;

			const currentEntries = Option.getOrThrow(current.entries);
			const accountIds = [...new Set(currentEntries.map(entry => entry.accountId.toString()))].sort();
			const accounts = yield* this.readAccounts(organizationId, ledgerId, accountIds);
			const transaction = yield* current.toVoided(updated as DateTime<true>);
			const entries = Option.getOrThrow(transaction.entries);
			const withoutCurrentEntries = this.removeEntriesFromAccounts(
				accounts,
				currentEntries,
				transaction.updated
			);
			const updatedAccounts = yield* this.applyEntriesToAccounts(
				withoutCurrentEntries,
				entries,
				transaction.updated
			);

			yield* this.db.transaction(tx =>
				this.writeTransaction(tx, current, transaction).pipe(
					Effect.andThen(this.writeEntryStatus(tx, transaction)),
					Effect.andThen(this.writeAccounts(tx, organizationId, ledgerId, accounts, updatedAccounts))
				)
			);

			return transaction;
		}).pipe(Effect.mapError(mapTransactionMutationError));
	}

	/**
	 * Reads a Transaction and fails when the tenant-scoped record does not exist.
	 *
	 * @param organizationId - Organization that owns the Transaction.
	 * @param ledgerId - Ledger that contains the Transaction.
	 * @param transactionId - Transaction to read.
	 * @returns An Effect containing the required Transaction.
	 */
	private readTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	) {
		return this.getTransaction(organizationId, ledgerId, transactionId).pipe(
			Effect.flatMap(requireTransaction)
		);
	}

	/**
	 * Reads and decodes every required Account in deterministic identifier order.
	 *
	 * @param organizationId - Organization that owns the Accounts.
	 * @param ledgerId - Ledger that contains the Accounts.
	 * @param accountIds - Distinct Account identifiers required by the mutation.
	 * @returns An Effect containing Accounts indexed by identifier, or an Account-not-found failure.
	 */
	private readAccounts(organizationId: OrgID, ledgerId: LedgerID, accountIds: readonly string[]) {
		return this.db
			.select()
			.from(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					inArray(LedgerAccountsTable.id, accountIds)
				)
			)
			.orderBy(asc(LedgerAccountsTable.id))
			.pipe(
				Effect.flatMap(rows => Effect.all(rows.map(row => LedgerAccount.fromRow(row)))),
				Effect.map(
					accounts =>
						new Map<string, LedgerAccount>(
							accounts.map(account => {
								const value = Option.getOrThrow(account);
								return [value.id.toString(), value] as const;
							})
						)
				),
				Effect.flatMap(accounts =>
					requireAccount(accountIds.every(accountId => accounts.has(accountId)) ? accounts : undefined)
				)
			);
	}

	/**
	 * Applies each Entry to its Account and calculates new in-memory Account projections.
	 *
	 * This method does not persist the calculated Accounts.
	 *
	 * @param accounts - Current Accounts indexed by identifier.
	 * @param entries - Entries to apply in their supplied order.
	 * @param updated - Update time assigned to each calculated Account.
	 * @returns An Effect containing a new Account map, or a Currency mismatch failure.
	 */
	private applyEntriesToAccounts(
		accounts: AccountsById,
		entries: readonly LedgerTransactionEntry[],
		updated: DateTime
	) {
		return Effect.reduce(
			entries,
			() => new Map(accounts),
			(updatedAccounts, entry) =>
				updatedAccounts
					.get(entry.accountId.toString())!
					.record(entry, updated as DateTime<true>)
					.pipe(
						Effect.map(account => {
							updatedAccounts.set(entry.accountId.toString(), account);
							return updatedAccounts;
						})
					)
		);
	}

	/**
	 * Removes each Entry's effects and calculates new in-memory Account projections.
	 *
	 * This method does not persist the calculated Accounts.
	 *
	 * @param accounts - Current Accounts indexed by identifier.
	 * @param entries - Previously applied Entries to remove.
	 * @param updated - Update time assigned to each calculated Account.
	 * @returns A new Account map with the Entry effects removed.
	 */
	private removeEntriesFromAccounts(
		accounts: AccountsById,
		entries: readonly LedgerTransactionEntry[],
		updated: DateTime
	): AccountsById {
		const updatedAccounts = new Map(accounts);
		for (const entry of entries) {
			const accountId = entry.accountId.toString();
			updatedAccounts.set(
				accountId,
				updatedAccounts.get(accountId)!.remove(entry, updated as DateTime<true>)
			);
		}
		return updatedAccounts;
	}

	/**
	 * Persists mutable Transaction fields using its current lock version.
	 *
	 * @param tx - Database transaction that owns the mutation.
	 * @param current - Stored Transaction whose lock version must still match.
	 * @param transaction - New Transaction state to persist.
	 * @returns An Effect that completes after exactly one Transaction is updated.
	 */
	private writeTransaction(
		tx: DatabaseTransaction,
		current: LedgerTransaction,
		transaction: LedgerTransaction
	) {
		const row = transaction.toRow();
		return tx
			.update(LedgerTransactionsTable)
			.set({
				status: row.status,
				description: row.description,
				metadata: row.metadata,
				postedAt: row.postedAt,
				lockVersion: row.lockVersion,
				updated: row.updated,
			})
			.where(
				and(
					eq(LedgerTransactionsTable.organizationId, current.organizationId.toString()),
					eq(LedgerTransactionsTable.ledgerId, current.ledgerId.toString()),
					eq(LedgerTransactionsTable.id, current.id.toString()),
					eq(LedgerTransactionsTable.lockVersion, current.lockVersion)
				)
			)
			.returning({ id: LedgerTransactionsTable.id })
			.pipe(Effect.flatMap(rows => requireTransactionWrite(rows.length === 1)));
	}

	/**
	 * Replaces all persisted Entries for a Transaction inside the current database transaction.
	 *
	 * @param tx - Database transaction that owns the mutation.
	 * @param transaction - Transaction that owns the replacement Entries.
	 * @param entries - Complete replacement Entry set.
	 * @returns An Effect that deletes the existing Entries and inserts their replacements.
	 */
	private replaceEntries(
		tx: DatabaseTransaction,
		transaction: LedgerTransaction,
		entries: readonly LedgerTransactionEntry[]
	) {
		return tx
			.delete(LedgerTransactionEntriesTable)
			.where(
				and(
					eq(LedgerTransactionEntriesTable.organizationId, transaction.organizationId.toString()),
					eq(LedgerTransactionEntriesTable.ledgerId, transaction.ledgerId.toString()),
					eq(LedgerTransactionEntriesTable.transactionId, transaction.id.toString())
				)
			)
			.pipe(
				Effect.andThen(
					tx.insert(LedgerTransactionEntriesTable).values(entries.map(entry => entry.toRow(transaction)))
				)
			);
	}

	/**
	 * Synchronizes every persisted Entry status with its owning Transaction.
	 *
	 * @param tx - Database transaction that owns the mutation.
	 * @param transaction - Transaction whose status is copied to its Entries.
	 * @returns An Effect that updates all Entries owned by the Transaction.
	 */
	private writeEntryStatus(tx: DatabaseTransaction, transaction: LedgerTransaction) {
		return tx
			.update(LedgerTransactionEntriesTable)
			.set({ status: transaction.status })
			.where(
				and(
					eq(LedgerTransactionEntriesTable.organizationId, transaction.organizationId.toString()),
					eq(LedgerTransactionEntriesTable.ledgerId, transaction.ledgerId.toString()),
					eq(LedgerTransactionEntriesTable.transactionId, transaction.id.toString())
				)
			);
	}

	/**
	 * Persists calculated Account projections with optimistic lock checks.
	 *
	 * Accounts are written serially in identifier order. Each write increments the stored lock version
	 * and must match the version read before the database transaction began.
	 *
	 * @param tx - Database transaction that owns the mutation.
	 * @param organizationId - Organization that owns the Accounts.
	 * @param ledgerId - Ledger that contains the Accounts.
	 * @param accounts - Original Accounts and lock versions read for the mutation.
	 * @param updatedAccounts - Calculated Account states to persist.
	 * @returns An Effect that completes after every Account is updated exactly once.
	 */
	private writeAccounts(
		tx: DatabaseTransaction,
		organizationId: OrgID,
		ledgerId: LedgerID,
		accounts: AccountsById,
		updatedAccounts: AccountsById
	) {
		return Effect.forEach(
			[...accounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
			([accountId, account]) => {
				const updated = updatedAccounts.get(accountId)!;
				return tx
					.update(LedgerAccountsTable)
					.set({
						pendingAmount: updated.pendingAmount,
						postedAmount: updated.postedAmount,
						availableAmount: updated.availableAmount,
						pendingCredits: updated.pendingCredits,
						pendingDebits: updated.pendingDebits,
						postedCredits: updated.postedCredits,
						postedDebits: updated.postedDebits,
						availableCredits: updated.availableCredits,
						availableDebits: updated.availableDebits,
						lockVersion: account.lockVersion + 1,
						updated: updated.updated.toJSDate(),
					})
					.where(
						and(
							eq(LedgerAccountsTable.organizationId, organizationId.toString()),
							eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
							eq(LedgerAccountsTable.id, accountId),
							eq(LedgerAccountsTable.lockVersion, account.lockVersion)
						)
					)
					.returning({ id: LedgerAccountsTable.id })
					.pipe(Effect.flatMap(rows => requireAccountWrite(rows.length === 1)));
			},
			{ concurrency: 1, discard: true }
		);
	}
}

const ledgerTransactionRepoLayer = Layer.effect(
	LedgerTransactionRepoTag,
	DatabaseTag.pipe(Effect.map(database => new LedgerTransactionRepoLive(database.effectDb)))
);

export type {
	LedgerTransactionCreateRepositoryError,
	LedgerTransactionRepo,
	LedgerTransactionTransitionRepositoryError,
	LedgerTransactionUpdateRepositoryError,
};
export { LedgerTransactionRepoLive, LedgerTransactionRepoTag, ledgerTransactionRepoLayer };
