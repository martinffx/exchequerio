import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { LedgerAccountBalanceMonitorsTable } from "@/repo/schema";
import type {
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
} from "@/routes/ledgers/schema";
import type { LedgerAccountBalanceMonitorID, LedgerAccountID } from "./types";

// Infer types from Drizzle schema
type LedgerAccountBalanceMonitorRecord = InferSelectModel<typeof LedgerAccountBalanceMonitorsTable>;
type LedgerAccountBalanceMonitorInsert = InferInsertModel<typeof LedgerAccountBalanceMonitorsTable>;

type AlertCondition = {
	field: "balance" | "created" | "updated";
	operator: "=" | "<" | ">" | "<=" | ">=" | "!=";
	value: number;
}[];

type LedgerAccountBalanceMonitorEntityOptions = {
	id: LedgerAccountBalanceMonitorID;
	accountId: LedgerAccountID;
	name: string;
	description?: string;
	alertThreshold: number;
	isActive: boolean;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
};

class LedgerAccountBalanceMonitorEntity {
	public readonly id: LedgerAccountBalanceMonitorID;
	public readonly accountId: LedgerAccountID;
	public readonly name: string;
	public readonly description?: string;
	public readonly alertThreshold: number;
	public readonly isActive: boolean;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;

	constructor(options: LedgerAccountBalanceMonitorEntityOptions) {
		this.id = options.id;
		this.accountId = options.accountId;
		this.name = options.name;
		this.description = options.description;
		this.alertThreshold = options.alertThreshold;
		this.isActive = options.isActive;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	public static fromRequest(
		rq: LedgerAccountBalanceMonitorRequest,
		id?: string
	): LedgerAccountBalanceMonitorEntity {
		const now = new Date();
		return new LedgerAccountBalanceMonitorEntity({
			id: id
				? (TypeID.fromString<"lbm">(id) as LedgerAccountBalanceMonitorID)
				: (new TypeID("lbm") as LedgerAccountBalanceMonitorID),
			accountId: TypeID.fromString<"lat">(rq.ledgerAccountId) as LedgerAccountID,
			name: rq.description || "Balance Monitor",
			description: rq.description,
			alertThreshold: 0,
			isActive: true,
			metadata: rq.metadata,
			created: now,
			updated: now,
		});
	}

	public static fromRecord(
		record: LedgerAccountBalanceMonitorRecord
	): LedgerAccountBalanceMonitorEntity {
		// Parse metadata from TEXT (JSON string) to object
		let metadata: Record<string, unknown> | undefined;
		if (record.metadata) {
			try {
				metadata = JSON.parse(record.metadata) as Record<string, unknown>;
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerAccountBalanceMonitorEntity({
			id: TypeID.fromString<"lbm">(record.id) as LedgerAccountBalanceMonitorID,
			accountId: TypeID.fromString<"lat">(record.accountId) as LedgerAccountID,
			name: record.name,
			description: record.description ?? undefined,
			alertThreshold: Number.parseFloat(record.alertThreshold),
			isActive: record.isActive === 1,
			metadata,
			created: record.created,
			updated: record.updated,
		});
	}

	public toRecord(): LedgerAccountBalanceMonitorInsert {
		return {
			id: this.id.toString(),
			accountId: this.accountId.toString(),
			name: this.name,
			description: this.description,
			alertThreshold: this.alertThreshold.toString(),
			isActive: this.isActive ? 1 : 0,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			updated: new Date(),
		};
	}

	public toResponse(): LedgerAccountBalanceMonitorResponse {
		return {
			id: this.id.toString(),
			ledgerAccountId: this.accountId.toString(),
			description: this.description,
			alertCondition: [],
			balances: [
				{
					balanceType: "pending" as const,
					amount: 0,
					currency: "USD",
					currencyExponent: 2,
					credits: 0,
					debits: 0,
				},
				{
					balanceType: "posted" as const,
					amount: 0,
					currency: "USD",
					currencyExponent: 2,
					credits: 0,
					debits: 0,
				},
				{
					balanceType: "availableBalance" as const,
					amount: 0,
					currency: "USD",
					currencyExponent: 2,
					credits: 0,
					debits: 0,
				},
			],
			metadata: this.metadata,
			lockVersion: 0,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}
}

export type {
	LedgerAccountBalanceMonitorEntityOptions as LedgerAccountBalanceMonitorEntityOpts,
	LedgerAccountBalanceMonitorRecord,
	LedgerAccountBalanceMonitorInsert,
	AlertCondition,
};
export { LedgerAccountBalanceMonitorEntity };
