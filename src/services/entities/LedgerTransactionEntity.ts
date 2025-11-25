import type {
	LedgerTransactionRequest,
	LedgerTransactionResponse,
	BalanceStatus,
	Direction,
} from "@/routes/ledgers/schema";
import type { LedgerTransactionsTable } from "@/repo/schema";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import { LedgerTransactionEntryEntity } from "./LedgerTransactionEntryEntity";

// Infer types from Drizzle schema
type LedgerTransactionRecord = InferSelectModel<typeof LedgerTransactionsTable>;
type LedgerTransactionInsert = InferInsertModel<typeof LedgerTransactionsTable>;

type LedgerTransactionID = TypeID<"ltr">;
type LedgerID = TypeID<"lgr">;

// Input for creating transaction entries (simplified for service layer use)
type TransactionEntryInput = {
	accountId: string;
	direction: Direction;
	amount: string;
};

type LedgerTransactionEntityOpts = {
	id: LedgerTransactionID;
	ledgerId: LedgerID;
	idempotencyKey?: string;
	description?: string;
	status: BalanceStatus;
	postedAt?: Date;
	effectiveAt?: Date;
	reversesTransactionId?: LedgerTransactionID;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
	// Embedded entries for complete transactions
	entries?: LedgerTransactionEntryEntity[];
};

class LedgerTransactionEntity {
	public readonly id: LedgerTransactionID;
	public readonly ledgerId: LedgerID;
	public readonly idempotencyKey?: string;
	public readonly description?: string;
	public readonly status: BalanceStatus;
	public readonly postedAt?: Date;
	public readonly effectiveAt?: Date;
	public readonly reversesTransactionId?: LedgerTransactionID;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;
	public readonly entries?: LedgerTransactionEntryEntity[];

	constructor(opts: LedgerTransactionEntityOpts) {
		this.id = opts.id;
		this.ledgerId = opts.ledgerId;
		this.idempotencyKey = opts.idempotencyKey;
		this.description = opts.description;
		this.status = opts.status;
		this.postedAt = opts.postedAt;
		this.effectiveAt = opts.effectiveAt;
		this.reversesTransactionId = opts.reversesTransactionId;
		this.metadata = opts.metadata;
		this.created = opts.created;
		this.updated = opts.updated;
		this.entries = opts.entries;
	}

	// Create transaction from entry inputs (used by service layer)
	public static createWithEntries(
		ledgerId: LedgerID,
		entryInputs: TransactionEntryInput[],
		description?: string,
		idempotencyKey?: string,
		effectiveAt?: Date,
		id?: string,
	): LedgerTransactionEntity {
		const now = new Date();
		const transactionId = id ? TypeID.fromString<"ltr">(id) : new TypeID("ltr");

		// Validate double-entry requirement
		LedgerTransactionEntity.validateDoubleEntry(entryInputs);

		// Create entry entities
		const entries = entryInputs.map((input) =>
			LedgerTransactionEntryEntity.create(
				transactionId,
				TypeID.fromString<"lat">(input.accountId),
				input.direction,
				input.amount,
			),
		);

		return new LedgerTransactionEntity({
			id: transactionId,
			ledgerId,
			idempotencyKey,
			description,
			status: "pending", // New transactions start as pending
			effectiveAt,
			created: now,
			updated: now,
			entries,
		});
	}

	// Create entity from API request - requires ledgerId
	public static fromRequest(
		rq: LedgerTransactionRequest,
		ledgerId: LedgerID,
		id?: string,
	): LedgerTransactionEntity {
		const now = new Date();
		const transactionId = id ? TypeID.fromString<"ltr">(id) : new TypeID("ltr");

		// Convert API entries to entry entities
		const entries = rq.ledgerEntries.map((apiEntry) =>
			LedgerTransactionEntryEntity.create(
				transactionId,
				TypeID.fromString<"lat">(apiEntry.ledgerAccountId),
				apiEntry.direction,
				apiEntry.amount.toString(), // Convert number to string for precision
			),
		);

		return new LedgerTransactionEntity({
			id: transactionId,
			ledgerId,
			description: rq.description,
			status: rq.status,
			effectiveAt: rq.effectiveAt ? new Date(rq.effectiveAt) : undefined,
			metadata: rq.metadata,
			created: now,
			updated: now,
			entries,
		});
	}

