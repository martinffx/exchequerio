import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { LedgerTransactionEntriesTable } from "@/repo/schema";
import type {
	BalanceStatus,
	Direction,
	LedgerTransactionEntryResponse,
} from "@/routes/ledgers/schema";

// Infer types from Drizzle schema
type LedgerTransactionEntryRecord = InferSelectModel<typeof LedgerTransactionEntriesTable>;
type LedgerTransactionEntryInsert = InferInsertModel<typeof LedgerTransactionEntriesTable>;

type LedgerTransactionEntryID = TypeID<"lte">;
type LedgerTransactionID = TypeID<"ltr">;
type LedgerAccountID = TypeID<"lat">;
type OrgID = TypeID<"org">;

type LedgerTransactionEntryEntityOptions = {
	id: LedgerTransactionEntryID;
	organizationId: OrgID;
	transactionId: LedgerTransactionID;
	accountId: LedgerAccountID;
	direction: Direction;
	amount: number; // Integer minor units (e.g., 10050 = $100.50 for USD)
	currency: string;
	currencyExponent: number;
	status: BalanceStatus;
	metadata?: Record<string, unknown>;
	created?: Date;
	updated?: Date;
};

class LedgerTransactionEntryEntity {
	public readonly id: LedgerTransactionEntryID;
	public readonly organizationId: OrgID;
	public readonly transactionId: LedgerTransactionID;
	public readonly accountId: LedgerAccountID;
	public readonly direction: Direction;
	public readonly amount: number; // Integer minor units
	public readonly currency: string;
	public readonly currencyExponent: number;
	public readonly status: BalanceStatus;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;

	constructor(options: LedgerTransactionEntryEntityOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.transactionId = options.transactionId;
		this.accountId = options.accountId;
		this.direction = options.direction;
		this.amount = options.amount;
		this.currency = options.currency;
		this.currencyExponent = options.currencyExponent;
		this.status = options.status;
		this.metadata = options.metadata;
		this.created = options.created ?? new Date();
		this.updated = options.updated ?? new Date();
	}

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
			currency: record.currency,
			currencyExponent: record.currencyExponent,
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
			currency: this.currency,
			currencyExponent: this.currencyExponent,
			status: this.status,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			created: this.created,
			updated: this.updated,
		};
	}

	// Convert entity to API response - requires currency and balance information
	public toResponse(): Omit<LedgerTransactionEntryResponse, "resultingBalance"> {
		return {
			id: this.id.toString(),
			accountId: this.accountId.toString(),
			direction: this.direction,
			amount: this.amount, // Already a number (integer minor units)
			currency: this.currency,
			currencyExponent: this.currencyExponent,
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
}

export type {
	LedgerTransactionEntryID,
	LedgerTransactionEntryEntityOptions as LedgerTransactionEntryEntityOpts,
	LedgerTransactionEntryRecord,
	LedgerTransactionEntryInsert,
};
export { LedgerTransactionEntryEntity };
