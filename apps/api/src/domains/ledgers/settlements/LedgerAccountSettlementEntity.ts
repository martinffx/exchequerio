import { Effect, Option } from "effect";
import { DateTime } from "luxon";

import { LedgerTransaction } from "@/domains/ledgers/transactions/LedgerTransaction";
import { LedgerTransactionEntry } from "@/domains/ledgers/transactions/LedgerTransactionEntry";
import type { InvalidId } from "@/lib/errors";
import { encodeMetadata, type Metadata, parseDate, parseId, parseMetadata } from "@/lib/utils";
import {
	newLedgerAccountSettlementID,
	newLedgerTransactionEntryID,
	newLedgerTransactionID,
	type LedgerAccountID,
	type LedgerAccountSettlementID,
	type LedgerID,
	type LedgerTransactionID,
	type OrgID,
} from "@/repo/entities/types";
import type { LedgerAccountSettlementInsert, LedgerAccountSettlementRow } from "@/repo/schema";

import type {
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	NormalBalance,
	SettlementStatus,
} from "./LedgerAccountSettlementSchema";
import {
	LedgerAccountSettlementLifecycleConflict,
	LedgerAccountSettlementPersistenceDecodingFailure,
} from "./LedgerAccountSettlementErrors";

type LedgerAccountSettlementEntityOptions = Readonly<{
	id: LedgerAccountSettlementID;
	organizationId: OrgID;
	transactionId?: LedgerTransactionID;
	settledAccountId: LedgerAccountID;
	contraAccountId: LedgerAccountID;
	amount: number;
	normalBalance: NormalBalance;
	currency: string;
	status: SettlementStatus;
	description?: string;
	externalReference?: string;
	effectiveAtUpperBound?: DateTime;
	metadata?: Metadata;
	created: DateTime;
	updated: DateTime;
}>;

const toIso = (value: DateTime): string => {
	const encoded = value.toISO();
	if (encoded === null) throw new Error("Settlement contains an invalid timestamp");
	return encoded;
};

class LedgerAccountSettlementEntity {
	readonly id: LedgerAccountSettlementID;
	readonly organizationId: OrgID;
	readonly transactionId?: LedgerTransactionID;
	readonly settledAccountId: LedgerAccountID;
	readonly contraAccountId: LedgerAccountID;
	readonly amount: number;
	readonly normalBalance: NormalBalance;
	readonly currency: string;
	readonly status: SettlementStatus;
	readonly description?: string;
	readonly externalReference?: string;
	readonly effectiveAtUpperBound?: DateTime;
	readonly metadata?: Metadata;
	readonly created: DateTime;
	readonly updated: DateTime;

	constructor(opts: LedgerAccountSettlementEntityOptions) {
		this.id = opts.id;
		this.organizationId = opts.organizationId;
		this.transactionId = opts.transactionId;
		this.settledAccountId = opts.settledAccountId;
		this.contraAccountId = opts.contraAccountId;
		this.amount = opts.amount;
		this.normalBalance = opts.normalBalance;
		this.currency = opts.currency;
		this.status = opts.status;
		this.description = opts.description;
		this.externalReference = opts.externalReference;
		this.effectiveAtUpperBound = opts.effectiveAtUpperBound;
		this.metadata = opts.metadata;
		this.created = opts.created;
		this.updated = opts.updated;
	}

	static fromRequest(
		request: LedgerAccountSettlementRequest,
		organizationId: OrgID,
		currency: string,
		normalBalance: NormalBalance,
		settledAccountId: LedgerAccountID,
		contraAccountId: LedgerAccountID,
		id = newLedgerAccountSettlementID()
	) {
		const now = DateTime.utc();
		const transactionId: Effect.Effect<LedgerTransactionID | undefined, InvalidId> =
			request.transactionId
				? parseId<"ltr", LedgerTransactionID>("ltr", request.transactionId).pipe(Effect.map(id => id))
				: Effect.succeed<LedgerTransactionID | undefined>(undefined);

		return transactionId.pipe(
			Effect.map(
				transactionId =>
					new LedgerAccountSettlementEntity({
						id,
						organizationId,
						transactionId,
						settledAccountId,
						contraAccountId,
						amount: 0,
						normalBalance,
						currency,
						status: request.status,
						description: request.description,
						externalReference: request.externalReference,
						effectiveAtUpperBound: request.effectiveAtUpperBound
							? DateTime.fromISO(request.effectiveAtUpperBound, { zone: "utc" })
							: undefined,
						metadata: request.metadata,
						created: now,
						updated: now,
					})
			)
		);
	}

