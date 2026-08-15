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
	currencyCode?: string;
	minorUnitExponent?: number;
	pendingCredits: number;
	pendingDebits: number;
	postedCredits: number;
	postedDebits: number;
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
	public readonly currencyCode: string;
	public readonly minorUnitExponent: number;
	public readonly pendingCredits: number;
	public readonly pendingDebits: number;
	public readonly postedCredits: number;
	public readonly postedDebits: number;
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
		this.currencyCode = options.currencyCode ?? "USD";
		this.minorUnitExponent = options.minorUnitExponent ?? 2;
		this.pendingCredits = options.pendingCredits;
		this.pendingDebits = options.pendingDebits;
		this.postedCredits = options.postedCredits;
		this.postedDebits = options.postedDebits;
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
			pendingCredits: 0,
			pendingDebits: 0,
			postedCredits: 0,
			postedDebits: 0,
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
			currencyCode: record.currencyCode,
			minorUnitExponent: record.minorUnitExponent,
			pendingCredits: record.pendingCredits,
			pendingDebits: record.pendingDebits,
			postedCredits: record.postedCredits,
			postedDebits: record.postedDebits,
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
			currencyCode: this.currencyCode,
			minorUnitExponent: this.minorUnitExponent,
			pendingCredits: this.pendingCredits,
			pendingDebits: this.pendingDebits,
			postedCredits: this.postedCredits,
			postedDebits: this.postedDebits,
			lockVersion: this.lockVersion + 1,
			// Stringify metadata to TEXT (JSON string)
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			updated: new Date(),
		};
	}

	public toResponse(currency: string, currencyExponent: number): LedgerAccountResponse {
		const debitNormal = this.normalBalance === "debit";
		const pendingAmount = debitNormal
			? this.pendingDebits - this.pendingCredits
			: this.pendingCredits - this.pendingDebits;
		const postedAmount = debitNormal
			? this.postedDebits - this.postedCredits
			: this.postedCredits - this.postedDebits;
		const availableCredits = debitNormal ? this.pendingCredits : this.postedCredits;
		const availableDebits = debitNormal ? this.postedDebits : this.pendingDebits;
		const availableAmount = debitNormal
			? this.postedDebits - this.pendingCredits
			: this.postedCredits - this.pendingDebits;
		const balances: Balances = [
			{
				balanceType: "pending" as const,
				credits: this.pendingCredits,
				debits: this.pendingDebits,
				amount: pendingAmount,
				currency,
				currencyExponent,
			} satisfies PendingBalance,
			{
				balanceType: "posted" as const,
				credits: this.postedCredits,
				debits: this.postedDebits,
				amount: postedAmount,
				currency,
				currencyExponent,
			} satisfies PostedBalance,
			{
				balanceType: "availableBalance" as const,
				credits: availableCredits,
				debits: availableDebits,
				amount: availableAmount,
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
}

export type {
	LedgerAccountEntityOptions as LedgerAccountEntityOpts,
	LedgerAccountRecord,
	LedgerAccountInsert,
	NormalBalance,
};
export { LedgerAccountEntity };

export type { LedgerAccountID, LedgerID } from "./types";
