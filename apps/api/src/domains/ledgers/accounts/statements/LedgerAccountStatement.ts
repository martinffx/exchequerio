import type { InferInsertModel } from "drizzle-orm";
import { TypeID } from "typeid-js";

import type { Metadata } from "@/lib/schema";
import type { LedgerAccountID, LedgerAccountStatementID, LedgerID } from "@/repo/entities/types";
import type { LedgerAccountStatementRow, LedgerAccountStatementsTable } from "@/repo/schema";

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
	readonly openingBalance: number;
	readonly closingBalance: number;
	readonly totalCredits: number;
	readonly totalDebits: number;
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
	readonly openingBalance: number;
	readonly closingBalance: number;
	readonly totalCredits: number;
	readonly totalDebits: number;
	readonly transactionCount: number;
	readonly metadata?: Metadata;
	readonly created: Date;
	readonly updated: Date;

	constructor(options: LedgerAccountStatementOptions) {
		this.id = options.id;
		this.ledgerId = options.ledgerId;
		this.accountId = options.accountId;
		this.statementDate = options.statementDate;
		this.openingBalance = options.openingBalance;
		this.closingBalance = options.closingBalance;
		this.totalCredits = options.totalCredits;
		this.totalDebits = options.totalDebits;
		this.transactionCount = options.transactionCount;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	static fromRequest(request: LedgerAccountStatementRequest): LedgerAccountStatement {
		const now = new Date();
		return new LedgerAccountStatement({
			id: new TypeID("lst") as LedgerAccountStatementID,
			ledgerId: TypeID.fromString<"lgr">(request.ledgerId) as LedgerID,
			accountId: TypeID.fromString<"lat">(request.accountId) as LedgerAccountID,
			statementDate: new Date(request.startDatetime),
			openingBalance: 0,
			closingBalance: 0,
			totalCredits: 0,
			totalDebits: 0,
			transactionCount: 0,
			metadata: undefined,
			created: now,
			updated: now,
		});
	}

	static fromRow(row: LedgerAccountStatementRow): LedgerAccountStatement {
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
			id: TypeID.fromString<"lst">(row.id) as LedgerAccountStatementID,
			ledgerId: TypeID.fromString<"lgr">(row.ledgerId) as LedgerID,
			accountId: TypeID.fromString<"lat">(row.accountId) as LedgerAccountID,
			statementDate: row.statementDate,
			openingBalance: Number.parseFloat(row.openingBalance),
			closingBalance: Number.parseFloat(row.closingBalance),
			totalCredits: Number.parseFloat(row.totalCredits),
			totalDebits: Number.parseFloat(row.totalDebits),
			transactionCount: row.transactionCount,
			metadata,
			created: row.created,
			updated: row.updated,
		});
	}

	toRow(): LedgerAccountStatementInsert {
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			accountId: this.accountId.toString(),
			statementDate: this.statementDate,
			openingBalance: this.openingBalance.toString(),
			closingBalance: this.closingBalance.toString(),
			totalCredits: this.totalCredits.toString(),
			totalDebits: this.totalDebits.toString(),
			transactionCount: this.transactionCount,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			updated: new Date(),
		};
	}

	toResponse(): LedgerAccountStatementResponse {
		const emptyBalances = [
			{
				balanceType: "pending" as const,
				amount: 0,
				currency: "USD",
				currencyExponent: 2,
				credits: 0,
				debits: 0,
			},
			{
				balanceType: "posted" as const,
				amount: 0,
				currency: "USD",
				currencyExponent: 2,
				credits: 0,
				debits: 0,
			},
			{
				balanceType: "availableBalance" as const,
				amount: 0,
				currency: "USD",
				currencyExponent: 2,
				credits: 0,
				debits: 0,
			},
		];

		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			accountId: this.accountId.toString(),
			description: undefined,
			startDatetime: this.statementDate.toISOString(),
			endDatetime: this.statementDate.toISOString(),
			ledgerAccountVersion: 0,
			normalBalance: "debit",
			startingBalances: emptyBalances,
			endingBalances: emptyBalances,
			currency: "USD",
			currencyExponent: 2,
			metadata: this.metadata,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}
}

export type { LedgerAccountStatementInsert, LedgerAccountStatementOptions };
export { LedgerAccountStatement };
