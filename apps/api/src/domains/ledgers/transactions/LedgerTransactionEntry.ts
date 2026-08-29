import { Effect } from "effect";
import { DateTime } from "luxon";

import { encodeMetadata, parseDate, parseId, parseMetadata } from "@/lib/utils";
import {
	newLedgerTransactionEntryID,
	type LedgerAccountID,
	type LedgerID,
	type LedgerTransactionEntryID,
	type LedgerTransactionID,
	type OrgID,
} from "@/repo/entities/types";
import type { LedgerTransactionEntryInsertRow, LedgerTransactionEntryRow } from "@/repo/schema";

import { TransactionValidationFailure } from "./LedgerTransactionErrors";
import type { TransactionRequestEntry as LedgerTransactionEntryRequest } from "./LedgerTransactionSchema";

type LedgerTransactionEntryDirection = "debit" | "credit";
type LedgerTransactionEntryStatus = "pending" | "posted" | "voided";
type LedgerTransactionEntryMetadata = Readonly<Record<string, string>>;

type LedgerTransactionEntryOptions = Readonly<{
	id: LedgerTransactionEntryID;
	accountId: LedgerAccountID;
	direction: LedgerTransactionEntryDirection;
	amount: number;
	currency: string;
	status: LedgerTransactionEntryStatus;
	metadata?: LedgerTransactionEntryMetadata;
	created: DateTime;
}>;

type LedgerTransactionEntryParent = Readonly<{
	id: LedgerTransactionID;
	organizationId: OrgID;
	ledgerId: LedgerID;
}>;

/**
 * One debit or credit Amount on one Ledger Account within a Ledger Transaction.
 *
 * An Entry shares its parent Transaction's lifecycle and has no independent status changes.
 */
class LedgerTransactionEntry {
	readonly id: LedgerTransactionEntryID;
	readonly accountId: LedgerAccountID;
	readonly direction: LedgerTransactionEntryDirection;
	readonly amount: number;
	readonly currency: string;
	readonly status: LedgerTransactionEntryStatus;
	readonly metadata?: LedgerTransactionEntryMetadata;
	readonly created: DateTime;

	private constructor(options: LedgerTransactionEntryOptions) {
		this.id = options.id;
		this.accountId = options.accountId;
		this.direction = options.direction;
		this.amount = options.amount;
		this.currency = options.currency;
		this.status = options.status;
		this.metadata = options.metadata;
		this.created = options.created;
	}

	/**
	 * Creates an Entry from a validated API request and its parent Transaction state.
	 *
	 * @param request - TypeBox-validated Entry request.
	 * @param status - Status inherited from the parent Transaction.
	 * @param created - Creation time; defaults to the current UTC time and may be supplied by tests.
	 * @returns An Effect containing the Entry or an invalid Account identifier failure.
	 */
	static fromRequest(
		request: LedgerTransactionEntryRequest,
		status: LedgerTransactionEntryStatus,
		created = DateTime.utc()
	): Effect.Effect<LedgerTransactionEntry, TransactionValidationFailure> {
		return parseId<"lat", LedgerAccountID>("lat", request.accountId).pipe(
			Effect.mapError(
				() => new TransactionValidationFailure(`Invalid Account ID: ${request.accountId}`)
			),
			Effect.map(
				accountId =>
					new LedgerTransactionEntry({
						id: newLedgerTransactionEntryID(),
						accountId,
						direction: request.direction,
						amount: request.amount,
						currency: request.currencyCode,
						status,
						metadata: request.metadata,
						created,
					})
			)
		);
	}

	/**
	 * Hydrates an Entry from its Drizzle row.
	 *
	 * @param row - Entry row inferred from the Drizzle schema.
	 * @returns An Effect containing the Entry or a persistence decoding error.
	 */
	static fromRow(row: LedgerTransactionEntryRow): Effect.Effect<LedgerTransactionEntry, Error> {
		return Effect.all({
			id: parseId<"lte", LedgerTransactionEntryID>("lte", row.id),
			accountId: parseId<"lat", LedgerAccountID>("lat", row.accountId),
			metadata: parseMetadata(row.metadata),
			created: parseDate(row.created),
		}).pipe(
			Effect.map(
				decoded =>
					new LedgerTransactionEntry({
						...decoded,
						direction: row.direction,
						amount: row.amount,
						currency: row.currency,
						status: row.status,
					})
			)
		);
	}

	/**
	 * Converts the Entry to its Drizzle persistence representation.
	 *
	 * @param transaction - Parent identifiers required by the Entry row.
	 * @returns The Entry's Drizzle persistence representation.
	 */
	toRow(transaction: LedgerTransactionEntryParent): LedgerTransactionEntryInsertRow {
		return {
			id: this.id.toString(),
			transactionId: transaction.id.toString(),
			accountId: this.accountId.toString(),
			organizationId: transaction.organizationId.toString(),
			ledgerId: transaction.ledgerId.toString(),
			direction: this.direction,
			amount: this.amount,
			currency: this.currency,
			status: this.status,
			metadata: encodeMetadata(this.metadata),
			created: this.created.toJSDate(),
		};
	}

	/** @returns The Entry with the posted status inherited from its Transaction. */
	toPosted(): LedgerTransactionEntry {
		return new LedgerTransactionEntry({ ...this, status: "posted" });
	}

	/** @returns The Entry with the voided status inherited from its Transaction. */
	toVoided(): LedgerTransactionEntry {
		return new LedgerTransactionEntry({ ...this, status: "voided" });
	}
}

export type {
	LedgerTransactionEntryDirection,
	LedgerTransactionEntryMetadata,
	LedgerTransactionEntryOptions,
	LedgerTransactionEntryStatus,
};
export { LedgerTransactionEntry };
