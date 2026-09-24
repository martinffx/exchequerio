import { assertInt64 } from "@/lib/amounts";
import type { AssetsTable, LedgerAccountsTable } from "@/db/schema";
import { encodeUuid } from "@/lib/utils";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { Metadata } from "@/lib/schema";
import type { LedgerAccountCategoriesTable } from "@/db/schema";
import type {
	LedgerAccountCategoryRequest,
	LedgerAccountCategoryBalancesResponse,
	LedgerAccountCategoryResponse,
} from "./LedgerAccountCategorySchema";
import type { LedgerAccountCategoryID, LedgerID, OrgID } from "@/lib/ids";

// Infer types from Drizzle schema
type LedgerAccountCategoryRecord = InferSelectModel<typeof LedgerAccountCategoriesTable>;
type LedgerAccountCategoryInsert = InferInsertModel<typeof LedgerAccountCategoriesTable>;
type NormalBalance = "debit" | "credit";

// SUM(bigint) is numeric in PostgreSQL; decimal text preserves it until exact bigint decoding.
type CategoryBalanceRecord = Pick<LedgerAccountCategoryRecord, "id" | "normalBalance"> & {
	assets: (Pick<InferSelectModel<typeof AssetsTable>, "id" | "code" | "minorUnitExponent"> &
		Record<
			keyof Pick<
				InferSelectModel<typeof LedgerAccountsTable>,
				"postedDebits" | "postedCredits" | "pendingDebits" | "pendingCredits"
			>,
			string
		>)[];
};

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

	/** Converts exact aggregate counters using this Category's orientation, not member availability. */
	public static balancesFromRecord(record: CategoryBalanceRecord) {
		const debitNormal = record.normalBalance === "debit";
		return {
			toResponse(): LedgerAccountCategoryBalancesResponse {
				return {
					categoryId: this.categoryId,
					normalBalance: this.normalBalance,
					assets: this.assets.map(asset => ({
						...asset,
						balances: asset.balances.map(balance => ({
							balanceType: balance.balanceType,
							amount: balance.amount.toString(),
							credits: balance.credits.toString(),
							debits: balance.debits.toString(),
						})),
					})),
				};
			},
			categoryId: TypeID.fromUUID("lac", record.id).toString(),
			normalBalance: record.normalBalance,
			assets: record.assets.map(asset => {
				const postedDebits = BigInt(asset.postedDebits);
				const postedCredits = BigInt(asset.postedCredits);
				const pendingDebits = BigInt(asset.pendingDebits);
				const pendingCredits = BigInt(asset.pendingCredits);
				const balance = (
					balanceType: "pending" | "posted" | "availableBalance",
					debits: bigint,
					credits: bigint
				) => ({
					balanceType,
					debits: assertInt64(debits),
					credits: assertInt64(credits),
					amount: assertInt64(debitNormal ? debits - credits : credits - debits),
				});
				return {
					assetId: TypeID.fromUUID("ast", asset.id).toString(),
					assetCode: asset.code,
					minorUnitExponent: asset.minorUnitExponent,
					balances: [
						balance("pending", pendingDebits, pendingCredits),
						balance("posted", postedDebits, postedCredits),
						balance(
							"availableBalance",
							debitNormal ? postedDebits : pendingDebits,
							debitNormal ? pendingCredits : postedCredits
						),
					],
				};
			}),
		};
	}

	public toResponse(): LedgerAccountCategoryResponse {
		return {
			id: this.id.toString(),
			ledgerId: this.ledgerId.toString(),
			name: this.name,
			description: this.description,
			normalBalance: this.normalBalance,
			metadata: this.metadata,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}
}

type CategoryBalances = ReturnType<typeof LedgerAccountCategoryEntity.balancesFromRecord>;

export type {
	CategoryBalances,
	CategoryBalanceRecord,
	LedgerAccountCategoryEntityOptions as LedgerAccountCategoryEntityOpts,
	LedgerAccountCategoryRecord,
	LedgerAccountCategoryInsert,
	NormalBalance,
};
export { LedgerAccountCategoryEntity };
