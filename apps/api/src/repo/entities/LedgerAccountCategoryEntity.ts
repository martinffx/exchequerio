import { encodeUuid } from "@/lib/utils";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { Metadata } from "@/lib/schema";
import type { LedgerAccountCategoriesTable } from "@/repo/schema";
import type {
	LedgerAccountCategoryRequest,
	LedgerAccountCategoryResponse,
} from "@/routes/ledgers/schema";
import type { LedgerAccountCategoryID, LedgerID, OrgID } from "./types";

// Infer types from Drizzle schema
type LedgerAccountCategoryRecord = InferSelectModel<typeof LedgerAccountCategoriesTable>;
type LedgerAccountCategoryInsert = InferInsertModel<typeof LedgerAccountCategoriesTable>;
type NormalBalance = "debit" | "credit";

interface LedgerAccountCategoryEntityOptions {
	id: LedgerAccountCategoryID;
	organizationId: OrgID;
	ledgerId: LedgerID;
	name: string;
	description?: string;
	normalBalance: NormalBalance;
	metadata?: Metadata;
	created: Date;
	updated: Date;
}

class LedgerAccountCategoryEntity {
	public readonly id: LedgerAccountCategoryID;
	public readonly organizationId: OrgID;
	public readonly ledgerId: LedgerID;
	public readonly name: string;
	public readonly description?: string;
	public readonly normalBalance: NormalBalance;
	public readonly metadata?: Metadata;
	public readonly created: Date;
	public readonly updated: Date;

	constructor(options: LedgerAccountCategoryEntityOptions) {
		this.id = options.id;
		this.organizationId = options.organizationId;
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
		organizationId: OrgID,
		ledgerId: LedgerID,
		id?: string
	): LedgerAccountCategoryEntity {
		const now = new Date();
		return new LedgerAccountCategoryEntity({
			id: id ? TypeID.fromString<"lac">(id) : new TypeID("lac"),
			organizationId,
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
		for (const field of ["created", "updated"] as const) {
			if (!(record[field] instanceof Date) || !Number.isFinite(record[field].getTime())) {
				throw new TypeError(`Invalid Category ${field} timestamp`);
			}
		}

		// Invalid stored metadata remains absent for compatibility.
		let metadata: Metadata | undefined;
		if (record.metadata) {
			try {
				const parsed: unknown = JSON.parse(record.metadata);
				if (
					parsed !== null &&
					typeof parsed === "object" &&
					!Array.isArray(parsed) &&
					Object.values(parsed).every(value => typeof value === "string")
				) {
					metadata = parsed as Metadata;
				}
			} catch {
				metadata = undefined;
			}
		}

		return new LedgerAccountCategoryEntity({
			id: TypeID.fromUUID("lac", record.id),
			organizationId: TypeID.fromUUID("org", record.organizationId),
			ledgerId: TypeID.fromUUID("lgr", record.ledgerId),
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
			id: encodeUuid(this.id),
			organizationId: encodeUuid(this.organizationId),
			ledgerId: encodeUuid(this.ledgerId),
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
