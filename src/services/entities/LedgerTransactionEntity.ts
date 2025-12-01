import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { LedgerTransactionsTable } from "@/repo/schema";
import type {
	BalanceStatus,
	Direction,
	LedgerTransactionRequest,
	LedgerTransactionResponse,
} from "@/routes/ledgers/schema";
import { LedgerTransactionEntryEntity } from "./LedgerTransactionEntryEntity";
import type { LedgerID, LedgerTransactionID, OrgID } from "./types";
import { NotImplementedError } from "@/errors";

// Infer types from Drizzle schema
type LedgerTransactionRecord = InferSelectModel<typeof LedgerTransactionsTable>;
type LedgerTransactionInsert = InferInsertModel<typeof LedgerTransactionsTable>;

// Input for creating transaction entries (simplified for service layer use)
interface TransactionEntryInput {
	accountId: string;
	direction: Direction;
	amount: number; // Integer minor units
}

interface LedgerTransactionEntityOptions {
	id: LedgerTransactionID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	entries: LedgerTransactionEntryEntity[]; // Required - transactions must have entries
	idempotencyKey?: string;
	description?: string;
	status: BalanceStatus;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
}

class LedgerTransactionEntity {
	public readonly id: LedgerTransactionID;
	public readonly organizationId: OrgID;
	public readonly ledgerId: LedgerID;
	public readonly entries: readonly LedgerTransactionEntryEntity[];
	public readonly idempotencyKey?: string;
	public readonly description?: string;
	public readonly status: BalanceStatus;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;

	constructor(options: LedgerTransactionEntityOptions) {
		// Enforce invariants: transactions must have valid entries
		this.validateEntries(options.entries);

		this.id = options.id;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.entries = Object.freeze([...options.entries]); // Immutable
		this.idempotencyKey = options.idempotencyKey;
		this.description = options.description;
		this.status = options.status;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	private validateEntries(entries: LedgerTransactionEntryEntity[]): void {
		if (entries.length < 2) {
			throw new Error("Transaction must have at least 2 entries");
		}

		let totalDebits = 0;
		let totalCredits = 0;

		for (const entry of entries) {
			if (!entry.isValidAmount()) {
				throw new Error(`Invalid entry amount: ${entry.amount}`);
			}

			if (entry.direction === "debit") {
				totalDebits += entry.amount;
			} else if (entry.direction === "credit") {
				totalCredits += entry.amount;
			} else {
				throw new Error(`Invalid direction: ${entry.direction as string}`);
			}
		}

		// Integer comparison - no tolerance needed
		if (totalDebits !== totalCredits) {
			throw new Error(
				`Double-entry validation failed: debits (${totalDebits}) must equal credits (${totalCredits})`
			);
		}
	}

	public postTransaction(): LedgerTransactionEntity {
		throw new NotImplementedError("post transaction");
	}

	/**
	 * Creates a transaction entity from API request data.
	 *
	 * @param rq - The API request containing transaction details
	 * @param organizationId - Organization that owns this transaction
	 * @param ledgerId - Ledger this transaction belongs to
	 * @param id - Optional transaction ID (generates new one if not provided)
	 * @returns A new transaction entity with validated entries
	 */
	public static fromRequest(
		rq: LedgerTransactionRequest,
		organizationId: OrgID,
		ledgerId: LedgerID,
		id?: string
	): LedgerTransactionEntity {
		const now = new Date();
		const transactionId = id ? TypeID.fromString<"ltr">(id) : new TypeID("ltr");

		// Convert API entries to entry entities (amount is already integer minor units)
		const entries = rq.ledgerEntries.map(apiEntry =>
			LedgerTransactionEntryEntity.create(
				organizationId,
				transactionId,
				TypeID.fromString<"lat">(apiEntry.ledgerAccountId),
				apiEntry.direction,
				apiEntry.amount // Already integer minor units
			)
		);

		return new LedgerTransactionEntity({
			id: transactionId,
			organizationId,
			ledgerId,
			entries,
			description: rq.description,
			status: rq.status,
			metadata: rq.metadata,
			created: now,
			updated: now,
		});
	}

	/**
	 * Creates a transaction entity directly from entry inputs (for testing and service layer).
	 *
	 * @param organizationId - Organization that owns this transaction
	 * @param ledgerId - Ledger this transaction belongs to
	 * @param entries - Array of entry inputs (accountId, direction, amount)
	 * @param description - Optional transaction description
	 * @param idempotencyKey - Optional idempotency key for duplicate detection
	 * @returns A new pending transaction entity with validated entries
	 */
	public static createWithEntries(
		organizationId: OrgID,
		ledgerId: LedgerID,
		entries: TransactionEntryInput[],
		description?: string,
		idempotencyKey?: string
	): LedgerTransactionEntity {
		const now = new Date();
		const transactionId = new TypeID("ltr");

		// Convert entry inputs to entry entities
		const entryEntities = entries.map(input =>
			LedgerTransactionEntryEntity.create(
				organizationId,
				transactionId,
				TypeID.fromString<"lat">(input.accountId),
				input.direction,
				input.amount // Integer minor units
			)
		);

		return new LedgerTransactionEntity({
			id: transactionId,
			organizationId,
			ledgerId,
			entries: entryEntities,
			description,
			idempotencyKey,
			status: "pending",
			metadata: undefined,
			created: now,
			updated: now,
		});
	}

	// Create entity from database record with entries (primary factory from DB)
	public static fromRecord(
		record: LedgerTransactionRecord,
		entries: LedgerTransactionEntryEntity[]
	): LedgerTransactionEntity {
		// Parse metadata from TEXT (JSON string) to object
		let metadata: Record<string, unknown> | undefined;
		if (record.metadata) {
			try {
				metadata = JSON.parse(record.metadata) as Record<string, unknown>;
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerTransactionEntity({
			id: TypeID.fromString<"ltr">(record.id),
			organizationId: TypeID.fromString<"org">(record.organizationId),
			ledgerId: TypeID.fromString<"lgr">(record.ledgerId),
			entries,
			idempotencyKey: record.idempotencyKey ?? undefined,
			description: record.description ?? undefined,
			status: record.status,
			metadata,
			created: record.created,
			updated: record.updated,
		});
	}

	// Convert entity to database record for insert/update
	public toRecord(): LedgerTransactionInsert {
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			organizationId: this.organizationId.toString(),
			idempotencyKey: this.idempotencyKey ?? undefined,
			description: this.description ?? undefined,
			status: this.status,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			created: this.created,
			updated: this.updated,
		};
	}

	// Convert entity to API response
	public toResponse(): LedgerTransactionResponse {
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			description: this.description,
			status: this.status,
			metadata: this.metadata,
			ledgerEntries: this.entries.map(entry => entry.toResponse()),
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}
}

export type {
	LedgerTransactionEntityOptions as LedgerTransactionEntityOpts,
	LedgerTransactionRecord,
	LedgerTransactionInsert,
	TransactionEntryInput,
};
export { LedgerTransactionEntity };

export type { LedgerTransactionID } from "./types";
