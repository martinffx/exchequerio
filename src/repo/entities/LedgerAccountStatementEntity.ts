import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { LedgerAccountStatementsTable } from "@/repo/schema";
import type {
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
} from "@/routes/ledgers/schema";
import type { LedgerAccountID, LedgerAccountStatementID } from "./types";

// Infer types from Drizzle schema
type LedgerAccountStatementRecord = InferSelectModel<typeof LedgerAccountStatementsTable>;
type LedgerAccountStatementInsert = InferInsertModel<typeof LedgerAccountStatementsTable>;

type LedgerAccountStatementEntityOptions = {
	id: LedgerAccountStatementID;
	accountId: LedgerAccountID;
	statementDate: Date;
	openingBalance: number;
	closingBalance: number;
	totalCredits: number;
	totalDebits: number;
	transactionCount: number;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
};

class LedgerAccountStatementEntity {
	public readonly id: LedgerAccountStatementID;
	public readonly accountId: LedgerAccountID;
	public readonly statementDate: Date;
	public readonly openingBalance: number;
	public readonly closingBalance: number;
	public readonly totalCredits: number;
	public readonly totalDebits: number;
	public readonly transactionCount: number;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;

	constructor(options: LedgerAccountStatementEntityOptions) {
		this.id = options.id;
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

	public static fromRequest(
		rq: LedgerAccountStatementRequest,
		id?: string
	): LedgerAccountStatementEntity {
		const now = new Date();
		return new LedgerAccountStatementEntity({
			id: id
				? (TypeID.fromString<"lst">(id) as LedgerAccountStatementID)
				: (new TypeID("lst") as LedgerAccountStatementID),
			accountId: TypeID.fromString<"lat">(rq.accountId) as LedgerAccountID,
			statementDate: new Date(rq.startDatetime),
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

	public static fromRecord(record: LedgerAccountStatementRecord): LedgerAccountStatementEntity {
		// Parse metadata from TEXT (JSON string) to object
		let metadata: Record<string, unknown> | undefined;
		if (record.metadata) {
			try {
				metadata = JSON.parse(record.metadata) as Record<string, unknown>;
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerAccountStatementEntity({
			id: TypeID.fromString<"lst">(record.id) as LedgerAccountStatementID,
			accountId: TypeID.fromString<"lat">(record.accountId) as LedgerAccountID,
			statementDate: record.statementDate,
			openingBalance: Number.parseFloat(record.openingBalance),
			closingBalance: Number.parseFloat(record.closingBalance),
			totalCredits: Number.parseFloat(record.totalCredits),
			totalDebits: Number.parseFloat(record.totalDebits),
			transactionCount: record.transactionCount,
			metadata,
			created: record.created,
			updated: record.updated,
		});
	}

	public toRecord(): LedgerAccountStatementInsert {
		return {
			id: this.id.toString(),
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

	public toResponse(): LedgerAccountStatementResponse {
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
			ledgerId: "", // TODO: Need to fetch from account
			accountId: this.accountId.toString(),
			description: undefined,
			startDatetime: this.statementDate.toISOString(),
			endDatetime: this.statementDate.toISOString(),
			ledgerAccountVersion: 0,
			normalBalance: "debit" as const,
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

export type {
	LedgerAccountStatementEntityOptions as LedgerAccountStatementEntityOpts,
	LedgerAccountStatementRecord,
	LedgerAccountStatementInsert,
};
export { LedgerAccountStatementEntity };
