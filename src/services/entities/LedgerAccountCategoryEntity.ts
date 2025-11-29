import { typeid } from "typeid-js";
import type {
	LedgerAccountCategoryRequest,
	LedgerAccountCategoryResponse,
} from "@/routes/ledgers/schema";

class LedgerAccountCategoryEntity {
	constructor(
		public readonly id: string,
		public readonly ledgerId: string,
		public readonly name: string,
		public readonly description: string | undefined,
		public readonly normalBalance: "debit" | "credit",
		public readonly parentCategoryId: string | undefined,
		public readonly metadata: Record<string, unknown> | undefined,
		public readonly created: Date,
		public readonly updated: Date
	) {}

	public static fromRequest(
		rq: LedgerAccountCategoryRequest,
		id?: string
	): LedgerAccountCategoryEntity {
		const now = new Date();
		return new LedgerAccountCategoryEntity(
			id ?? typeid("lac").toString(),
			rq.ledgerId,
			rq.name,
			rq.description,
			rq.normalBalance,
			rq.parentAccountCategoryIds?.[0], // Take first parent for now
			rq.metadata,
			now,
			now
		);
	}

	public toResponse(): LedgerAccountCategoryResponse {
		return {
			id: this.id,
			ledgerId: this.ledgerId,
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

export { LedgerAccountCategoryEntity };
