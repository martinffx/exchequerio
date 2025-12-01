import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { LedgerTransactionEntriesTable } from "@/repo/schema";
import type {
	AvailableBalance,
	BalanceStatus,
	Direction,
	LedgerTransactionEntryResponse,
	PendingBalance,
	PostedBalance,
} from "@/routes/ledgers/schema";

// Infer types from Drizzle schema
type LedgerTransactionEntryRecord = InferSelectModel<typeof LedgerTransactionEntriesTable>;
type LedgerTransactionEntryInsert = InferInsertModel<typeof LedgerTransactionEntriesTable>;

type LedgerTransactionEntryID = TypeID<"lte">;
type LedgerTransactionID = TypeID<"ltr">;
type LedgerAccountID = TypeID<"lat">;
type OrgID = TypeID<"org">;

// Resulting balance structure for API responses
interface ResultingBalance {
	pendingBalance: PendingBalance;
	postedBalance: PostedBalance;
	availableBalance: AvailableBalance;
}

interface LedgerTransactionEntryEntityOptions {
	id: LedgerTransactionEntryID;
	organizationId: OrgID;
	transactionId: LedgerTransactionID;
	accountId: LedgerAccountID;
	direction: Direction;
	amount: number; // Integer minor units (e.g., 10050 = $100.50 for USD)
	status: BalanceStatus;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
	// Optional for API responses - calculated by repository
	currency?: string;
	currencyExponent?: number;
	resultingBalance?: ResultingBalance;
}

class LedgerTransactionEntryEntity {
	public readonly id: LedgerTransactionEntryID;
	public readonly organizationId: OrgID;
	public readonly transactionId: LedgerTransactionID;
	public readonly accountId: LedgerAccountID;
	public readonly direction: Direction;
	public readonly amount: number; // Integer minor units
	public readonly status: BalanceStatus;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;
	// For API responses
	public readonly currency?: string;
	public readonly currencyExponent?: number;
	public readonly resultingBalance?: ResultingBalance;

	constructor(options: LedgerTransactionEntryEntityOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.transactionId = options.transactionId;
		this.accountId = options.accountId;
		this.direction = options.direction;
		this.amount = options.amount;
		this.status = options.status;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
		this.currency = options.currency;
		this.currencyExponent = options.currencyExponent;
		this.resultingBalance = options.resultingBalance;
	}

	// Create entry for transaction creation (used by service layer)
	public static create(
		organizationId: OrgID,
		transactionId: LedgerTransactionID,
		accountId: LedgerAccountID,
		direction: Direction,
		amount: number, // Integer minor units
		id?: string
	): LedgerTransactionEntryEntity {
		const now = new Date();
		return new LedgerTransactionEntryEntity({
			id: id ? TypeID.fromString<"lte">(id) : new TypeID("lte"),
			organizationId,
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
	public static fromRecord(record: LedgerTransactionEntryRecord): LedgerTransactionEntryEntity {
		// Parse metadata from TEXT (JSON string) to object
		let metadata: Record<string, unknown> | undefined;
		if (record.metadata) {
			try {
				metadata = JSON.parse(record.metadata) as Record<string, unknown>;
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerTransactionEntryEntity({
			id: TypeID.fromString<"lte">(record.id),
			organizationId: TypeID.fromString<"org">(record.organizationId),
			transactionId: TypeID.fromString<"ltr">(record.transactionId),
			accountId: TypeID.fromString<"lat">(record.accountId),
			direction: record.direction,
			amount: record.amount, // Already integer from DB
			status: record.status,
			metadata,
			created: record.created,
			updated: record.updated,
		});
	}

	// Convert entity to database record for insert/update
	public toRecord(): LedgerTransactionEntryInsert {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			transactionId: this.transactionId.toString(),
			accountId: this.accountId.toString(),
			direction: this.direction,
			amount: this.amount, // Integer minor units
			status: this.status,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			created: this.created,
			updated: this.updated,
		};
	}

	// Convert entity to API response - requires currency and balance information
	public toResponse(): LedgerTransactionEntryResponse {
		if (!this.currency || this.currencyExponent === undefined || !this.resultingBalance) {
			throw new Error(
				"Currency and balance information required for response conversion. Use fromRecordWithBalance()"
			);
		}

		return {
			id: this.id.toString(),
			ledgerAccountId: this.accountId.toString(),
			direction: this.direction,
			amount: this.amount, // Already a number (integer minor units)
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

	// Helper method to validate entry amount is positive integer
	public isValidAmount(): boolean {
		return !Number.isNaN(this.amount) && this.amount > 0 && Number.isInteger(this.amount);
	}

	// Helper method to get amount as number (already a number)
	public getAmountAsNumber(): number {
		return this.amount;
	}
}

export type {
	LedgerTransactionEntryID,
	LedgerTransactionEntryEntityOptions as LedgerTransactionEntryEntityOpts,
	LedgerTransactionEntryRecord,
	LedgerTransactionEntryInsert,
	ResultingBalance,
};
export { LedgerTransactionEntryEntity };
