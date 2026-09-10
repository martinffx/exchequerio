import { encodeUuid } from "@/lib/utils";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";
import { TypeID } from "typeid-js";

import { ConflictError } from "@/lib/errors";
import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import {
	AccountNotFound,
	AccountVersionConflict,
	LedgerAccount,
	LedgerAccountAssetMismatch,
	requireAccount,
	requireAccountWrite,
} from "@/domains/ledgers/accounts";
import type {
	LedgerAccountSettlementID,
	LedgerID,
	LedgerTransactionEntryID,
	LedgerTransactionID,
	OrgID,
} from "@/lib/ids";
import {
	AssetsTable,
	LedgerAccountSettlementsTable,
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "@/db/schema";

import { LedgerTransaction } from "./LedgerTransaction";
import type { LedgerTransactionEntry } from "./LedgerTransactionEntry";
import {
	TransactionSettlementConflict,
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
} from "./LedgerTransactionErrors";
import type {
	TransactionListQuery,
	ResolvedTransactionUpdateRequest,
} from "./LedgerTransactionSchema";

/** Failures returned while creating ordinary Transaction accounting. */
type LedgerTransactionCreateRepositoryError =
	| ConflictError
	| TransactionSettlementConflict
	| AccountNotFound
	| AccountVersionConflict
	| LedgerAccountAssetMismatch
	| TransactionConcurrencyFailure
	| TransactionInfrastructureError
	| TransactionValidationFailure;

/** Failures returned while changing Transaction accounting. */
type LedgerTransactionUpdateRepositoryError =
	| ConflictError
	| TransactionSettlementConflict
	| AccountNotFound
	| AccountVersionConflict
	| LedgerAccountAssetMismatch
	| TransactionConcurrencyFailure
	| TransactionInfrastructureError
	| TransactionLifecycleConflict
	| TransactionNotFound
	| TransactionValidationFailure
	| TransactionVersionConflict;

/** Failures returned by accounting lifecycle transitions. */
type LedgerTransactionTransitionRepositoryError = LedgerTransactionUpdateRepositoryError;

/**
 * Persists Transactions, their Entries, and the resulting Account projections.
 *
 * Expected failures are returned through each operation's Effect error channel.
 */
interface LedgerTransactionRepo {
	/**
	 * Loads a Settlement’s scoped accounting and ordered Entries.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param settlementId - Settlement owning the accounting.
	 * @returns An Effect containing optional accounting, or an infrastructure failure.
	 */
	getSettlementTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID
	): Effect.Effect<Option.Option<LedgerTransaction>, TransactionInfrastructureError>;
	/**
	 * Creates Settlement accounting, Entries, and Account projections atomically.
	 *
	 * @remarks
	 * Locks the Settlement before checking for existing accounting. The Settlement must
	 * be processing the requested initial status; finalization is a separate repository commit.
	 *
	 * @param transaction - Generated Transaction carrying its Settlement ID.
	 * @returns An Effect containing new or existing accounting, or a lifecycle/persistence failure.
	 */
	createSettlementTransaction(
		transaction: LedgerTransaction
	): Effect.Effect<LedgerTransaction, LedgerTransactionUpdateRepositoryError>;
	/**
	 * Posts accounting for a Settlement prepared for posting.
	 *
	 * @remarks
	 * Owns the database transaction and returns existing posted accounting on retry.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param settlementId - Settlement owning the accounting.
	 * @param now - Posting time.
	 * @returns An Effect containing posted accounting, or a lifecycle/persistence failure.
	 */
	postSettlementTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		now: DateTime
	): Effect.Effect<LedgerTransaction, LedgerTransactionUpdateRepositoryError>;
	/**
	 * Voids accounting for a Settlement prepared for voiding.
	 *
	 * @remarks
	 * Owns the database transaction. Source membership is released during Settlement finalization.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param settlementId - Settlement owning the accounting.
	 * @param now - Voiding time.
	 * @returns An Effect containing voided accounting, or a lifecycle/persistence failure.
	 */
	voidSettlementTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		now: DateTime
	): Effect.Effect<LedgerTransaction, LedgerTransactionUpdateRepositoryError>;

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
	 * @param transaction - Validated ordinary Transaction with its Entries loaded.
	 * @returns An Effect containing the created Transaction.
	 */
	createTransaction(
		transaction: LedgerTransaction
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
		request: ResolvedTransactionUpdateRequest,
		updated?: DateTime,
		entryIds?: readonly LedgerTransactionEntryID[]
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

/** Effect service key for Transaction persistence. */
const LedgerTransactionRepoTag = Context.Service<LedgerTransactionRepo>("LedgerTransactionRepo");

/** Database transaction owned by a Transaction repository mutation. */
type DatabaseTransaction = Parameters<Parameters<EffectDrizzleDatabase["transaction"]>[0]>[0];
/** Decoded Account projections indexed by Account ID. */
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
					eq(LedgerTransactionsTable.organizationId, encodeUuid(organizationId)),
					eq(LedgerTransactionsTable.ledgerId, encodeUuid(ledgerId))
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
				organizationId: encodeUuid(organizationId),
				ledgerId: encodeUuid(ledgerId),
				id: encodeUuid(transactionId),
			},
			with: {
				entries: {
					with: { asset: true },
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
	 * @param transaction - Validated ordinary Transaction with its Entries loaded.
	 * @returns An Effect containing the created Transaction.
	 */
	createTransaction(
		transaction: LedgerTransaction
	): Effect.Effect<LedgerTransaction, LedgerTransactionCreateRepositoryError> {
		if (transaction.settlementId !== undefined)
			return Effect.fail(new TransactionSettlementConflict());
		return this.db
			.transaction(tx => this.insertAccounting(tx, transaction))
			.pipe(Effect.mapError(mapTransactionCreateError));
	}

	/**
	 * Writes accounting and Account projections inside the current repository transaction.
	 *
	 * @param tx - Transaction owned by this repository.
	 * @param transaction - Validated Transaction with Entries loaded.
	 * @returns An Effect containing the Transaction, or an Account/persistence failure.
	 */
	private insertAccounting(tx: DatabaseTransaction, transaction: LedgerTransaction) {
		return Effect.gen({ self: this }, function* () {
			const entries = Option.getOrThrow(transaction.entries);
			const ids = [...new Set(entries.map(entry => entry.accountId.toString()))].sort();
			const accounts = yield* this.readAccounts(
				transaction.organizationId,
				transaction.ledgerId,
				ids,
				tx
			);
			const updated = yield* this.applyEntriesToAccounts(accounts, entries, transaction.updated);
			yield* tx.insert(LedgerTransactionsTable).values(transaction.toRow());
			yield* tx
				.insert(LedgerTransactionEntriesTable)
				.values(entries.map(entry => entry.toRow(transaction)));
			yield* this.writeAccounts(
				tx,
				transaction.organizationId,
				transaction.ledgerId,
				accounts,
				updated
			);
			return transaction;
		});
	}

	/**
	 * Loads a Settlement’s scoped accounting and ordered Entries.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param settlementId - Settlement owning the accounting.
	 * @returns An Effect containing optional accounting, or an infrastructure failure.
	 */
	getSettlementTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID
	) {
		return this.readSettlementAccounting(this.db, organizationId, ledgerId, settlementId).pipe(
			Effect.mapError(mapTransactionInfrastructureError)
		);
	}

	/**
	 * Queries and decodes scoped accounting with ordered Entries.
	 *
	 * @param db - Database or current repository transaction.
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param settlementId - Settlement owning the accounting.
	 * @returns An Effect containing optional accounting, or a query/decoding failure.
	 */
	private readSettlementAccounting(
		db: EffectDrizzleDatabase | DatabaseTransaction,
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID
	) {
		return db.query.LedgerTransactionsTable.findMany({
			where: {
				organizationId: encodeUuid(organizationId),
				ledgerId: encodeUuid(ledgerId),
				settlementId: encodeUuid(settlementId),
			},
			with: { entries: { with: { asset: true }, orderBy: { created: "asc", id: "asc" } } },
		}).pipe(Effect.flatMap(rows => LedgerTransaction.fromRows(rows)));
	}

	/**
	 * Locks the scoped Settlement before an accounting mutation.
	 *
	 * @param tx - Current repository transaction.
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param settlementId - Settlement owning the accounting.
	 * @returns An Effect containing the locked row, or a missing-row/query failure.
	 */
	private lockSettlement(
		tx: DatabaseTransaction,
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID
	) {
		return tx
			.select()
			.from(LedgerAccountSettlementsTable)
			.where(
				and(
					eq(LedgerAccountSettlementsTable.organizationId, encodeUuid(organizationId)),
					eq(LedgerAccountSettlementsTable.ledgerId, encodeUuid(ledgerId)),
					eq(LedgerAccountSettlementsTable.id, encodeUuid(settlementId))
				)
			)
			.for("update")
			.pipe(
				Effect.flatMap(rows =>
					rows[0] === undefined ? Effect.fail(new TransactionNotFound()) : Effect.succeed(rows[0])
				)
			);
	}

	/**
	 * Creates Settlement accounting, Entries, and Account projections atomically.
	 *
	 * @remarks
	 * Locks the Settlement before checking for existing accounting. The Settlement must
	 * be processing the requested initial status; finalization is a separate repository commit.
	 *
	 * @param transaction - Generated Transaction carrying its Settlement ID.
	 * @returns An Effect containing new or existing accounting, or a lifecycle/persistence failure.
	 */
	createSettlementTransaction(
		transaction: LedgerTransaction
	): Effect.Effect<LedgerTransaction, LedgerTransactionUpdateRepositoryError> {
		const settlementId = transaction.settlementId;
		if (settlementId === undefined) return Effect.fail(new TransactionSettlementConflict());
		return this.db
			.transaction(tx =>
				Effect.gen({ self: this }, function* () {
					const settlement = yield* this.lockSettlement(
						tx,
						transaction.organizationId,
						transaction.ledgerId,
						settlementId
					);
					const existing = yield* this.readSettlementAccounting(
						tx,
						transaction.organizationId,
						transaction.ledgerId,
						settlementId
					);
					if (Option.isSome(existing)) return existing.value;
					if (
						settlement.status !== "processing" ||
						settlement.targetStatus !== transaction.status ||
						transaction.status === "voided"
					) {
						return yield* Effect.fail(
							new TransactionLifecycleConflict(settlement.status, transaction.status)
						);
					}
					return yield* this.insertAccounting(tx, transaction);
				})
			)
			.pipe(Effect.mapError(mapTransactionMutationError));
	}

	/**
	 * Posts accounting for a Settlement prepared for posting.
	 *
	 * @remarks
	 * Owns the database transaction and returns existing posted accounting on retry.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param settlementId - Settlement owning the accounting.
	 * @param now - Posting time.
	 * @returns An Effect containing posted accounting, or a lifecycle/persistence failure.
	 */
	postSettlementTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		now: DateTime
	) {
		return this.transitionSettlementAccounting(organizationId, ledgerId, settlementId, "posted", now);
	}

	/**
	 * Voids accounting for a Settlement prepared for voiding.
	 *
	 * @remarks
	 * Owns the database transaction. Source membership is released during Settlement finalization.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param settlementId - Settlement owning the accounting.
	 * @param now - Voiding time.
	 * @returns An Effect containing voided accounting, or a lifecycle/persistence failure.
	 */
	voidSettlementTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		now: DateTime
	) {
		return this.transitionSettlementAccounting(organizationId, ledgerId, settlementId, "voided", now);
	}

	/**
	 * Changes accounting status and Account projections in one database transaction.
	 *
	 * @remarks
	 * Locks the Settlement, requires its matching processing target, and preserves
	 * optimistic concurrency checks on Transaction and Account writes.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Containing Ledger.
	 * @param settlementId - Settlement owning the accounting.
	 * @param target - Posted or voided accounting state.
	 * @param now - Transition time.
	 * @returns An Effect containing transitioned accounting, or a lifecycle/persistence failure.
	 */
	private transitionSettlementAccounting(
		organizationId: OrgID,
		ledgerId: LedgerID,
		settlementId: LedgerAccountSettlementID,
		target: "posted" | "voided",
		now: DateTime
	): Effect.Effect<LedgerTransaction, LedgerTransactionUpdateRepositoryError> {
		return this.db
			.transaction(tx =>
				Effect.gen({ self: this }, function* () {
					const settlement = yield* this.lockSettlement(tx, organizationId, ledgerId, settlementId);
					const current = yield* this.readSettlementAccounting(
						tx,
						organizationId,
						ledgerId,
						settlementId
					).pipe(Effect.flatMap(requireTransaction));
					if (current.status === target) return current;
					if (settlement.status !== "processing" || settlement.targetStatus !== target)
						return yield* Effect.fail(new TransactionLifecycleConflict(settlement.status, target));
					const next = yield* target === "posted" ? current.toPosted(now) : current.toVoided(now);
					const entries = Option.getOrThrow(current.entries);
					const ids = [...new Set(entries.map(entry => entry.accountId.toString()))].sort();
					const accounts = yield* this.readAccounts(organizationId, ledgerId, ids, tx);
					const without = this.removeEntriesFromAccounts(accounts, entries, now);
					const updated = yield* this.applyEntriesToAccounts(
						without,
						Option.getOrThrow(next.entries),
						now
					);
					yield* this.writeTransaction(tx, current, next);
					yield* this.writeEntryStatus(tx, next);
					yield* this.writeAccounts(tx, organizationId, ledgerId, accounts, updated);
					return next;
				})
			)
			.pipe(Effect.mapError(mapTransactionMutationError));
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
		request: ResolvedTransactionUpdateRequest,
		updated = DateTime.utc(),
		entryIds?: readonly LedgerTransactionEntryID[]
	): Effect.Effect<LedgerTransaction, LedgerTransactionUpdateRepositoryError> {
		return Effect.gen({ self: this }, function* () {
			const current = yield* this.readTransaction(organizationId, ledgerId, transactionId);
			if (current.settlementId !== undefined)
				return yield* Effect.fail(new TransactionSettlementConflict());
			const currentEntries = Option.getOrThrow(current.entries);
			const accountIds = [
				...new Set([
					...currentEntries.map(entry => entry.accountId.toString()),
					...request.ledgerEntries.map(entry => entry.accountId),
				]),
			].sort();
			const accounts = yield* this.readAccounts(organizationId, ledgerId, accountIds);
			const transaction = yield* current.fromUpdateRequest(request, updated, entryIds);
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
			if (current.settlementId !== undefined)
				return yield* Effect.fail(new TransactionSettlementConflict());
			if (current.status === "posted") return current;

			const currentEntries = Option.getOrThrow(current.entries);
			const accountIds = [...new Set(currentEntries.map(entry => entry.accountId.toString()))].sort();
			const accounts = yield* this.readAccounts(organizationId, ledgerId, accountIds);
			const transaction = yield* current.toPosted(postedAt);
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
			if (current.settlementId !== undefined)
				return yield* Effect.fail(new TransactionSettlementConflict());
			if (current.status === "voided") return current;

			const currentEntries = Option.getOrThrow(current.entries);
			const accountIds = [...new Set(currentEntries.map(entry => entry.accountId.toString()))].sort();
			const accounts = yield* this.readAccounts(organizationId, ledgerId, accountIds);
			const transaction = yield* current.toVoided(updated);
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
	private readAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountIds: readonly string[],
		db: EffectDrizzleDatabase | DatabaseTransaction = this.db
	) {
		return db
			.select()
			.from(LedgerAccountsTable)
			.innerJoin(
				AssetsTable,
				and(
					eq(AssetsTable.id, LedgerAccountsTable.assetId),
					eq(AssetsTable.organizationId, LedgerAccountsTable.organizationId)
				)
			)
			.where(
				and(
					eq(LedgerAccountsTable.organizationId, encodeUuid(organizationId)),
					eq(LedgerAccountsTable.ledgerId, encodeUuid(ledgerId)),
					inArray(
						LedgerAccountsTable.id,
						accountIds.map(id => encodeUuid(TypeID.fromString(id, "lat")))
					)
				)
			)
			.orderBy(asc(LedgerAccountsTable.id))
			.pipe(
				Effect.flatMap(rows =>
					Effect.all(
						rows.map(row =>
							LedgerAccount.fromRow(row.ledger_accounts, {
								assetId: row.assets.id,
								assetCode: row.assets.code,
								minorUnitExponent: row.assets.minorUnitExponent,
							})
						)
					)
				),
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
	 * @returns An Effect containing a new Account map, or an Asset mismatch failure.
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
					.record(entry, updated)
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
			updatedAccounts.set(accountId, updatedAccounts.get(accountId)!.remove(entry, updated));
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
				effectiveAt: row.effectiveAt,
				lockVersion: row.lockVersion,
				updated: row.updated,
			})
			.where(
				and(
					eq(LedgerTransactionsTable.organizationId, encodeUuid(current.organizationId)),
					eq(LedgerTransactionsTable.ledgerId, encodeUuid(current.ledgerId)),
					eq(LedgerTransactionsTable.id, encodeUuid(current.id)),
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
					eq(LedgerTransactionEntriesTable.organizationId, encodeUuid(transaction.organizationId)),
					eq(LedgerTransactionEntriesTable.ledgerId, encodeUuid(transaction.ledgerId)),
					eq(LedgerTransactionEntriesTable.transactionId, encodeUuid(transaction.id))
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
					eq(LedgerTransactionEntriesTable.organizationId, encodeUuid(transaction.organizationId)),
					eq(LedgerTransactionEntriesTable.ledgerId, encodeUuid(transaction.ledgerId)),
					eq(LedgerTransactionEntriesTable.transactionId, encodeUuid(transaction.id))
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
				return Effect.try({
					try: () => updated.assertBalancesInRange(),
					catch: cause => cause as ConflictError,
				}).pipe(
					Effect.andThen(
						tx
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
									eq(LedgerAccountsTable.organizationId, encodeUuid(organizationId)),
									eq(LedgerAccountsTable.ledgerId, encodeUuid(ledgerId)),
									eq(LedgerAccountsTable.id, encodeUuid(account.id)),
									eq(LedgerAccountsTable.lockVersion, account.lockVersion)
								)
							)
							.returning({ id: LedgerAccountsTable.id })
							.pipe(Effect.flatMap(rows => requireAccountWrite(rows.length === 1)))
					)
				);
			},
			{ concurrency: 1, discard: true }
		);
	}
}

/** Constructs Transaction persistence from the application’s Effect-enabled database. */
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
