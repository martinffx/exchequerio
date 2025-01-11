import type {
	LedgerAccountCategoryResponse,
	LedgerRequest,
} from "@/routes/ledgers/schema";

class LedgerAccountCategoryEntity {
	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly description?: string,
	) {}

	public static fromRequest(
		rq: LedgerRequest,
		id?: string,
	): LedgerAccountCategoryEntity {
		throw new Error("Not implemented");
	}

	public toResponse(): LedgerAccountCategoryResponse {
		throw new Error("Not implemented");
	}
}

export { LedgerAccountCategoryEntity };
