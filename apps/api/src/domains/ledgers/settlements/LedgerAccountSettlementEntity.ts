import { Effect, Option } from "effect";
import { DateTime } from "luxon";
import { LedgerTransaction } from "../transactions/LedgerTransaction";
import { BadRequestError, ConflictError } from "@/lib/errors";
import { encodeMetadata, type Metadata, parseDate, parseId, parseMetadata } from "@/lib/utils";
import {
	newLedgerAccountSettlementID,
	newLedgerTransactionID,
	type LedgerAccountID,
	type LedgerAccountSettlementID,
	type LedgerID,
	type OrgID,
} from "@/repo/entities/types";
import type { LedgerAccountSettlementInsert, LedgerAccountSettlementRow } from "@/repo/schema";
import type {
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	NormalBalance,
	SettlementStatus,
	SettlementTargetStatus,
} from "./LedgerAccountSettlementSchema";
import { LedgerAccountSettlementPersistenceDecodingFailure } from "./LedgerAccountSettlementErrors";

type LedgerAccountSettlementEntityOptions = Readonly<{
	id: LedgerAccountSettlementID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	settledAccountId: LedgerAccountID;
	contraAccountId: LedgerAccountID;
	currency: string;
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
}>;
const toIso = (date: DateTime): string => {
	const value = date.toISO();
	if (value === null) throw new Error("Settlement contains an invalid timestamp");
	return value;
};
class LedgerAccountSettlementEntity {
	constructor(readonly data: LedgerAccountSettlementEntityOptions) {}
	get id() {
		return this.data.id;
	}
	get organizationId() {
		return this.data.organizationId;
	}
	get ledgerId() {
		return this.data.ledgerId;
	}
	get status() {
		return this.data.status;
	}
	get targetStatus() {
		return this.data.targetStatus;
	}
	get transaction() {
		return this.data.transaction;
	}
	static fromRequest(
		organizationId: OrgID,
		ledgerId: LedgerID,
		request: LedgerAccountSettlementRequest,
		currency: string,
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
				currency,
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
	static fromRow(row: LedgerAccountSettlementRow | undefined, transaction?: LedgerTransaction) {
		if (row === undefined) return Effect.succeed(Option.none<LedgerAccountSettlementEntity>());
		return Effect.gen(function* () {
			return Option.some(
				// oxlint-disable-next-line unicorn/no-array-callback-reference -- Wrap the decoded entity in an Option.
				new LedgerAccountSettlementEntity({
					id: yield* parseId<"las", LedgerAccountSettlementID>("las", row.id),
					organizationId: yield* parseId<"org", OrgID>("org", row.organizationId),
					ledgerId: yield* parseId<"lgr", LedgerID>("lgr", row.ledgerId),
					settledAccountId: yield* parseId<"lat", LedgerAccountID>("lat", row.settledAccountId),
					contraAccountId: yield* parseId<"lat", LedgerAccountID>("lat", row.contraAccountId),
					status: row.status,
					targetStatus: row.targetStatus ?? undefined,
					currency: row.currency,
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
	toRow(): LedgerAccountSettlementInsert {
		const d = this.data;
		return {
			id: d.id.toString(),
			organizationId: d.organizationId.toString(),
			ledgerId: d.ledgerId.toString(),
			settledAccountId: d.settledAccountId.toString(),
			contraAccountId: d.contraAccountId.toString(),
			currency: d.currency,
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
			amount: entry?.amount ?? null,
			// oxlint-disable-next-line unicorn/no-null -- Drafts have no accounting.
			settlementEntryDirection: entry?.direction ?? null,
			status: d.status,
			settledAccountId: d.settledAccountId.toString(),
			contraAccountId: d.contraAccountId.toString(),
			currency: d.currency,
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
	toTransaction(
		entries: readonly { amount: number; direction: NormalBalance }[],
		normalBalance: NormalBalance,
		status: "pending" | "posted",
		now: DateTime
	) {
		const d = this.data;
		return Effect.gen(function* () {
			if (entries.length === 0)
				return yield* Effect.fail(new ConflictError("Settlement requires source Entries"));
			const net = entries.reduce(
				(sum, entry) =>
					sum + (entry.direction === normalBalance ? BigInt(entry.amount) : -BigInt(entry.amount)),
				0n
			);
			if (
				net === 0n ||
				net > BigInt(Number.MAX_SAFE_INTEGER) ||
				net < -BigInt(Number.MAX_SAFE_INTEGER)
			)
				return yield* Effect.fail(
					new ConflictError("Settlement net must be nonzero and safely representable")
				);
			if (net < 0n && !d.allowEitherDirection)
				return yield* Effect.fail(
					new ConflictError("Negative Settlement net requires allowEitherDirection")
				);
			const amount = Number(net < 0n ? -net : net);
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
						{ accountId: d.settledAccountId.toString(), direction, amount, currencyCode: d.currency },
						{
							accountId: d.contraAccountId.toString(),
							direction: direction === "debit" ? "credit" : "debit",
							amount,
							currencyCode: d.currency,
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