	static fromRow(row: LedgerAccountSettlementRow) {
		const transactionId: Effect.Effect<LedgerTransactionID | undefined, InvalidId> = row.transactionId
			? parseId<"ltr", LedgerTransactionID>("ltr", row.transactionId)
			: Effect.succeed<LedgerTransactionID | undefined>(undefined);
		const effectiveAtUpperBound: Effect.Effect<DateTime | undefined, Error> =
			row.effectiveAtUpperBound
				? parseDate(row.effectiveAtUpperBound)
				: Effect.succeed<DateTime | undefined>(undefined);

		return Effect.all({
			id: parseId<"las", LedgerAccountSettlementID>("las", row.id),
			organizationId: parseId<"org", OrgID>("org", row.organizationId),
			transactionId,
			settledAccountId: parseId<"lat", LedgerAccountID>("lat", row.settledAccountId),
			contraAccountId: parseId<"lat", LedgerAccountID>("lat", row.contraAccountId),
			effectiveAtUpperBound,
			metadata: parseMetadata(row.metadata),
			created: parseDate(row.created),
			updated: parseDate(row.updated),
		}).pipe(
			Effect.map(
				decoded =>
					new LedgerAccountSettlementEntity({
						...decoded,
						amount: row.amount,
						normalBalance: row.normalBalance,
						currency: row.currency,
						status: row.status,
						description: row.description ?? undefined,
						externalReference: row.externalReference ?? undefined,
					})
			),
			Effect.mapError(cause => new LedgerAccountSettlementPersistenceDecodingFailure(cause))
		);
	}

	toRow(): LedgerAccountSettlementInsert {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			transactionId: this.transactionId?.toString() ?? undefined,
			settledAccountId: this.settledAccountId.toString(),
			contraAccountId: this.contraAccountId.toString(),
			amount: this.amount,
			normalBalance: this.normalBalance,
			currency: this.currency,
			status: this.status,
			description: this.description ?? undefined,
			externalReference: this.externalReference ?? undefined,
			effectiveAtUpperBound: this.effectiveAtUpperBound?.toJSDate(),
			metadata: encodeMetadata(this.metadata),
			created: this.created.toJSDate(),
			updated: this.updated.toJSDate(),
		};
	}

	toResponse(): LedgerAccountSettlementResponse {
		return {
			id: this.id.toString(),
			transactionId: this.transactionId?.toString() ?? "",
			settledAccountId: this.settledAccountId.toString(),
			contraAccountId: this.contraAccountId.toString(),
			amount: this.amount,
			normalBalance: this.normalBalance,
			currency: this.currency,
			status: this.status,
			description: this.description,
			metadata: this.metadata,
			created: toIso(this.created),
			updated: toIso(this.updated),
		};
	}

	toTransaction(ledgerId: LedgerID, created: DateTime = DateTime.utc()) {
		const transactionId = newLedgerTransactionID();
		const entries = [
			LedgerTransactionEntry.create({
				id: newLedgerTransactionEntryID(),
				accountId: this.settledAccountId,
				direction: this.normalBalance === "debit" ? "credit" : "debit",
				amount: this.amount,
				currency: this.currency,
				status: "posted",
				metadata: {},
				created,
			}),
			LedgerTransactionEntry.create({
				id: newLedgerTransactionEntryID(),
				accountId: this.contraAccountId,
				direction: this.normalBalance === "debit" ? "debit" : "credit",
				amount: this.amount,
				currency: this.currency,
				status: "posted",
				metadata: {},
				created,
			}),
		] as const;

		return LedgerTransaction.create({
			id: transactionId,
			organizationId: this.organizationId,
			ledgerId,
			status: "posted",
			description: this.description ?? `Settlement ${this.id.toString()}`,
			metadata: { ...this.metadata, settlementId: this.id.toString() },
			// oxlint-disable-next-line unicorn/no-array-callback-reference -- The array is wrapped as an Option value.
			entries: Option.some(entries),
			postedAt: created,
			effectiveAt: this.created,
			lockVersion: 1,
			created,
			updated: created,
		});
	}

	transitionTo(targetStatus: SettlementStatus, updated: DateTime = DateTime.utc()) {
		const transitions: Record<SettlementStatus, readonly SettlementStatus[]> = {
			drafting: ["processing"],
			processing: ["pending", "drafting"],
			pending: ["posted", "drafting"],
			posted: ["archiving"],
			archiving: ["archived"],
			archived: [],
		};
		return transitions[this.status].includes(targetStatus)
			? Effect.succeed(new LedgerAccountSettlementEntity({ ...this, status: targetStatus, updated }))
			: Effect.fail(new LedgerAccountSettlementLifecycleConflict(this.status, targetStatus));
	}
}

export type { LedgerAccountSettlementEntityOptions };
export { LedgerAccountSettlementEntity };
