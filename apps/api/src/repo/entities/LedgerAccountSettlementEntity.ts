import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { LedgerAccountSettlementsTable } from "@/repo/schema";
import type {
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	NormalBalance,
	SettlementStatus,
} from "@/routes/ledgers/schema";
import type {
	LedgerAccountID,
	LedgerAccountSettlementID,
	LedgerTransactionID,
	OrgID,
} from "./types";

// Infer types from Drizzle schema
type LedgerAccountSettlementRecord = InferSelectModel<typeof LedgerAccountSettlementsTable>;
type LedgerAccountSettlementInsert = InferInsertModel<typeof LedgerAccountSettlementsTable>;

type LedgerAccountSettlementEntityOptions = {
	id: LedgerAccountSettlementID;
	organizationId: OrgID;
	transactionId?: LedgerTransactionID;
	settledAccountId: LedgerAccountID;
	contraAccountId: LedgerAccountID;
	amount: number; // Integer minor units
	normalBalance: NormalBalance;
	currency: string;
	currencyExponent: number;
	status: SettlementStatus;
	description?: string;
	externalReference?: string;
	effectiveAtUpperBound?: Date;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
};

class LedgerAccountSettlementEntity {
	public readonly id: LedgerAccountSettlementID;
	public readonly organizationId: OrgID;
	public readonly transactionId?: LedgerTransactionID;
	public readonly settledAccountId: LedgerAccountID;
	public readonly contraAccountId: LedgerAccountID;
	public readonly amount: number; // Integer minor units
	public readonly normalBalance: NormalBalance;
	public readonly currency: string;
	public readonly currencyExponent: number;
	public readonly status: SettlementStatus;
	public readonly description?: string;
	public readonly externalReference?: string;
	public readonly effectiveAtUpperBound?: Date;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;

	constructor(options: LedgerAccountSettlementEntityOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.transactionId = options.transactionId;
		this.settledAccountId = options.settledAccountId;
		this.contraAccountId = options.contraAccountId;
		this.amount = options.amount;
		this.normalBalance = options.normalBalance;
		this.currency = options.currency;
		this.currencyExponent = options.currencyExponent;
		this.status = options.status;
		this.description = options.description;
		this.externalReference = options.externalReference;
		this.effectiveAtUpperBound = options.effectiveAtUpperBound;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	/**
	 * Creates a settlement entity from API request data.
	 */
	public static fromRequest(
		rq: LedgerAccountSettlementRequest,
		orgId: OrgID,
		currency: string,
		currencyExponent: number,
		normalBalance: NormalBalance,
		id?: string
	): LedgerAccountSettlementEntity {
		const now = new Date();
		return new LedgerAccountSettlementEntity({
			id: id ? TypeID.fromString<"las">(id) : new TypeID("las"),
			organizationId: orgId,
			transactionId: rq.transactionId ? TypeID.fromString<"ltr">(rq.transactionId) : undefined,
			settledAccountId: TypeID.fromString<"lat">(rq.settledAccountId),
			contraAccountId: TypeID.fromString<"lat">(rq.contraAccountId),
			amount: 0, // Calculated from entries
			normalBalance,
			currency,
			currencyExponent,
			status: rq.status,
			description: rq.description,
			externalReference: rq.externalReference,
			effectiveAtUpperBound: rq.effectiveAtUpperBound ? new Date(rq.effectiveAtUpperBound) : undefined,
			metadata: rq.metadata,
			created: now,
			updated: now,
		});
	}

	/**
	 * Creates an entity from database record.
	 */
	public static fromRecord(record: LedgerAccountSettlementRecord): LedgerAccountSettlementEntity {
		// Parse metadata from TEXT (JSON string) to object
		let metadata: Record<string, unknown> | undefined;
		if (record.metadata) {
			try {
				metadata = JSON.parse(record.metadata) as Record<string, unknown>;
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerAccountSettlementEntity({
			id: TypeID.fromString<"las">(record.id),
			organizationId: TypeID.fromString<"org">(record.organizationId),
			transactionId: record.transactionId ? TypeID.fromString<"ltr">(record.transactionId) : undefined,
			settledAccountId: TypeID.fromString<"lat">(record.settledAccountId),
			contraAccountId: TypeID.fromString<"lat">(record.contraAccountId),
			amount: record.amount,
			normalBalance: record.normalBalance,
			currency: record.currency,
			currencyExponent: record.currencyExponent,
			status: record.status,
			description: record.description ?? undefined,
			externalReference: record.externalReference ?? undefined,
			effectiveAtUpperBound: record.effectiveAtUpperBound ?? undefined,
			metadata,
			created: record.created,
			updated: record.updated,
		});
	}

	/**
	 * Converts entity to database record for insert/update.
	 */
	public toRecord(): LedgerAccountSettlementInsert {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			transactionId: this.transactionId?.toString() ?? undefined,
			settledAccountId: this.settledAccountId.toString(),
			contraAccountId: this.contraAccountId.toString(),
			amount: this.amount,
			normalBalance: this.normalBalance,
			currency: this.currency,
			currencyExponent: this.currencyExponent,
			status: this.status,
			description: this.description ?? undefined,
			externalReference: this.externalReference ?? undefined,
			effectiveAtUpperBound: this.effectiveAtUpperBound ?? undefined,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			created: this.created,
			updated: this.updated,
		};
	}

	/**
	 * Converts entity to API response.
	 */
	public toResponse(): LedgerAccountSettlementResponse {
		return {
			id: this.id.toString(),
			transactionId: this.transactionId?.toString() ?? "",
			settledAccountId: this.settledAccountId.toString(),
			contraAccountId: this.contraAccountId.toString(),
			amount: this.amount,
			normalBalance: this.normalBalance,
			currency: this.currency,
			currencyExponent: this.currencyExponent,
			status: this.status,
			description: this.description,
			metadata: this.metadata,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}

	/**
	 * Returns a new entity with updated amount (immutable update).
	 */
	public withAmount(amount: number): LedgerAccountSettlementEntity {
		return new LedgerAccountSettlementEntity({
			...this,
			amount,
			updated: new Date(),
		});
	}

	/**
	 * Returns a new entity with updated status (immutable update).
	 */
	public withStatus(status: SettlementStatus): LedgerAccountSettlementEntity {
		return new LedgerAccountSettlementEntity({
			...this,
			status,
			updated: new Date(),
		});
	}

	/**
	 * Returns a new entity with linked transaction ID (immutable update).
	 */
	public withTransactionId(txId: LedgerTransactionID): LedgerAccountSettlementEntity {
		return new LedgerAccountSettlementEntity({
			...this,
			transactionId: txId,
			updated: new Date(),
		});
	}
}

export type {
	LedgerAccountSettlementEntityOptions as LedgerAccountSettlementEntityOpts,
	LedgerAccountSettlementRecord,
	LedgerAccountSettlementInsert,
};
export { LedgerAccountSettlementEntity };
