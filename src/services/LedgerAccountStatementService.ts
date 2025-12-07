import { TypeID } from "typeid-js";
import type { LedgerAccountStatementEntity } from "@/repo/entities";
import type { LedgerAccountStatementID } from "@/repo/entities/types";
import type { LedgerAccountStatementRepo } from "@/repo/LedgerAccountStatementRepo";

class LedgerAccountStatementService {
	constructor(private readonly ledgerAccountStatementRepo: LedgerAccountStatementRepo) {}

	public async getLedgerAccountStatement(id: string): Promise<LedgerAccountStatementEntity> {
		const statementId = TypeID.fromString<"lst">(id) as LedgerAccountStatementID;
		return this.ledgerAccountStatementRepo.getStatement(statementId);
	}

	public async createLedgerAccountStatement(
		entity: LedgerAccountStatementEntity
	): Promise<LedgerAccountStatementEntity> {
		return this.ledgerAccountStatementRepo.createStatement(entity);
	}
}

export { LedgerAccountStatementService };
