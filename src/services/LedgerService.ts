import type { LedgerRepo } from "@/repo/LedgerRepo"
import type { LedgerEntity, LedgerID, OrgID } from "./entities"

class LedgerService {
	constructor(private readonly ledgerRepo: LedgerRepo) {}

	public async getLedger(orgId: OrgID, id: LedgerID): Promise<LedgerEntity> {
		return this.ledgerRepo.getLedger(orgId, id)
	}

	public async listLedgers(orgId: OrgID, offset: number, limit: number): Promise<LedgerEntity[]> {
		return this.ledgerRepo.listLedgers(orgId, offset, limit)
	}

	public async createLedger(orgId: OrgID, entity: LedgerEntity): Promise<LedgerEntity> {
		return this.ledgerRepo.createLedger(entity)
	}

	public async updateLedger(orgId: OrgID, entity: LedgerEntity): Promise<LedgerEntity> {
		return this.ledgerRepo.updateLedger(orgId, entity)
	}

	public async deleteLedger(orgId: OrgID, id: LedgerID): Promise<void> {
		return this.ledgerRepo.deleteLedger(orgId, id)
	}
}

export { LedgerService }
