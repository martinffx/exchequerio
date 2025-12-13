import { LedgerEntity, type LedgerID, type OrgID } from "@/repo/entities";
import type { LedgerRepo } from "@/repo/LedgerRepo";

interface LedgerRequest {
	name: string;
	description?: string;
	metadata?: Record<string, unknown>;
}

class LedgerService {
	constructor(private readonly ledgerRepo: LedgerRepo) {}

	public async getLedger(orgId: OrgID, id: LedgerID): Promise<LedgerEntity> {
		return this.ledgerRepo.getLedger(orgId, id);
	}

	public async listLedgers(orgId: OrgID, offset: number, limit: number): Promise<LedgerEntity[]> {
		return this.ledgerRepo.listLedgers(orgId, offset, limit);
	}

	public async createLedger(orgId: OrgID, request: LedgerRequest): Promise<LedgerEntity> {
		const entity = LedgerEntity.fromRequest(request, orgId);
		return this.ledgerRepo.upsertLedger(entity);
	}

	public async updateLedger(
		orgId: OrgID,
		request: LedgerRequest,
		ledgerId: string
	): Promise<LedgerEntity> {
		const entity = LedgerEntity.fromRequest(request, orgId, ledgerId);
		return this.ledgerRepo.upsertLedger(entity);
	}

	public async deleteLedger(orgId: OrgID, id: LedgerID): Promise<void> {
		return this.ledgerRepo.deleteLedger(orgId, id);
	}
}

export { LedgerService };
