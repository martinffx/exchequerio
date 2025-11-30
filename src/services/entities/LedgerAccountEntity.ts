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

// Balance calculation structure
interface BalanceData {
	pendingAmount: number;
	postedAmount: number;
	availableAmount: number;
	pendingCredits: number;
	pendingDebits: number;
	postedCredits: number;
	postedDebits: number;
	availableCredits: number;
	availableDebits: number;
	currency: string;
	currencyExponent: number;
}

interface LedgerAccountEntityOptions {
	id: LedgerAccountID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	name: string;
	description?: string;
	normalBalance: NormalBalance;
	balanceAmount: string;
	lockVersion: number;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
	// Optional balance data for responses - calculated by repository
	balanceData?: BalanceData;
}

class LedgerAccountEntity {
	public readonly id: LedgerAccountID;
	public readonly organizationId: OrgID;
	public readonly ledgerId: LedgerID;
	public readonly name: string;
	public readonly description?: string;
	public readonly normalBalance: NormalBalance;
	public readonly balanceAmount: string;
	public readonly lockVersion: number;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;
	public readonly balanceData?: BalanceData;

	constructor(options: LedgerAccountEntityOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.name = options.name;
		this.description = options.description;
		this.normalBalance = options.normalBalance;
		this.balanceAmount = options.balanceAmount;
		this.lockVersion = options.lockVersion;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
		this.balanceData = options.balanceData;
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
			balanceAmount: "0", // New accounts start with zero balance
			lockVersion: 0,
			metadata: rq.metadata,
			created: now,
			updated: now,
		});
	}

	public static fromRecord(record: LedgerAccountRecord): LedgerAccountEntity {
		return new LedgerAccountEntity({
			id: TypeID.fromString<"lat">(record.id),
			organizationId: TypeID.fromString<"org">(record.organizationId),
			ledgerId: TypeID.fromString<"lgr">(record.ledgerId),
			name: record.name,
			description: record.description ?? undefined,
			normalBalance: record.normalBalance as NormalBalance,
			balanceAmount: record.balanceAmount === "0.0000" ? "0" : record.balanceAmount,
			lockVersion: record.lockVersion,
			metadata: record.metadata as Record<string, unknown> | undefined,
			created: record.created,
			updated: record.updated,
		});
	}

	public static fromRecordWithBalances(
		record: LedgerAccountRecord,
		balanceData: BalanceData
	): LedgerAccountEntity {
		const entity = LedgerAccountEntity.fromRecord(record);
		return new LedgerAccountEntity({
			...entity,
			balanceData,
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
			balanceAmount: this.balanceAmount,
			lockVersion: this.lockVersion + 1,
			metadata: this.metadata,
			updated: new Date(),
		};
	}

	public toResponse(): LedgerAccountResponse {
		if (!this.balanceData) {
			throw new Error("Balance data required for response conversion. Use fromRecordWithBalances()");
		}

		const balances: Balances = [
			{
				balanceType: "pending" as const,
				credits: this.balanceData.pendingCredits,
				debits: this.balanceData.pendingDebits,
				amount: this.balanceData.pendingAmount,
				currency: this.balanceData.currency,
				currencyExponent: this.balanceData.currencyExponent,
			} satisfies PendingBalance,
			{
				balanceType: "posted" as const,
				credits: this.balanceData.postedCredits,
				debits: this.balanceData.postedDebits,
				amount: this.balanceData.postedAmount,
				currency: this.balanceData.currency,
				currencyExponent: this.balanceData.currencyExponent,
			} satisfies PostedBalance,
			{
				balanceType: "availableBalance" as const,
				credits: this.balanceData.availableCredits,
				debits: this.balanceData.availableDebits,
				amount: this.balanceData.availableAmount,
				currency: this.balanceData.currency,
				currencyExponent: this.balanceData.currencyExponent,
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

	// Helper method to update balance amount (for optimistic locking)
	public withUpdatedBalance(newAmount: string, newLockVersion: number): LedgerAccountEntity {
		return new LedgerAccountEntity({
			...this,
			balanceAmount: newAmount,
			lockVersion: newLockVersion,
			updated: new Date(),
		});
	}
}

export type {
	LedgerAccountEntityOptions as LedgerAccountEntityOpts,
	LedgerAccountRecord,
	LedgerAccountInsert,
	BalanceData,
	NormalBalance,
};
export { LedgerAccountEntity };

export type { LedgerAccountID, LedgerID } from "./types";
