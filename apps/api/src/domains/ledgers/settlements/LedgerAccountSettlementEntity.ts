import { TypeID } from "typeid-js";
import type { AssetSummary } from "@/lib/AssetSchema";
import { INT64_MAX } from "@/lib/amounts";
import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import { LedgerTransaction } from "../transactions/LedgerTransaction";
import { BadRequestError, ConflictError } from "@/lib/errors";
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
	newLedgerAccountSettlementID,
	newLedgerTransactionID,
	type LedgerAccountID,
	type LedgerAccountSettlementID,
	type LedgerID,
	type OrgID,
} from "@/lib/ids";
import type { LedgerAccountSettlementInsert, LedgerAccountSettlementRow } from "@/db/schema";
import type {
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	NormalBalance,
	SettlementStatus,
	SettlementTargetStatus,
} from "./LedgerAccountSettlementSchema";
import { LedgerAccountSettlementPersistenceDecodingFailure } from "./LedgerAccountSettlementErrors";

/** Decoded Settlement state with optional accounting loaded by the repository. */
type LedgerAccountSettlementEntityOptions = Readonly<
	AssetSummary & {
		id: LedgerAccountSettlementID;
		organizationId: OrgID;
		ledgerId: LedgerID;
		settledAccountId: LedgerAccountID;
		contraAccountId: LedgerAccountID;
		status: SettlementStatus;
		targetStatus?: SettlementTargetStatus;
		description?: string;
		externalReference?: string;
		effectiveAtUpperBound?: DateTime;
		allowEitherDirection: boolean;
		metadata?: Metadata;
		created: DateTime;
		updated: DateTime;
		transaction?: LedgerTransaction;
	}
>;
/**
 * Serializes a Settlement timestamp.
 *
 * @param date - Timestamp to serialize.
 * @returns The ISO timestamp.
 * @throws Error when the timestamp is invalid.
 */
