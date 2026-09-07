import { DateTime } from "luxon";
import { TypeID } from "typeid-js";
import type { LedgerAccountStatementRow } from "@/db/schema";
import type { AssetSummary } from "@/lib/AssetSchema";
import { assertInt64 } from "@/lib/amounts";
import { BadRequestError } from "@/lib/errors";
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

const calculateStatementBalances = (
	normalBalance: StatementSnapshot["normalBalance"],
	totals: StatementTotals
): StatementSnapshot["startingBalances"] => {
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
	return counters.map(balance => ({
		balanceType: balance.balanceType,
		credits: assertInt64(balance.credits).toString(),
		debits: assertInt64(balance.debits).toString(),
		amount: assertInt64(
			normalBalance === "debit" ? balance.debits - balance.credits : balance.credits - balance.debits
		).toString(),
	}));
};

const validateStatementPeriod = (
	request: Pick<LedgerAccountStatementRequest, "startDatetime" | "endDatetime">
): { startDatetime: Date; endDatetime: Date } => {
	const start = DateTime.fromISO(request.startDatetime, { zone: "utc" });
	const end = DateTime.fromISO(request.endDatetime, { zone: "utc" });
	if (!start.isValid || !end.isValid || start.toMillis() >= end.toMillis()) {
		throw new BadRequestError(
			"Statement startDatetime must precede endDatetime and both must be valid timestamps"
		);
	}
	return { startDatetime: start.toJSDate(), endDatetime: end.toJSDate() };
};

const typeId = (prefix: string, uuid: string): string => TypeID.fromUUID(prefix, uuid).toString();
const toAssetSummary = (asset: AssetSummary): AssetSummary => ({
	assetId: typeId("ast", asset.assetId),
	assetCode: asset.assetCode,
	minorUnitExponent: asset.minorUnitExponent,
});

/** Snapshots store native UUIDs; responses expose prefixed TypeIDs. */
const toEntryResponse = (entry: StatementEntry): StatementEntry => ({
	...entry,
	id: typeId("lte", entry.id),
	accountId: typeId("lat", entry.accountId),
	assetId: typeId("ast", entry.assetId),
	transaction: { ...entry.transaction, id: typeId("ltr", entry.transaction.id) },
});

class LedgerAccountStatement {
	private constructor(private readonly record: StatementRecord) {}
	static fromRow(record: StatementRecord): LedgerAccountStatement {
		return new LedgerAccountStatement(record);
	}
	get id(): string {
		return typeId("lst", this.record.id);
	}
	toResponse(): LedgerAccountStatementResponse {
		const row = this.record;
		return {
			id: typeId("lst", row.id),
			ledgerId: typeId("lgr", row.ledgerId),
			accountId: typeId("lat", row.accountId),
			startDatetime: row.startDatetime.toISOString(),
			endDatetime: row.endDatetime.toISOString(),
			ledgerAccountVersion: row.ledgerAccountVersion,
			normalBalance: row.snapshot.normalBalance,
			...toAssetSummary(row.snapshot),
			startingBalances: row.snapshot.startingBalances,
			endingBalances: row.snapshot.endingBalances,
			description: row.description ?? undefined,
			metadata: row.metadata ?? undefined,
			lockVersion: row.lockVersion,
			created: row.created.toISOString(),
			updated: row.updated.toISOString(),
		};
	}
}
export {
	LedgerAccountStatement,
	calculateStatementBalances,
	toEntryResponse,
	validateStatementPeriod,
};
export type { StatementRecord, StatementTotals };
