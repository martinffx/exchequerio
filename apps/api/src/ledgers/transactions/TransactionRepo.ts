import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DateTime } from "luxon";

import { DatabaseTag, type DrizzleDatabase, isPostgresUnavailable } from "@/db";
import { makeCurrency } from "@/ledgers/accounts";
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

import { Entry, Transaction } from "./domain/Transaction";
import {
	type TransactionInfrastructureError,
	TransactionPersistenceDecodingFailure,
	TransactionPersistenceFailure,
	TransactionRepositoryUnavailable,
} from "./TransactionErrors";

type TransactionListQuery = {
	readonly offset: number;
	readonly limit: number;
};

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

export type { TransactionListQuery, TransactionRepo };
export { TransactionRepoLive, TransactionRepoTag, transactionRepoLayer };