	// Create entity from database record
	public static fromRecord(
		record: LedgerTransactionRecord,
	): LedgerTransactionEntity {
		return new LedgerTransactionEntity({
			id: TypeID.fromString<"ltr">(record.id),
			ledgerId: TypeID.fromString<"lgr">(record.ledgerId),
			idempotencyKey: record.idempotencyKey ?? undefined,
			description: record.description ?? undefined,
			status: record.status as BalanceStatus,
			postedAt: record.postedAt ?? undefined,
			effectiveAt: record.effectiveAt ?? undefined,
			reversesTransactionId: record.reversesTransactionId
				? TypeID.fromString<"ltr">(record.reversesTransactionId)
				: undefined,
			metadata: record.metadata as Record<string, unknown> | undefined,
			created: record.created,
			updated: record.updated,
		});
	}

	// Create entity from database record with entries
	public static fromRecordWithEntries(
		record: LedgerTransactionRecord,
		entries: LedgerTransactionEntryEntity[],
	): LedgerTransactionEntity {
		const entity = LedgerTransactionEntity.fromRecord(record);
		return new LedgerTransactionEntity({
			...entity,
			entries,
		});
	}

	// Convert entity to database record for insert/update
	public toRecord(): LedgerTransactionInsert {
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			idempotencyKey: this.idempotencyKey ?? null,
			description: this.description ?? null,
			status: this.status,
			postedAt: this.postedAt ?? null,
			effectiveAt: this.effectiveAt ?? null,
			reversesTransactionId: this.reversesTransactionId?.toString() ?? null,
			metadata: this.metadata,
			created: this.created,
			updated: this.updated,
		};
	}

	// Convert entity to API response - requires entries
	public toResponse(): LedgerTransactionResponse {
		if (!this.entries) {
			throw new Error(
				"Transaction entries required for response conversion. Use fromRecordWithEntries()",
			);
		}

		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			description: this.description,
			status: this.status,
			metadata: this.metadata,
			ledgerEntries: this.entries.map((entry) => entry.toResponse()),
			postedAt: this.postedAt?.toISOString(),
			effectiveAt: this.effectiveAt?.toISOString(),
			reversedByLedgerTransactionId: undefined, // TODO: Add reverse lookup
			reversesLedgerTransactionId: this.reversesTransactionId?.toString(),
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}

	// Helper method to post a transaction (change status and set postedAt)
	public withPostedStatus(postedAt?: Date): LedgerTransactionEntity {
		const postDate = postedAt ?? new Date();

		// Post all entries as well
		const postedEntries = this.entries?.map((entry) =>
			entry.withPostedStatus(postDate),
		);

		return new LedgerTransactionEntity({
			...this,
			status: "posted",
			postedAt: postDate,
			updated: postDate,
			entries: postedEntries,
		});
	}

	// Helper method to validate double-entry compliance
	private static validateDoubleEntry(
		entryInputs: TransactionEntryInput[],
	): void {
		if (entryInputs.length < 2) {
			throw new Error("Transaction must have at least 2 entries");
		}

		let totalDebits = 0;
		let totalCredits = 0;

		for (const entry of entryInputs) {
			const amount = Number.parseFloat(entry.amount);

			if (Number.isNaN(amount) || amount <= 0) {
				throw new Error(`Invalid amount: ${entry.amount}`);
			}

			if (entry.direction === "debit") {
				totalDebits += amount;
			} else if (entry.direction === "credit") {
				totalCredits += amount;
			} else {
				throw new Error(`Invalid direction: ${entry.direction}`);
			}
		}

		const tolerance = 0.0001;
		if (Math.abs(totalDebits - totalCredits) > tolerance) {
			throw new Error(
				`Double-entry validation failed: debits (${totalDebits}) must equal credits (${totalCredits})`,
			);
		}
	}

	// Helper method to check if transaction is balanced
	public isBalanced(): boolean {
		if (!this.entries || this.entries.length < 2) {
			return false;
		}

		let totalDebits = 0;
		let totalCredits = 0;

		for (const entry of this.entries) {
			const amount = entry.getAmountAsNumber();

			if (entry.direction === "debit") {
				totalDebits += amount;
			} else {
				totalCredits += amount;
			}
		}

		const tolerance = 0.0001;
		return Math.abs(totalDebits - totalCredits) <= tolerance;
	}

	// Helper method to get total transaction amount
	public getTotalAmount(): number {
		if (!this.entries) return 0;

		return this.entries
			.filter((entry) => entry.direction === "debit")
			.reduce((sum, entry) => sum + entry.getAmountAsNumber(), 0);
	}
}

export type {
	LedgerTransactionID,
	LedgerTransactionEntityOpts,
	LedgerTransactionRecord,
	LedgerTransactionInsert,
	TransactionEntryInput,
};
export { LedgerTransactionEntity };
