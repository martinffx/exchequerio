import { typeid } from "typeid-js";
import type {
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
} from "@/routes/ledgers/schema";

class LedgerAccountStatementEntity {
	constructor(
		public readonly id: string,
		public readonly ledgerId: string,
		public readonly ledgerAccountId: string,
		public readonly description: string | undefined,
		public readonly startDatetime: Date,
		public readonly endDatetime: Date,
		public readonly metadata: Record<string, unknown> | undefined,
		public readonly created: Date,
		public readonly updated: Date
	) {}

	public static fromRequest(
		rq: LedgerAccountStatementRequest,
		id?: string
	): LedgerAccountStatementEntity {
		const now = new Date();
		return new LedgerAccountStatementEntity(
			id ?? typeid("las").toString(),
			rq.ledgerId,
			rq.ledgerAccountId,
			rq.description,
			new Date(rq.startDatetime),
			new Date(rq.endDatetime),
			undefined, // Metadata not in request
			now,
			now
		);
	}

	public toResponse(): LedgerAccountStatementResponse {
		const emptyBalances = [
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
		];

		return {
			id: this.id,
			ledgerId: this.ledgerId,
			ledgerAccountId: this.ledgerAccountId,
			description: this.description,
			startDatetime: this.startDatetime.toISOString(),
			endDatetime: this.endDatetime.toISOString(),
			ledgerAccountVersion: 0,
			normalBalance: "debit" as const,
			startingBalances: emptyBalances,
			endingBalances: emptyBalances,
			currency: "USD",
			currencyExponent: 2,
			metadata: this.metadata,
			created: this.created.toISOString(),
			updated: this.updated.toISOString(),
		};
	}
}

export { LedgerAccountStatementEntity };
