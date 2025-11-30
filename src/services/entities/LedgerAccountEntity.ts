import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { LedgerAccountsTable } from "@/repo/schema";
import type {
	AvailableBalance,
	Balances,
	LedgerAccountRequest,
	LedgerAccountResponse,
	PendingBalance,
	PostedBalance,
} from "@/routes/ledgers/schema";
import type { LedgerAccountID, LedgerID, OrgID } from "./types";

// Infer types from Drizzle schema
type LedgerAccountRecord = InferSelectModel<typeof LedgerAccountsTable>;
type LedgerAccountInsert = InferInsertModel<typeof LedgerAccountsTable>;
type NormalBalance = "debit" | "credit";

interface LedgerAccountEntityOptions {
	id: LedgerAccountID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	name: string;
	description?: string;
	normalBalance: NormalBalance;
	// Individual balance fields (integers in minor units)
	pendingAmount: number;
	postedAmount: number;
	availableAmount: number;
	pendingCredits: number;
	pendingDebits: number;
	postedCredits: number;
	postedDebits: number;
	availableCredits: number;
	availableDebits: number;
	lockVersion: number;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
}

class LedgerAccountEntity {
	public readonly id: LedgerAccountID;
	public readonly organizationId: OrgID;
	public readonly ledgerId: LedgerID;
	public readonly name: string;
	public readonly description?: string;
	public readonly normalBalance: NormalBalance;
	// Individual balance fields (integers in minor units)
	public readonly pendingAmount: number;
	public readonly postedAmount: number;
	public readonly availableAmount: number;
	public readonly pendingCredits: number;
	public readonly pendingDebits: number;
	public readonly postedCredits: number;
	public readonly postedDebits: number;
	public readonly availableCredits: number;
	public readonly availableDebits: number;
	public readonly lockVersion: number;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;

	constructor(options: LedgerAccountEntityOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.name = options.name;
		this.description = options.description;
		this.normalBalance = options.normalBalance;
		this.pendingAmount = options.pendingAmount;
		this.postedAmount = options.postedAmount;
		this.availableAmount = options.availableAmount;
		this.pendingCredits = options.pendingCredits;
		this.pendingDebits = options.pendingDebits;
		this.postedCredits = options.postedCredits;
		this.postedDebits = options.postedDebits;
		this.availableCredits = options.availableCredits;
		this.availableDebits = options.availableDebits;
		this.lockVersion = options.lockVersion;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	public static fromRequest(
		rq: LedgerAccountRequest,
		organizationId: OrgID,
		ledgerId: LedgerID,
		normalBalance: NormalBalance,
		id?: string
	): LedgerAccountEntity {
		const now = new Date();
		return new LedgerAccountEntity({
			id: id ? TypeID.fromString<"lat">(id) : new TypeID("lat"),
			organizationId,
			ledgerId,
			name: rq.name,
			description: rq.description,
			normalBalance,
			// Initialize all balances to zero (integer minor units)
			pendingAmount: 0,
			postedAmount: 0,
			availableAmount: 0,
			pendingCredits: 0,
			pendingDebits: 0,
			postedCredits: 0,
			postedDebits: 0,
			availableCredits: 0,
			availableDebits: 0,
			lockVersion: 0,
			metadata: rq.metadata,
			created: now,
			updated: now,
		});
	}

	public static fromRecord(record: LedgerAccountRecord): LedgerAccountEntity {
		// Parse metadata from TEXT (JSON string) to object
		let metadata: Record<string, unknown> | undefined;
		if (record.metadata) {
			try {
				metadata = JSON.parse(record.metadata) as Record<string, unknown>;
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerAccountEntity({
			id: TypeID.fromString<"lat">(record.id),
			organizationId: TypeID.fromString<"org">(record.organizationId),
			ledgerId: TypeID.fromString<"lgr">(record.ledgerId),
			name: record.name,
			description: record.description ?? undefined,
			normalBalance: record.normalBalance as NormalBalance,
			// Individual balance fields (already integers from DB)
			pendingAmount: record.pendingAmount,
			postedAmount: record.postedAmount,
			availableAmount: record.availableAmount,
			pendingCredits: record.pendingCredits,
			pendingDebits: record.pendingDebits,
			postedCredits: record.postedCredits,
			postedDebits: record.postedDebits,
			availableCredits: record.availableCredits,
			availableDebits: record.availableDebits,
			lockVersion: record.lockVersion,
			metadata,
			created: record.created,
			updated: record.updated,
		});
	}

	public toRecord(): LedgerAccountInsert {
		return {
			id: this.id.toString(),
			organizationId: this.organizationId.toString(),
			ledgerId: this.ledgerId.toString(),
			name: this.name,
			description: this.description ?? undefined,
			normalBalance: this.normalBalance,
			// Individual balance fields (integers)
			pendingAmount: this.pendingAmount,
			postedAmount: this.postedAmount,
			availableAmount: this.availableAmount,
			pendingCredits: this.pendingCredits,
			pendingDebits: this.pendingDebits,
			postedCredits: this.postedCredits,
			postedDebits: this.postedDebits,
			availableCredits: this.availableCredits,
			availableDebits: this.availableDebits,
			lockVersion: this.lockVersion + 1,
			// Stringify metadata to TEXT (JSON string)
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			updated: new Date(),
		};
	}

	public toResponse(currency: string, currencyExponent: number): LedgerAccountResponse {
		const balances: Balances = [
			{
				balanceType: "pending" as const,
				credits: this.pendingCredits,
				debits: this.pendingDebits,
				amount: this.pendingAmount,
				currency,
				currencyExponent,
			} satisfies PendingBalance,
			{
				balanceType: "posted" as const,
				credits: this.postedCredits,
				debits: this.postedDebits,
				amount: this.postedAmount,
				currency,
				currencyExponent,
			} satisfies PostedBalance,
			{
				balanceType: "availableBalance" as const,
				credits: this.availableCredits,
				debits: this.availableDebits,
				amount: this.availableAmount,
				currency,
				currencyExponent,
			} satisfies AvailableBalance,
		];

		return {
			id: this.id.toString(),
			name: this.name,
			description: this.description,
			normalBalance: this.normalBalance,
			balances,
			ledgerId: this.ledgerId.toString(),
			metadata: this.metadata,
			lockVersion: this.lockVersion,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}

	// Helper method to update balance fields (for optimistic locking)
	public withUpdatedBalance(
		postedAmount: number,
		availableAmount: number,
		newLockVersion: number
	): LedgerAccountEntity {
		return new LedgerAccountEntity({
			...this,
			postedAmount,
			availableAmount,
			lockVersion: newLockVersion,
			updated: new Date(),
		});
	}
}

export type {
	LedgerAccountEntityOptions as LedgerAccountEntityOpts,
	LedgerAccountRecord,
	LedgerAccountInsert,
	NormalBalance,
};
export { LedgerAccountEntity };

export type { LedgerAccountID, LedgerID } from "./types";
