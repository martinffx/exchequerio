import { TypeID } from "typeid-js";
import { LedgerAccountStatementEntity } from "@/repo/entities";
import type { LedgerAccountStatementID } from "@/repo/entities/types";
import type { LedgerAccountStatementRepo } from "@/repo/LedgerAccountStatementRepo";

interface LedgerAccountStatementRequest {
	ledgerId: string;
	accountId: string;
	startDatetime: string;
	endDatetime: string;
	description?: string;
}

class LedgerAccountStatementService {
	constructor(private readonly ledgerAccountStatementRepo: LedgerAccountStatementRepo) {}

	public async getLedgerAccountStatement(id: string): Promise<LedgerAccountStatementEntity> {
		const statementId = TypeID.fromString<"lst">(id) as LedgerAccountStatementID;
		return this.ledgerAccountStatementRepo.getStatement(statementId);
	}

	public async createLedgerAccountStatement(
		request: LedgerAccountStatementRequest
	): Promise<LedgerAccountStatementEntity> {
		const entity = LedgerAccountStatementEntity.fromRequest(request);
		return this.ledgerAccountStatementRepo.createStatement(entity);
	}
}

export { LedgerAccountStatementService };
