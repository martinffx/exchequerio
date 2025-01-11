import type {
	LedgerAccountResponse,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
	LedgerRequest,
	LedgerResponse,
} from "@/routes/ledgers/schema";
import { v7 as uuid } from "uuid";

class LedgerAccountStatementEntity {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly description?: string,
	) {}

	public static fromRequest(
		rq: LedgerAccountStatementRequest,
		id?: string,
	): LedgerAccountStatementEntity {
		throw new Error("Not implemented");
	}

	public toResponse(): LedgerAccountStatementResponse {
		throw new Error("Not implemented");
	}
}

export { LedgerAccountStatementEntity };
