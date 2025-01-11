import type {
	LedgerAccountResponse,
	LedgerRequest,
	LedgerResponse,
} from "@/routes/ledgers/schema";
import { v7 as uuid } from "uuid";

class LedgerAccountEntity {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly description?: string,
	) {}

	public static fromRequest(
		rq: LedgerRequest,
		id?: string,
	): LedgerAccountEntity {
		return new LedgerAccountEntity(id ?? uuid(), rq.name, rq.description);
	}

	public toResponse(): LedgerAccountResponse {
		throw new Error("Not implemented");
	}
}

export { LedgerAccountEntity };
