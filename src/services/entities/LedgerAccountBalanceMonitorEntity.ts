import type {
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
} from "@/routes/ledgers/schema";

class LedgerAccountBalanceMonitorEntity {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly description?: string,
	) {}

	public static fromRequest(
		rq: LedgerAccountBalanceMonitorRequest,
		id?: string,
	): LedgerAccountBalanceMonitorEntity {
		throw new Error("Not implemented");
	}

	public toResponse(): LedgerAccountBalanceMonitorResponse {
		throw new Error("Not implemented");
	}
}

export { LedgerAccountBalanceMonitorEntity };
