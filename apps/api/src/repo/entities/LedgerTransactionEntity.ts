import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import { ConflictError } from "@/errors";
import type { LedgerTransactionsTable } from "@/repo/schema";
import type {
	BalanceStatus,
	Direction,
	LedgerTransactionRequest,
	LedgerTransactionResponse,
} from "@/routes/ledgers/schema";
import type { LedgerEntity } from "./LedgerEntity";
import { LedgerTransactionEntryEntity } from "./LedgerTransactionEntryEntity";
import type { LedgerID, LedgerTransactionID, OrgID } from "./types";

// Infer types from Drizzle schema
type LedgerTransactionRecord = InferSelectModel<typeof LedgerTransactionsTable>;
type LedgerTransactionInsert = InferInsertModel<typeof LedgerTransactionsTable>;

// Input for creating transaction entries (simplified for service layer use)
type TransactionEntryInput = {
	accountId: string;
	direction: Direction;
	amount: number; // Integer minor units
};

type LedgerTransactionEntityOptions = {
	id: LedgerTransactionID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	entries: LedgerTransactionEntryEntity[]; // Required - transactions must have entries
	idempotencyKey?: string;
	description?: string;
	status: BalanceStatus;
	effectiveAt: Date; // When transaction happened for reporting purposes
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
};

type LedgerTransactionRequestOpts = {
	rq: LedgerTransactionRequest;
	ledger: LedgerEntity;
	id?: string;
};

class LedgerTransactionEntity {
	public readonly id: LedgerTransactionID;
	public readonly organizationId: OrgID;
	public readonly ledgerId: LedgerID;
	public readonly entries: readonly LedgerTransactionEntryEntity[];
	public readonly idempotencyKey?: string;
	public readonly description?: string;
	public readonly status: BalanceStatus;
	public readonly effectiveAt: Date;
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
		this.effectiveAt = options.effectiveAt;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	private validateEntries(entries: LedgerTransactionEntryEntity[]): void {
		if (entries.length < 2) {
			throw new Error("Transaction must have at least 2 entries");
		}

		// Check for duplicate accounts - each account can only have one entry per transaction
		const accountIds = new Set<string>();
		for (const entry of entries) {
			const accountId = entry.accountId.toString();
			if (accountIds.has(accountId)) {
				throw new Error(
					`Duplicate account in transaction: ${accountId}. Each account can only have one entry per transaction.`
				);
			}
			accountIds.add(accountId);
		}

		let totalDebits = 0;
		let totalCredits = 0;

		for (const entry of entries) {
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

	/**
	 * Posts a pending transaction, changing its status to "posted".
	 * Idempotent - returns the same transaction if already posted.
	 *
	 * @returns A new transaction entity with posted status
	 * @throws {ConflictError} If transaction is archived
	 */
	public postTransaction(): LedgerTransactionEntity {
		if (this.status === "posted") {
			return this; // Idempotent
		}

		if (this.status === "archived") {
			throw new ConflictError({
				message: "Cannot post an archived transaction",
			});
		}

		// Create new entity with posted status and updated entries
		const now = new Date();
		const postedEntries = this.entries.map(entry => entry.withPostedStatus(now));

		return new LedgerTransactionEntity({
			id: this.id,
			organizationId: this.organizationId,
			ledgerId: this.ledgerId,
			entries: postedEntries,
			idempotencyKey: this.idempotencyKey,
			description: this.description,
			status: "posted",
			effectiveAt: this.effectiveAt,
			metadata: this.metadata,
			created: this.created,
			updated: now,
		});
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
	public static fromRequest({
		rq,
		ledger,
		id,
	}: LedgerTransactionRequestOpts): LedgerTransactionEntity {
		const transactionId = id ? TypeID.fromString<"ltr">(id) : new TypeID("ltr");
		const created = new Date(rq.created);

		// Convert API entries to entry entities (amount is already integer minor units)
		const entries = rq.ledgerEntries.map(
			entry =>
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte"),
					organizationId: ledger.organizationId,
					transactionId,
					accountId: TypeID.fromString<"lat">(entry.accountId),
					direction: entry.direction,
					amount: entry.amount, // Already integer minor units
					currency: ledger.currency,
					currencyExponent: ledger.currencyExponent,
					status: rq.status,
					created,
					updated: new Date(rq.updated),
				})
		);

		return new LedgerTransactionEntity({
			id: transactionId,
			organizationId: ledger.organizationId,
			ledgerId: ledger.id,
			entries,
			description: rq.description,
			status: rq.status,
			effectiveAt: rq.effectiveAt ? new Date(rq.effectiveAt) : created,
			metadata: rq.metadata,
			created,
			updated: new Date(rq.updated),
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
			effectiveAt: record.effectiveAt,
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
			effectiveAt: this.effectiveAt,
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
			effectiveAt: this.effectiveAt.toISOString(),
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
