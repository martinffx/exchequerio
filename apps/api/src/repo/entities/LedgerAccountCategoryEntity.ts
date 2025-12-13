import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { LedgerAccountCategoriesTable } from "@/repo/schema";
import type {
	LedgerAccountCategoryRequest,
	LedgerAccountCategoryResponse,
} from "@/routes/ledgers/schema";
import type { LedgerAccountCategoryID, LedgerID } from "./types";

// Infer types from Drizzle schema
type LedgerAccountCategoryRecord = InferSelectModel<typeof LedgerAccountCategoriesTable>;
type LedgerAccountCategoryInsert = InferInsertModel<typeof LedgerAccountCategoriesTable>;
type NormalBalance = "debit" | "credit";

interface LedgerAccountCategoryEntityOptions {
	id: LedgerAccountCategoryID;
	ledgerId: LedgerID;
	name: string;
	description?: string;
	normalBalance: NormalBalance;
	metadata?: Record<string, unknown>;
	created: Date;
	updated: Date;
}

class LedgerAccountCategoryEntity {
	public readonly id: LedgerAccountCategoryID;
	public readonly ledgerId: LedgerID;
	public readonly name: string;
	public readonly description?: string;
	public readonly normalBalance: NormalBalance;
	public readonly metadata?: Record<string, unknown>;
	public readonly created: Date;
	public readonly updated: Date;

	constructor(options: LedgerAccountCategoryEntityOptions) {
		this.id = options.id;
		this.ledgerId = options.ledgerId;
		this.name = options.name;
		this.description = options.description;
		this.normalBalance = options.normalBalance;
		this.metadata = options.metadata;
		this.created = options.created;
		this.updated = options.updated;
	}

	public static fromRequest(
		rq: LedgerAccountCategoryRequest,
		ledgerId: LedgerID,
		id?: string
	): LedgerAccountCategoryEntity {
		const now = new Date();
		return new LedgerAccountCategoryEntity({
			id: id ? TypeID.fromString<"lac">(id) : new TypeID("lac"),
			ledgerId,
			name: rq.name,
			description: rq.description,
			normalBalance: rq.normalBalance,
			metadata: rq.metadata,
			created: now,
			updated: now,
		});
	}

	public static fromRecord(record: LedgerAccountCategoryRecord): LedgerAccountCategoryEntity {
		// Parse metadata from TEXT (JSON string) to object
		let metadata: Record<string, unknown> | undefined;
		if (record.metadata) {
			try {
				metadata = JSON.parse(record.metadata) as Record<string, unknown>;
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerAccountCategoryEntity({
			id: TypeID.fromString<"lac">(record.id),
			ledgerId: TypeID.fromString<"lgr">(record.ledgerId),
			name: record.name,
			description: record.description ?? undefined,
			normalBalance: record.normalBalance as NormalBalance,
			metadata,
			created: record.created,
			updated: record.updated,
		});
	}

	public toRecord(): LedgerAccountCategoryInsert {
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			name: this.name,
			description: this.description,
			normalBalance: this.normalBalance,
			// parentCategoryId is deprecated - parent relationships via junction table
			parentCategoryId: undefined,
			metadata: this.metadata ? JSON.stringify(this.metadata) : undefined,
			updated: new Date(),
		};
	}

	public toResponse(): LedgerAccountCategoryResponse {
		// Balance aggregation deferred (Task decision 4C) - return hardcoded zeros
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			name: this.name,
			description: this.description,
			normalBalance: this.normalBalance,
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
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}
}

export type {
	LedgerAccountCategoryEntityOptions as LedgerAccountCategoryEntityOpts,
	LedgerAccountCategoryRecord,
	LedgerAccountCategoryInsert,
	NormalBalance,
};
export { LedgerAccountCategoryEntity };