const toIso = (date: DateTime): string => {
	const value = date.toISO();
	if (value === null) throw new Error("Settlement contains an invalid timestamp");
	return value;
};
/** Owns Settlement conversions and accounting construction without performing I/O. */
class LedgerAccountSettlementEntity {
	/**
	 * Wraps decoded Settlement state.
	 *
	 * @param data - Settlement fields and optional accounting.
	 */
	constructor(readonly data: LedgerAccountSettlementEntityOptions) {}
	/** Settlement identifier. */
	get id() {
		return this.data.id;
	}
	/** Organization that owns the Settlement. */
	get organizationId() {
		return this.data.organizationId;
	}
	/** Ledger containing both Settlement Accounts. */
	get ledgerId() {
		return this.data.ledgerId;
	}
	/** Current persisted lifecycle state. */
	get status() {
		return this.data.status;
	}
	/** Intended accounting state while processing. */
	get targetStatus() {
		return this.data.targetStatus;
	}
	/** Generated accounting, when loaded and already created. */
	get transaction() {
		return this.data.transaction;
	}
	/**
	 * Constructs a draft from a validated creation request.
	 *
	 * @remarks
	 * Manual drafts reject a cutoff. Other requests select through their cutoff or creation time;
	 * the repository prepares the requested lifecycle transition.
	 *
	 * @param organizationId - Owning Organization.
	 * @param ledgerId - Ledger containing the Accounts.
	 * @param request - Validated creation fields.
	 * @param asset - Settled Account Asset.
	 * @param now - Creation time and default automatic selection cutoff.
	 * @param id - Settlement identifier; generated when omitted.
	 * @returns An Effect containing the draft, or a request/identifier failure.
	 */
	static fromRequest(
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerAccountSettlementRequest,
		asset: AssetSummary,
		now: DateTime,
		id = newLedgerAccountSettlementID()
	) {
		return Effect.gen(function* () {
			if (request.status === "drafting" && request.effectiveAtUpperBound !== undefined)
				return yield* Effect.fail(
					new BadRequestError("Drafting Settlements use manual source selection")
				);
			return new LedgerAccountSettlementEntity({
				id,
				organizationId,
				ledgerId,
				settledAccountId: yield* parseId<"lat", LedgerAccountID>("lat", request.settledAccountId),
				contraAccountId: yield* parseId<"lat", LedgerAccountID>("lat", request.contraAccountId),
				...asset,
				status: "drafting",
				allowEitherDirection: request.allowEitherDirection ?? false,
				description: request.description,
				metadata: request.metadata,
				externalReference: request.externalReference,
				effectiveAtUpperBound:
					request.status === "drafting"
						? undefined
						: request.effectiveAtUpperBound
							? DateTime.fromISO(request.effectiveAtUpperBound, { zone: "utc" })
							: now,
				created: now,
				updated: now,
			});
		});
	}
	/**
	 * Decodes persisted Settlement fields and attaches loaded accounting.
	 *
	 * @param row - Persisted row, or undefined when absent.
	 * @param transaction - Accounting loaded by the repository.
	 * @returns An Effect containing an optional Settlement, or a persistence decoding failure.
	 */
	static fromRow(
		row: (LedgerAccountSettlementRow & AssetSummary) | undefined,
		transaction?: LedgerTransaction
	) {
		if (row === undefined) return Effect.succeed(Option.none<LedgerAccountSettlementEntity>());
		return Effect.gen(function* () {
			return Option.some(
				// oxlint-disable-next-line unicorn/no-array-callback-reference -- Wrap the decoded entity in an Option.
				new LedgerAccountSettlementEntity({
					id: yield* parseUuid<"las", LedgerAccountSettlementID>("las", row.id),
					organizationId: yield* parseUuid<"org", OrgID>("org", row.organizationId),
					ledgerId: yield* parseUuid<"lgr", LedgerID>("lgr", row.ledgerId),
					settledAccountId: yield* parseUuid<"lat", LedgerAccountID>("lat", row.settledAccountId),
					contraAccountId: yield* parseUuid<"lat", LedgerAccountID>("lat", row.contraAccountId),
					status: row.status,
					targetStatus: row.targetStatus ?? undefined,
					assetId: TypeID.fromUUID("ast", row.assetId).toString(),
					assetCode: row.assetCode,
					minorUnitExponent: row.minorUnitExponent,
					allowEitherDirection: row.allowEitherDirection,
					description: row.description ?? undefined,
					externalReference: row.externalReference ?? undefined,
					metadata: yield* parseMetadata(row.metadata),
					effectiveAtUpperBound: row.effectiveAtUpperBound
						? yield* parseDate(row.effectiveAtUpperBound)
						: undefined,
					created: yield* parseDate(row.created),
					updated: yield* parseDate(row.updated),
					transaction,
				})
			);
		}).pipe(Effect.mapError(cause => new LedgerAccountSettlementPersistenceDecodingFailure(cause)));
	}
	/**
	 * Encodes fields owned by Settlement persistence.
	 *
	 * @returns The insertable row; accounting remains on the Transaction.
	 */
	toRow(): LedgerAccountSettlementInsert {
		const d = this.data;
		return {
			id: encodeUuid(d.id),
			organizationId: encodeUuid(d.organizationId),
			ledgerId: encodeUuid(d.ledgerId),
			settledAccountId: encodeUuid(d.settledAccountId),
			contraAccountId: encodeUuid(d.contraAccountId),
			assetId: encodeUuid(TypeID.fromString(d.assetId)),
			status: d.status,
			targetStatus: d.targetStatus,
			allowEitherDirection: d.allowEitherDirection,
			description: d.description,
			metadata: encodeMetadata(d.metadata),
			externalReference: d.externalReference,
			effectiveAtUpperBound: d.effectiveAtUpperBound?.toJSDate(),
			created: d.created.toJSDate(),
			updated: d.updated.toJSDate(),
		};
	}
	/**
	 * Builds the API representation from Settlement state and loaded accounting.
	 *
	 * @remarks
	 * Accounting fields are null until a generated Transaction is loaded.
	 * Invalid timestamps throw during ISO serialization.
	 *
	 * @returns The response with amount and direction derived from the settled Account Entry.
	 */
	toResponse(): LedgerAccountSettlementResponse {
		const d = this.data;
		const entry =
			d.transaction &&
			Option.getOrUndefined(d.transaction.entries)?.find(
				e => e.accountId.toString() === d.settledAccountId.toString()
			);
		return {
			id: d.id.toString(),
			ledgerId: d.ledgerId.toString(),
			// oxlint-disable-next-line unicorn/no-null -- Nullable accounting reference.
			transactionId: d.transaction?.id.toString() ?? null,
			// oxlint-disable-next-line unicorn/no-null -- Drafts have no accounting.
			amount: entry?.amount.toString() ?? null,
			// oxlint-disable-next-line unicorn/no-null -- Drafts have no accounting.
			settlementEntryDirection: entry?.direction ?? null,
			status: d.status,
			settledAccountId: d.settledAccountId.toString(),
			contraAccountId: d.contraAccountId.toString(),
			assetId: d.assetId,
			assetCode: d.assetCode,
			minorUnitExponent: d.minorUnitExponent,
			allowEitherDirection: d.allowEitherDirection,
			// oxlint-disable-next-line unicorn/no-null -- Manual selection has no cutoff.
			effectiveAtUpperBound: d.effectiveAtUpperBound ? toIso(d.effectiveAtUpperBound) : null,
			description: d.description,
			metadata: d.metadata,
			externalReference: d.externalReference,
			created: toIso(d.created),
			updated: toIso(d.updated),
		};
	}
	/**
	 * Nets source Entries and constructs balanced Settlement accounting.
	 *
	 * @remarks
	 * The net uses exact integer arithmetic and must be nonzero and within signed 64-bit range.
	 * Negative nets require allowEitherDirection. The offset reverses the settled Account net;
	 * the contra Entry balances it. No amount is stored separately on the Settlement.
	 *
	 * @param entries - Selected source amounts and directions.
	 * @param normalBalance - Settled Account normal balance.
	 * @param status - Initial accounting status.
	 * @param now - Accounting creation time.
	 * @returns An Effect containing the Transaction, or a net/policy/Transaction validation failure.
	 */
	toTransaction(
		entries: readonly { amount: bigint; direction: NormalBalance }[],
		normalBalance: NormalBalance,
		status: "pending" | "posted",
		now: DateTime
	) {
		const d = this.data;
		return Effect.gen(function* () {
			if (entries.length === 0)
				return yield* Effect.fail(new ConflictError("Settlement requires source Entries"));
			const net = entries.reduce(
				(sum, entry) => sum + (entry.direction === normalBalance ? entry.amount : -entry.amount),
				0n
			);
			if (net === 0n || net > INT64_MAX || net < -INT64_MAX)
				return yield* Effect.fail(
					new ConflictError("Settlement net must be nonzero and within signed 64-bit range")
				);
			if (net < 0n && !d.allowEitherDirection)
				return yield* Effect.fail(
					new ConflictError("Negative Settlement net requires allowEitherDirection")
				);
			const amount = (net < 0n ? -net : net).toString();
			const direction = net > 0n ? (normalBalance === "debit" ? "credit" : "debit") : normalBalance;
			const transaction = yield* LedgerTransaction.fromCreateRequest(
				newLedgerTransactionID(),
				d.organizationId,
				d.ledgerId,
				{
					status,
					description: d.description,
					metadata: { ...d.metadata, settlementId: d.id.toString() },
					effectiveAt: toIso(d.created),
					ledgerEntries: [
						{
							accountId: d.settledAccountId.toString(),
							direction,
							amount,
							assetId: d.assetId,
							assetCode: d.assetCode,
							minorUnitExponent: d.minorUnitExponent,
						},
						{
							accountId: d.contraAccountId.toString(),
							direction: direction === "debit" ? "credit" : "debit",
							amount,
							assetId: d.assetId,
							assetCode: d.assetCode,
							minorUnitExponent: d.minorUnitExponent,
						},
					],
				},
				now
			);
			return yield* LedgerTransaction.create({ ...transaction, settlementId: d.id });
		});
	}
}
export type { LedgerAccountSettlementEntityOptions };
export { LedgerAccountSettlementEntity };
