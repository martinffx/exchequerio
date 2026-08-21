import { Effect, Option } from "effect";
import { DateTime } from "luxon";

import type { Currency } from "@/ledgers/accounts";
import { parseDate, parseId, parseMetadata } from "@/lib/utils";
import type { LedgerAccountID, LedgerID, LedgerTransactionID, OrgID } from "@/repo/entities/types";
import type { LedgerTransactionCreateRow, LedgerTransactionsTable } from "@/repo/schema";

import {
	TransactionLifecycleConflict,
	TransactionPersistenceDecodingFailure,
	TransactionValidationFailure,
} from "../TransactionErrors";
import {
	TransactionEntry,
	type TransactionEntryPersistenceRow,
	type TransactionEntryRequest,
} from "./TransactionEntry";
import type { TransactionCreateRequest, TransactionUpdateRequest } from "../TransactionSchema";

type TransactionStatus = "pending" | "posted" | "voided";
type Metadata = Readonly<Record<string, string>>;

type TransactionOptions = Readonly<{
  id: LedgerTransactionID;
  organizationId: OrgID;
  ledgerId: LedgerID;
  status: TransactionStatus;
  description?: string;
  metadata?: Metadata;
  entries: Option.Option<readonly TransactionEntry[]>;
  postedAt?: DateTime;
  lockVersion: number;
  created: DateTime;
  updated: DateTime;
}>

class Transaction {
	readonly id: LedgerTransactionID;
	readonly organizationId: OrgID;
	readonly ledgerId: LedgerID;
	readonly status: TransactionStatus;
	readonly description?: string;
	readonly metadata?: Metadata;
	readonly entries: Option.Option<readonly TransactionEntry[]>;
	readonly postedAt?: DateTime;
	readonly lockVersion: number;
	readonly created: DateTime;
	readonly updated: DateTime;

	private constructor(options: TransactionOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.status = options.status;
		this.description = options.description;
		this.metadata = options.metadata;
		this.entries = options.entries;
		this.postedAt = options.postedAt;
		this.lockVersion = options.lockVersion;
		this.created = options.created;
		this.updated = options.updated;
	}

	private static validate(
		options: TransactionOptions
	): Effect.Effect<void, TransactionValidationFailure> {
		return Effect.try({
			try: () => {
				if (options.status === "posted" && options.postedAt === undefined) {
					throw new TransactionValidationFailure("Posted Transaction requires Posted Time");
				}
				if (options.status !== "posted" && options.postedAt !== undefined) {
					throw new TransactionValidationFailure("Only a Posted Transaction may have Posted Time");
				}
				if (!Number.isSafeInteger(options.lockVersion) || options.lockVersion < 1) {
					throw new TransactionValidationFailure("Transaction lock version must be a positive safe integer");
				}
				for (const [name, value] of [
					["Posted Time", options.postedAt],
					["Created Time", options.created],
					["Updated Time", options.updated],
				] as const) {
					if (value !== undefined && (!DateTime.isDateTime(value) || !value.isValid)) {
						throw new TransactionValidationFailure(`${name} must be a valid DateTime`);
					}
				}

				Option.match(options.entries, {
					onNone: () => undefined,
					onSome: entries => {
						const totals = new Map<string, number>();
						for (const entry of entries) {
							let total = totals.get(entry.currency) ?? 0;
							if (entry.direction === "debit") {
								total += entry.amount
							} else {
							  total -= entry.amount
							}
							totals.set(entry.currency, total);
						}
						for (const [currencyCode, total] of totals) {
							if (total !== 0) {
								throw new TransactionValidationFailure(`Transaction Entries must balance for ${currencyCode}`);
							}
						}
					},
				});
			},
			catch: cause =>
				cause instanceof TransactionValidationFailure
					? cause
					: new TransactionValidationFailure("Transaction is invalid"),
		});
	}

	private static decodeOptions(
		row: TransactionPersistenceRow,
		entries: Option.Option<readonly TransactionEntry[]>
	) {
		return Effect.all({
			id: parseId<"ltr", LedgerTransactionID>("ltr", row.id),
			organizationId: parseId<"org", OrgID>("org", row.organizationId),
			ledgerId: parseId<"lgr", LedgerID>("lgr", row.ledgerId),
			status: parseStatus(row.status),
			metadata: parseMetadata(row.metadata),
			postedAt: row.postedAt === null ? Effect.succeed(undefined) : parseDate(row.postedAt),
			lockVersion: parseLockVersion(row.lockVersion),
			created: parseDate(row.created),
			updated: parseDate(row.updated),
		}).pipe(
			Effect.map(decoded => ({
				...decoded,
				description: row.description ?? undefined,
				entries,
			}))
		);
	}

