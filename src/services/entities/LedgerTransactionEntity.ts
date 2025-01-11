import type {
	LedgerTransactionRequest,
	LedgerTransactionResponse,
} from "@/routes/ledgers/schema";
import { v7 as uuid } from "uuid";

class LedgerTransactionEntity {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly description?: string,
	) {}

	public static fromRequest(
		rq: LedgerTransactionRequest,
		id?: string,
	): LedgerTransactionEntity {
		throw new Error("Not implemented");
	}

	public toResponse(): LedgerTransactionResponse {
		throw new Error("Not implemented");
	}
}

export { LedgerTransactionEntity };
