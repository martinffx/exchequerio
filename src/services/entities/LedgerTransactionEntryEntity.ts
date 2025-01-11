import type {
	LedgerTransactionEntryRequest,
	LedgerTransactionEntryResponse,
} from "@/routes/ledgers/schema";
import { v7 as uuid } from "uuid";

class LedgerTransactionEntryEntity {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly description?: string,
	) {}

	public static fromRequest(
		rq: LedgerTransactionEntryRequest,
		id?: string,
	): LedgerTransactionEntryEntity {
		return new LedgerTransactionEntryEntity(
			id ?? uuid(),
			rq.name,
			rq.description,
		);
	}

	public toResponse(): LedgerTransactionEntryResponse {
		throw new Error("Not implemented");
	}
}

export { LedgerTransactionEntryEntity };
