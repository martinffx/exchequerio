import { TypeID } from "typeid-js";
import { LedgerAccountEntity } from "@/repo/entities";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import type { LedgerAccountRepo } from "@/repo/LedgerAccountRepo";
import type { LedgerRepo } from "@/repo/LedgerRepo";

type NormalBalance = "debit" | "credit";

interface LedgerAccountRequest {
	name: string;
	description?: string;
	metadata?: Record<string, unknown>;
}

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

	public async createLedgerAccount(
		orgId: OrgID,
		ledgerId: string,
		normalBalance: NormalBalance,
		request: LedgerAccountRequest
	): Promise<LedgerAccountEntity> {
		const ledgerIdTyped = TypeID.fromString<"lgr">(ledgerId) as LedgerID;
		const entity = LedgerAccountEntity.fromRequest(request, orgId, ledgerIdTyped, normalBalance);
		return this.ledgerAccountRepo.upsertLedgerAccount(entity);
	}

	public async updateLedgerAccount(
		orgId: OrgID,
		ledgerId: string,
		accountId: string,
		normalBalance: NormalBalance,
		request: LedgerAccountRequest
	): Promise<LedgerAccountEntity> {
		const ledgerIdTyped = TypeID.fromString<"lgr">(ledgerId) as LedgerID;
		const entity = LedgerAccountEntity.fromRequest(
			request,
			orgId,
			ledgerIdTyped,
			normalBalance,
			accountId
		);
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
