import { typeid } from "typeid-js"
import type {
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
} from "@/routes/ledgers/schema"

class LedgerAccountSettlementEntity {
	constructor(
		public readonly id: string,
		public readonly ledgerTransactionId: string,
		public readonly settledLedgerAccountId: string,
		public readonly contraLedgerAccountId: string,
		public readonly amount: number,
		public readonly status:
			| "drafting"
			| "processing"
			| "pending"
			| "posted"
			| "archiving"
			| "archived",
		public readonly description: string | undefined,
		public readonly normalBalance: "debit" | "credit",
		public readonly metadata: Record<string, unknown> | undefined,
		public readonly created: Date,
		public readonly updated: Date
	) {}

	public static fromRequest(
		rq: LedgerAccountSettlementRequest,
		id?: string
	): LedgerAccountSettlementEntity {
		const now = new Date()
		return new LedgerAccountSettlementEntity(
			id ?? typeid("las").toString(),
			rq.ledgerTransactionId,
			rq.settledLedgerAccountId,
			rq.contraLedgerAccountId,
			0, // Amount will be calculated from transaction
			rq.status,
			rq.description,
			"debit", // Default normal balance
			rq.metadata,
			now,
			now
		)
	}

	public toResponse(): LedgerAccountSettlementResponse {
		return {
			id: this.id,
			ledgerTransactionId: this.ledgerTransactionId,
			settledLedgerAccountId: this.settledLedgerAccountId,
			contraLedgerAccountId: this.contraLedgerAccountId,
			amount: this.amount,
			status: this.status,
			description: this.description,
			normalBalance: this.normalBalance,
			currency: "USD",
			currencyExponent: 2,
			metadata: this.metadata,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		}
	}
}

export { LedgerAccountSettlementEntity }