	static fromRequest(
		id: LedgerTransactionID,
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: TransactionCreateRequest,
	): Effect.Effect<Transaction, TransactionValidationFailure> {
		const created = DateTime.utc();
		return Effect.all(
			request.ledgerEntries.map(entry => TransactionEntry.fromRequest(entry))
		).pipe(
			Effect.flatMap(entries => {
				const options: TransactionOptions = {
					id,
					organizationId,
					ledgerId,
					status: request.status,
					description: request.description,
					metadata: request.metadata,
					// oxlint-disable-next-line unicorn/no-array-callback-reference
					entries: Option.some(entries),
					postedAt: request.status === "posted" ? created : undefined,
					lockVersion: 1,
					created,
					updated: created,
				};
				return Transaction.validate(options).pipe(Effect.map(() => new Transaction(options)));
			})
		);
	}

	static fromRow(
		row: TransactionPersistenceRow
	): Effect.Effect<Transaction, TransactionPersistenceDecodingFailure> {
		return Transaction.decodeOptions(row, Option.none()).pipe(
			Effect.tap(options => Transaction.validate(options)),
			Effect.map(options => new Transaction(options)),
			Effect.mapError(cause => new TransactionPersistenceDecodingFailure(cause))
		);
	}

	static fromRows(
		rows: readonly TransactionJoinedPersistenceRow[]
	): Effect.Effect<Option.Option<Transaction>, TransactionPersistenceDecodingFailure> {
		const first = rows[0];
		if (first === undefined) return Effect.succeed(Option.none());

		return Effect.all(
			rows.flatMap(row => {
				const entry = row.entry;
				if (entry.id === null) return [];
				if (
					entry.transactionId === null ||
					entry.accountId === null ||
					entry.direction === null ||
					entry.amount === null ||
					entry.currencyCode === null ||
					entry.minorUnitExponent === null
				) {
					return [Effect.fail(new Error("Incomplete persisted Transaction Entry"))];
				}
				return [
					TransactionEntry.fromRow({
						id: entry.id,
						transactionId: entry.transactionId,
						accountId: entry.accountId,
						direction: entry.direction,
						amount: entry.amount,
						metadata: entry.metadata,
						currencyCode: entry.currencyCode,
						minorUnitExponent: entry.minorUnitExponent,
					}),
				];
			})
		).pipe(
			Effect.flatMap(entries => Transaction.decodeOptions(first.transaction, some(entries))),
			Effect.tap(options => Transaction.validate(options)),
			Effect.map(options => some(new Transaction(options))),
			Effect.mapError(cause => new TransactionPersistenceDecodingFailure(cause))
		);
	}

	toRow(): LedgerTransactionCreateRow {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			ledgerId: this.ledgerId.toString(),
			status: this.status,
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			description: this.description ?? null,
			metadata: this.metadata === undefined ? undefined : JSON.stringify(this.metadata),
			// eslint-disable-next-line unicorn/no-null -- Drizzle represents SQL NULL as null.
			postedAt: this.postedAt?.toJSDate() ?? null,
			lockVersion: this.lockVersion,
			created: this.created.toJSDate(),
			updated: this.updated.toJSDate(),
		};
	}

	post(): Effect.Effect<
		Transaction,
		TransactionLifecycleConflict | TransactionValidationFailure
	> {
    if (this.status === "posted") this;
		if (this.status !== "pending") {
			return Effect.fail(
				new TransactionLifecycleConflict(this.id.toString(), this.status, "posted", this.errorContext)
			);
    }

    return Effect.succeed(new Transaction({
      id: this.id,
    		organizationId: this.organizationId,
    		ledgerId: this.ledgerId,
    		status: "posted",
    		description: this.description,
    		metadata: this.metadata,
    		entries: this.entries,
    		postedAt: DateTime.utc(),
    		lockVersion: this.lockVersion,
    		created: this.created,
    		updated: DateTime.utc(),
    }))
	}

	void(): Effect.Effect<
		Transaction,
		TransactionLifecycleConflict | TransactionValidationFailure
	> {
    if (this.status === "voided") return Effect.succeed(this);
		if (this.status !== "pending") {
			return Effect.fail(
				new TransactionLifecycleConflict(this.id.toString(), this.status, "voided", this.errorContext)
			);
    }

    return Effect.succeed(new Transaction({
      id: this.id,
    		organizationId: this.organizationId,
    		ledgerId: this.ledgerId,
    		status: "voided",
    		description: this.description,
    		metadata: this.metadata,
    		entries: this.entries,
    		postedAt: this.postedAt,
    		lockVersion: this.lockVersion,
    		created: this.created,
    		updated: DateTime.utc(),
    }))
	}

}

export type {
	TransactionStatus,
};
export { Transaction };
