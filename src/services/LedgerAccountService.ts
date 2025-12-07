import type { LedgerAccountEntity } from "@/repo/entities";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import type { LedgerAccountRepo } from "@/repo/LedgerAccountRepo";
import type { LedgerRepo } from "@/repo/LedgerRepo";

class LedgerAccountService {
	constructor(
		private readonly ledgerAccountRepo: LedgerAccountRepo,
		private readonly ledgerRepo: LedgerRepo
	) {}

	// Ledger Account - Core CRUD operations
	public async listLedgerAccounts(
		orgId: OrgID,
		ledgerId: LedgerID,
		offset = 0,
		limit = 50
	): Promise<LedgerAccountEntity[]> {
		await this.ledgerRepo.getLedger(orgId, ledgerId); // Verify ledger exists
		return this.ledgerAccountRepo.listLedgerAccounts(orgId, ledgerId, offset, limit);
	}

	public async getLedgerAccount(
		orgId: OrgID,
		ledgerId: LedgerID,
		id: LedgerAccountID
	): Promise<LedgerAccountEntity> {
		return this.ledgerAccountRepo.getLedgerAccount(orgId, ledgerId, id);
	}

	public async createLedgerAccount(entity: LedgerAccountEntity): Promise<LedgerAccountEntity> {
		return this.ledgerAccountRepo.upsertLedgerAccount(entity);
	}

	public async updateLedgerAccount(entity: LedgerAccountEntity): Promise<LedgerAccountEntity> {
		return this.ledgerAccountRepo.upsertLedgerAccount(entity);
	}

	public async deleteLedgerAccount(
		orgId: OrgID,
		ledgerId: LedgerID,
		id: LedgerAccountID
	): Promise<void> {
		return this.ledgerAccountRepo.deleteLedgerAccount(orgId, ledgerId, id);
	}
}

export { LedgerAccountService };
