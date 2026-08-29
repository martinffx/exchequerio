import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import type { DateTime } from "luxon";

import { DatabaseTag, type EffectDrizzleDatabase } from "@/db";
import {
	AccountNotFound,
	AccountVersionConflict,
	requireAccount,
	requireAccountWrite,
} from "@/ledgers/accounts/AccountErrors";
import {
	LedgerAccount,
	LedgerAccountCurrencyMismatch,
} from "@/ledgers/accounts/domain/LedgerAccount";
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

interface LedgerTransactionRepo {
	listTransactions(
		organizationId: OrgID,
		ledgerId: LedgerID,
		query: TransactionListQuery
	): Effect.Effect<LedgerTransaction[], TransactionInfrastructureError>;
	getTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Effect.Effect<Option.Option<LedgerTransaction>, TransactionInfrastructureError>;
	createTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionCreateRequest
	): Effect.Effect<LedgerTransaction, LedgerTransactionCreateRepositoryError>;
	updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		request: TransactionUpdateRequest
	): Effect.Effect<LedgerTransaction, LedgerTransactionUpdateRepositoryError>;
	postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		postedAt: DateTime
	): Effect.Effect<LedgerTransaction, LedgerTransactionTransitionRepositoryError>;
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
class LedgerTransactionRepoLive implements LedgerTransactionRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}

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
			const updatedAccounts = yield* this.recordEntries(accounts, entries, transaction.updated);

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
			const withoutCurrentEntries = this.removeEntries(accounts, currentEntries, transaction.updated);
			const updatedAccounts = yield* this.recordEntries(
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
			const withoutCurrentEntries = this.removeEntries(accounts, currentEntries, transaction.updated);
			const updatedAccounts = yield* this.recordEntries(
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
			const withoutCurrentEntries = this.removeEntries(accounts, currentEntries, transaction.updated);
			const updatedAccounts = yield* this.recordEntries(
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

	private readTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	) {
		return this.getTransaction(organizationId, ledgerId, transactionId).pipe(
			Effect.flatMap(requireTransaction)
		);
	}

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

	private recordEntries(
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

	private removeEntries(
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
			.pipe(
				Effect.flatMap(rows => requireTransactionWrite(rows.length === 1))
			);
	}

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
					.pipe(
						Effect.flatMap(rows => requireAccountWrite(rows.length === 1))
					);
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
