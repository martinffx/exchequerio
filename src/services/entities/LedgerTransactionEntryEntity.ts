import type {
	LedgerTransactionEntryResponse,
	Direction,
	BalanceStatus,
	PendingBalance,
	PostedBalance,
	AvailableBalance,
} from "@/routes/ledgers/schema";
import type { LedgerTransactionEntriesTable } from "@/repo/schema";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { TypeID } from "typeid-js";

// Infer types from Drizzle schema
type LedgerTransactionEntryRecord = InferSelectModel<
	typeof LedgerTransactionEntriesTable
>;
type LedgerTransactionEntryInsert = InferInsertModel<
	typeof LedgerTransactionEntriesTable
>;

type LedgerTransactionEntryID = TypeID<"lte">;
type LedgerTransactionID = TypeID<"ltr">;
type LedgerAccountID = TypeID<"lat">;

// Resulting balance structure for API responses
type ResultingBalance = {
	pendingBalance: PendingBalance;
	postedBalance: PostedBalance;
	availableBalance: AvailableBalance;
};

type LedgerTransactionEntryEntityOpts = {
	id: LedgerTransactionEntryID;
	transactionId: LedgerTransactionID;
	accountId: LedgerAccountID;
	direction: Direction;
	amount: string; // Stored as string for precision
	status: BalanceStatus;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
	// Optional for API responses - calculated by repository
	currency?: string;
	currencyExponent?: number;
	resultingBalance?: ResultingBalance;
};

class LedgerTransactionEntryEntity {
	public readonly id: LedgerTransactionEntryID;
	public readonly transactionId: LedgerTransactionID;
	public readonly accountId: LedgerAccountID;
	public readonly direction: Direction;
	public readonly amount: string;
	public readonly status: BalanceStatus;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;
	// For API responses
	public readonly currency?: string;
	public readonly currencyExponent?: number;
	public readonly resultingBalance?: ResultingBalance;

	constructor(opts: LedgerTransactionEntryEntityOpts) {
		this.id = opts.id;
		this.transactionId = opts.transactionId;
		this.accountId = opts.accountId;
		this.direction = opts.direction;
		this.amount = opts.amount;
		this.status = opts.status;
		this.metadata = opts.metadata;
		this.created = opts.created;
		this.updated = opts.updated;
		this.currency = opts.currency;
		this.currencyExponent = opts.currencyExponent;
		this.resultingBalance = opts.resultingBalance;
	}

	// Create entry for transaction creation (used by service layer)
	public static create(
		transactionId: LedgerTransactionID,
		accountId: LedgerAccountID,
		direction: Direction,
		amount: string,
		id?: string,
	): LedgerTransactionEntryEntity {
		const now = new Date();
		return new LedgerTransactionEntryEntity({
			id: id ? TypeID.fromString<"lte">(id) : new TypeID("lte"),
			transactionId,
			accountId,
			direction,
			amount,
			status: "pending", // New entries start as pending
			created: now,
			updated: now,
		});
	}

	// Create entity from database record
	public static fromRecord(
		record: LedgerTransactionEntryRecord,
	): LedgerTransactionEntryEntity {
		return new LedgerTransactionEntryEntity({
			id: TypeID.fromString<"lte">(record.id),
			transactionId: TypeID.fromString<"ltr">(record.transactionId),
			accountId: TypeID.fromString<"lat">(record.accountId),
			direction: record.direction as Direction,
			amount: record.amount,
			status: record.status as BalanceStatus,
			metadata: record.metadata as Record<string, unknown> | undefined,
			created: record.created,
			updated: record.updated,
		});
	}

	// Create entity from database record with balance information for API responses
	public static fromRecordWithBalance(
		record: LedgerTransactionEntryRecord,
		currency: string,
		currencyExponent: number,
		resultingBalance: ResultingBalance,
	): LedgerTransactionEntryEntity {
		const entity = LedgerTransactionEntryEntity.fromRecord(record);
		return new LedgerTransactionEntryEntity({
			...entity,
			currency,
			currencyExponent,
			resultingBalance,
		});
	}

	// Convert entity to database record for insert/update
	public toRecord(): LedgerTransactionEntryInsert {
		return {
			id: this.id.toString(),
			transactionId: this.transactionId.toString(),
			accountId: this.accountId.toString(),
			direction: this.direction,
			amount: this.amount,
			status: this.status,
			metadata: this.metadata,
			created: this.created,
			updated: this.updated,
		};
	}

	// Convert entity to API response - requires currency and balance information
	public toResponse(): LedgerTransactionEntryResponse {
		if (
			!this.currency ||
			this.currencyExponent === undefined ||
			!this.resultingBalance
		) {
			throw new Error(
				"Currency and balance information required for response conversion. Use fromRecordWithBalance()",
			);
		}

		return {
			id: this.id.toString(),
			ledgerAccountId: this.accountId.toString(),
			direction: this.direction,
			amount: Number.parseFloat(this.amount), // Convert string to number for API
			currency: this.currency,
			currencyExponent: this.currencyExponent,
			resultingBalance: this.resultingBalance,
			status: this.status,
			metadata: this.metadata,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}

	// Helper method to post an entry (change status from pending to posted)
	public withPostedStatus(postedAt: Date): LedgerTransactionEntryEntity {
		return new LedgerTransactionEntryEntity({
			...this,
			status: "posted",
			updated: postedAt,
		});
	}

	// Helper method to validate entry amount is positive
	public isValidAmount(): boolean {
		const amount = Number.parseFloat(this.amount);
		return !Number.isNaN(amount) && amount > 0;
	}

	// Helper method to get amount as number
	public getAmountAsNumber(): number {
		return Number.parseFloat(this.amount);
	}
}

export type {
	LedgerTransactionEntryID,
	LedgerTransactionEntryEntityOpts,
	LedgerTransactionEntryRecord,
	LedgerTransactionEntryInsert,
	ResultingBalance,
};
export { LedgerTransactionEntryEntity };
