import { encodeUuid } from "@/lib/utils";
import type { InferInsertModel } from "drizzle-orm";
import { TypeID } from "typeid-js";

import type { AssetSummary } from "@/lib/AssetSchema";
import type { Metadata } from "@/lib/schema";
import type { LedgerAccountID, LedgerAccountStatementID, LedgerID } from "@/lib/ids";
import type { LedgerAccountStatementRow, LedgerAccountStatementsTable } from "@/db/schema";

import type {
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
} from "./LedgerAccountStatementSchema";

type LedgerAccountStatementInsert = InferInsertModel<typeof LedgerAccountStatementsTable>;

type LedgerAccountStatementOptions = {
	readonly id: LedgerAccountStatementID;
	readonly ledgerId: LedgerID;
	readonly accountId: LedgerAccountID;
	readonly statementDate: Date;
	readonly asset: AssetSummary;
	readonly openingBalance: bigint;
	readonly closingBalance: bigint;
	readonly totalCredits: bigint;
	readonly totalDebits: bigint;
	readonly transactionCount: number;
	readonly metadata?: Metadata;
	readonly created: Date;
	readonly updated: Date;
};

class LedgerAccountStatement {
	readonly id: LedgerAccountStatementID;
	readonly ledgerId: LedgerID;
	readonly accountId: LedgerAccountID;
	readonly statementDate: Date;
	readonly asset: AssetSummary;
	readonly openingBalance: bigint;
	readonly closingBalance: bigint;
	readonly totalCredits: bigint;
	readonly totalDebits: bigint;
	readonly transactionCount: number;
	readonly metadata?: Metadata;
	readonly created: Date;
	readonly updated: Date;

	constructor(options: LedgerAccountStatementOptions) {
		this.id = options.id;
		this.ledgerId = options.ledgerId;
		this.accountId = options.accountId;
		this.statementDate = options.statementDate;
		this.asset = options.asset;
		this.openingBalance = options.openingBalance;
		this.closingBalance = options.closingBalance;
		this.totalCredits = options.totalCredits;
		this.totalDebits = options.totalDebits;
		this.transactionCount = options.transactionCount;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	static fromRequest(
		request: LedgerAccountStatementRequest,
		asset: AssetSummary
	): LedgerAccountStatement {
		const now = new Date();
		return new LedgerAccountStatement({
			asset,
			id: new TypeID("lst") as LedgerAccountStatementID,
			ledgerId: TypeID.fromString<"lgr">(request.ledgerId) as LedgerID,
			accountId: TypeID.fromString<"lat">(request.accountId) as LedgerAccountID,
			statementDate: new Date(request.startDatetime),
			openingBalance: 0n,
			closingBalance: 0n,
			totalCredits: 0n,
			totalDebits: 0n,
			transactionCount: 0,
			metadata: undefined,
			created: now,
			updated: now,
		});
	}

	static fromRow(row: LedgerAccountStatementRow, asset: AssetSummary): LedgerAccountStatement {
		let metadata: Metadata | undefined;
		if (row.metadata) {
			try {
				const parsed: unknown = JSON.parse(row.metadata);
				if (
					typeof parsed === "object" &&
					parsed !== null &&
					!Array.isArray(parsed) &&
					Object.values(parsed).every(value => typeof value === "string")
				) {
					metadata = parsed as Metadata;
				}
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerAccountStatement({
			asset,
			id: TypeID.fromUUID("lst", row.id) as LedgerAccountStatementID,
			ledgerId: TypeID.fromUUID("lgr", row.ledgerId) as LedgerID,
			accountId: TypeID.fromUUID("lat", row.accountId) as LedgerAccountID,
			statementDate: row.statementDate,
			openingBalance: row.openingBalance,
			closingBalance: row.closingBalance,
			totalCredits: row.totalCredits,
			totalDebits: row.totalDebits,
			transactionCount: row.transactionCount,
			metadata,
			created: row.created,
			updated: row.updated,
		});
	}

	toRow(): LedgerAccountStatementInsert {
		return {
			id: encodeUuid(this.id),
			ledgerId: encodeUuid(this.ledgerId),
			accountId: encodeUuid(this.accountId),
			statementDate: this.statementDate,
			openingBalance: this.openingBalance,
			closingBalance: this.closingBalance,
			totalCredits: this.totalCredits,
			totalDebits: this.totalDebits,
			transactionCount: this.transactionCount,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			updated: new Date(),
		};
	}

	toResponse(): LedgerAccountStatementResponse {
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			accountId: this.accountId.toString(),
			description: undefined,
			startDatetime: this.statementDate.toISOString(),
			endDatetime: this.statementDate.toISOString(),
			ledgerAccountVersion: 0,
			normalBalance: "debit",
			...this.asset,
			metadata: this.metadata,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}
}

export type { LedgerAccountStatementInsert, LedgerAccountStatementOptions };
export { LedgerAccountStatement };
