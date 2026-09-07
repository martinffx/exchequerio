import { TypeID } from "typeid-js";
import { Effect } from "effect";
import { DateTime } from "luxon";

import { parseAmount } from "@/lib/amounts";
import type { AssetSummary } from "@/lib/AssetSchema";
import type { Metadata } from "@/lib/schema";
import {
	encodeUuid,
	encodeMetadata,
	parseDate,
	parseId,
	parseUuid,
	parseMetadata,
} from "@/lib/utils";
import {
	newLedgerTransactionEntryID,
	type LedgerAccountID,
	type LedgerID,
	type LedgerTransactionEntryID,
	type LedgerTransactionID,
	type OrgID,
} from "@/lib/ids";
import type { LedgerTransactionEntryInsertRow, LedgerTransactionEntryRow } from "@/db/schema";

import { TransactionValidationFailure } from "./LedgerTransactionErrors";
import type {
	ResolvedTransactionRequestEntry as LedgerTransactionEntryRequest,
	TransactionResponseEntry,
} from "./LedgerTransactionSchema";

type LedgerTransactionEntryDirection = "debit" | "credit";
type LedgerTransactionEntryStatus = "pending" | "posted" | "voided";
type LedgerTransactionEntryOptions = Readonly<{
	id: LedgerTransactionEntryID;
	accountId: LedgerAccountID;
	direction: LedgerTransactionEntryDirection;
	amount: bigint;
	assetId: string;
	assetCode: string;
	minorUnitExponent: number;
	status: LedgerTransactionEntryStatus;
	metadata?: Metadata;
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
	readonly amount: bigint;
	readonly assetId: string;
	readonly assetCode: string;
	readonly minorUnitExponent: number;
	readonly status: LedgerTransactionEntryStatus;
	readonly metadata?: Metadata;
	readonly created: DateTime;

	private constructor(options: LedgerTransactionEntryOptions) {
		this.id = options.id;
		this.accountId = options.accountId;
		this.direction = options.direction;
		this.amount = options.amount;
		this.assetId = options.assetId;
		this.assetCode = options.assetCode;
		this.minorUnitExponent = options.minorUnitExponent;
		this.status = options.status;
		this.metadata = options.metadata;
		this.created = options.created;
	}

	static create(options: LedgerTransactionEntryOptions): LedgerTransactionEntry {
		return new LedgerTransactionEntry(options);
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
		created: DateTime = DateTime.utc(),
		id = newLedgerTransactionEntryID()
	): Effect.Effect<LedgerTransactionEntry, TransactionValidationFailure> {
		return parseId<"lat", LedgerAccountID>("lat", request.accountId).pipe(
			Effect.mapError(
				() => new TransactionValidationFailure(`Invalid Account ID: ${request.accountId}`)
			),
			Effect.flatMap(accountId =>
				Effect.try({
					try: () =>
						new LedgerTransactionEntry({
							id,
							accountId,
							direction: request.direction,
							amount: parseAmount(request.amount),
							assetId: request.assetId,
							assetCode: request.assetCode,
							minorUnitExponent: request.minorUnitExponent,
							status,
							metadata: request.metadata,
							created,
						}),
					catch: cause => new TransactionValidationFailure("Invalid Entry amount", { cause }),
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
	static fromRow(
		row: LedgerTransactionEntryRow,
		asset: AssetSummary
	): Effect.Effect<LedgerTransactionEntry, Error> {
		return Effect.all({
			id: parseUuid<"lte", LedgerTransactionEntryID>("lte", row.id),
			accountId: parseUuid<"lat", LedgerAccountID>("lat", row.accountId),
			metadata: parseMetadata(row.metadata),
			created: parseDate(row.created),
		}).pipe(
			Effect.map(
				decoded =>
					new LedgerTransactionEntry({
						...decoded,
						direction: row.direction,
						amount: row.amount,
						...asset,
						assetId: TypeID.fromUUID("ast", row.assetId).toString(),
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
			id: encodeUuid(this.id),
			transactionId: encodeUuid(transaction.id),
			accountId: encodeUuid(this.accountId),
			organizationId: encodeUuid(transaction.organizationId),
			ledgerId: encodeUuid(transaction.ledgerId),
			direction: this.direction,
			amount: this.amount,
			assetId: encodeUuid(TypeID.fromString(this.assetId)),
			status: this.status,
			metadata: encodeMetadata(this.metadata),
			created: this.created.toJSDate(),
		};
	}

	toResponse(): TransactionResponseEntry {
		return {
			id: this.id.toString(),
			accountId: this.accountId.toString(),
			direction: this.direction,
			amount: this.amount.toString(),
			assetId: this.assetId,
			assetCode: this.assetCode,
			minorUnitExponent: this.minorUnitExponent,
			...(this.metadata === undefined ? {} : { metadata: this.metadata }),
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
	LedgerTransactionEntryOptions,
	LedgerTransactionEntryStatus,
};
export { LedgerTransactionEntry };
