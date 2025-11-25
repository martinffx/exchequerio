import type {
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
} from "@/routes/ledgers/schema"
import { typeid } from "typeid-js"

class LedgerAccountBalanceMonitorEntity {
	constructor(
		public readonly id: string,
		public readonly ledgerAccountId: string,
		public readonly description: string | undefined,
		public readonly alertCondition: {
			field: "balance" | "created" | "updated"
			operator: "=" | "<" | ">" | "<=" | ">=" | "!="
			value: number
		}[],
		public readonly lockVersion: number,
		public readonly metadata: Record<string, unknown> | undefined,
		public readonly created: Date,
		public readonly updated: Date
	) {}

	public static fromRequest(
		rq: LedgerAccountBalanceMonitorRequest,
		id?: string
	): LedgerAccountBalanceMonitorEntity {
		const now = new Date()
		return new LedgerAccountBalanceMonitorEntity(
			id ?? typeid("labm").toString(),
			rq.ledgerAccountId,
			rq.description,
			rq.alertCondition,
			0,
			rq.metadata,
			now,
			now
		)
	}

	public toResponse(): LedgerAccountBalanceMonitorResponse {
		return {
			id: this.id,
			ledgerAccountId: this.ledgerAccountId,
			description: this.description,
			alertCondition: this.alertCondition,
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
			lockVersion: this.lockVersion,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		}
	}
}

export { LedgerAccountBalanceMonitorEntity }
