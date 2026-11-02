import { Effect } from "effect";
import { DateTime } from "luxon";
import type { TypeID } from "typeid-js";
import type { LedgerAccountStatementRow } from "@/db/schema";
import { INT64_MAX, INT64_MIN } from "@/lib/amounts";
import { BadRequestError, ConflictError } from "@/lib/errors";
import type {
	LedgerAccountID,
	LedgerAccountStatementID,
	LedgerID,
	LedgerTransactionEntryID,
	LedgerTransactionID,
} from "@/lib/ids";
import { parseDate, parseUuid } from "@/lib/utils";
import { StatementPersistenceDecodingFailure } from "./StatementErrors";
import type {
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
	StatementEntry,
	StatementSnapshot,
} from "./LedgerAccountStatementSchema";

type StatementRecord = Omit<LedgerAccountStatementRow, "snapshot"> & {
	snapshot: Omit<StatementSnapshot, "entries">;
};
type StatementTotals = {
	postedCredits: bigint;
	postedDebits: bigint;
	unpostedCredits: bigint;
	unpostedDebits: bigint;
};

const inRange = (value: bigint) => value >= INT64_MIN && value <= INT64_MAX;

type StatementPeriod = { startDatetime: Date; endDatetime: Date };

const calculateStatementBalances = (
	normalBalance: StatementSnapshot["normalBalance"],
	totals: StatementTotals
): Effect.Effect<StatementSnapshot["startingBalances"], ConflictError> => {
	const { postedCredits, postedDebits, unpostedCredits, unpostedDebits } = totals;
	const pendingCredits = postedCredits + unpostedCredits;
	const pendingDebits = postedDebits + unpostedDebits;
	const counters = [
		{ balanceType: "pending" as const, credits: pendingCredits, debits: pendingDebits },
		{ balanceType: "posted" as const, credits: postedCredits, debits: postedDebits },
		{
			balanceType: "availableBalance" as const,
			credits: normalBalance === "debit" ? pendingCredits : postedCredits,
			debits: normalBalance === "debit" ? postedDebits : pendingDebits,
		},
	];
	const balances = counters.map(balance => ({
		balanceType: balance.balanceType,
		credits: balance.credits,
		debits: balance.debits,
		amount:
			normalBalance === "debit" ? balance.debits - balance.credits : balance.credits - balance.debits,
	}));
	return balances.every(b => inRange(b.credits) && inRange(b.debits) && inRange(b.amount))
		? Effect.succeed(
				balances.map(b => ({
					balanceType: b.balanceType,
					credits: b.credits.toString(),
					debits: b.debits.toString(),
					amount: b.amount.toString(),
				}))
			)
		: Effect.fail(
				new ConflictError("Accounting projection exceeds the signed 64-bit range", { retryable: false })
			);
};

const validateStatementPeriod = (
	request: Pick<LedgerAccountStatementRequest, "startDatetime" | "endDatetime">
): Effect.Effect<StatementPeriod, BadRequestError> => {
	const message =
		"Statement startDatetime must precede endDatetime and both must be valid timestamps";
	return Effect.try({
		try: () => ({
			start: DateTime.fromISO(request.startDatetime, { zone: "utc" }),
			end: DateTime.fromISO(request.endDatetime, { zone: "utc" }),
		}),
		catch: parseError => new BadRequestError(message, { cause: parseError }),
	}).pipe(
		Effect.filterOrFail(
			({ start, end }) => start.toMillis() < end.toMillis(),
			() => new BadRequestError(message)
		),
		Effect.map(({ start, end }) => ({ startDatetime: start.toJSDate(), endDatetime: end.toJSDate() }))
	);
};

/** Snapshots store native UUIDs; responses expose prefixed TypeIDs. */
const decodeStatementEntry = (
	entry: StatementEntry
): Effect.Effect<StatementEntry, StatementPersistenceDecodingFailure> =>
	Effect.gen(function* () {
		const id = yield* parseUuid<"lte", LedgerTransactionEntryID>("lte", entry.id);
		const accountId = yield* parseUuid<"lat", LedgerAccountID>("lat", entry.accountId);
		const assetId = yield* parseUuid<"ast", TypeID<"ast">>("ast", entry.assetId);
		const transactionId = yield* parseUuid<"ltr", LedgerTransactionID>("ltr", entry.transaction.id);
		return {
			...entry,
			id: id.toString(),
			accountId: accountId.toString(),
			assetId: assetId.toString(),
			transaction: { ...entry.transaction, id: transactionId.toString() },
		};
	}).pipe(Effect.mapError(cause => new StatementPersistenceDecodingFailure(cause)));

type DecodedStatement = {
	id: LedgerAccountStatementID;
	ledgerId: LedgerID;
	accountId: LedgerAccountID;
	assetId: TypeID<"ast">;
	startDatetime: DateTime;
	endDatetime: DateTime;
	created: DateTime;
	updated: DateTime;
};

class LedgerAccountStatement {
	private constructor(
		private readonly record: StatementRecord,
		private readonly decoded: DecodedStatement
	) {}
	static fromRow(
		record: StatementRecord
	): Effect.Effect<LedgerAccountStatement, StatementPersistenceDecodingFailure> {
		return Effect.gen(function* () {
			const decoded: DecodedStatement = {
				id: yield* parseUuid<"lst", LedgerAccountStatementID>("lst", record.id),
				ledgerId: yield* parseUuid<"lgr", LedgerID>("lgr", record.ledgerId),
				accountId: yield* parseUuid<"lat", LedgerAccountID>("lat", record.accountId),
				assetId: yield* parseUuid<"ast", TypeID<"ast">>("ast", record.snapshot.assetId),
				startDatetime: yield* parseDate(record.startDatetime),
				endDatetime: yield* parseDate(record.endDatetime),
				created: yield* parseDate(record.created),
				updated: yield* parseDate(record.updated),
			};
			return new LedgerAccountStatement(record, decoded);
		}).pipe(Effect.mapError(cause => new StatementPersistenceDecodingFailure(cause)));
	}
	get id(): LedgerAccountStatementID {
		return this.decoded.id;
	}
	toResponse(): LedgerAccountStatementResponse {
		const { record, decoded } = this;
		return {
			id: decoded.id.toString(),
			ledgerId: decoded.ledgerId.toString(),
			accountId: decoded.accountId.toString(),
			startDatetime: decoded.startDatetime.toISO(),
			endDatetime: decoded.endDatetime.toISO(),
			ledgerAccountVersion: record.ledgerAccountVersion,
			normalBalance: record.snapshot.normalBalance,
			assetId: decoded.assetId.toString(),
			assetCode: record.snapshot.assetCode,
			minorUnitExponent: record.snapshot.minorUnitExponent,
			startingBalances: record.snapshot.startingBalances,
			endingBalances: record.snapshot.endingBalances,
			description: record.description ?? undefined,
			metadata: record.metadata ?? undefined,
			lockVersion: record.lockVersion,
			created: decoded.created.toISO(),
			updated: decoded.updated.toISO(),
		};
	}
}
export {
	LedgerAccountStatement,
	calculateStatementBalances,
	decodeStatementEntry,
	validateStatementPeriod,
};
export type { StatementPeriod, StatementRecord, StatementTotals };
