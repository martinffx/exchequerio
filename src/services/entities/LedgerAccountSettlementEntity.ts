import type {
	LedgerAccountResponse,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementResponse,
	LedgerRequest,
	LedgerResponse,
} from "@/routes/ledgers/schema";
import { v7 as uuid } from "uuid";

class LedgerAccountSettlementEntity {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly description?: string,
	) {}

	public static fromRequest(
		rq: LedgerAccountSettlementRequest,
		id?: string,
	): LedgerAccountSettlementEntity {
		throw new Error("Not implemented");
	}

	public toResponse(): LedgerAccountSettlementResponse {
		throw new Error("Not implemented");
	}
}

export { LedgerAccountSettlementEntity };
