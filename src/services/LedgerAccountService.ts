import { NotImplementedError } from "@/errors";
import type {
	LedgerAccountBalanceMonitorEntity,
	LedgerAccountCategoryEntity,
	LedgerAccountEntity,
	LedgerAccountSettlementEntity,
	LedgerAccountStatementEntity,
} from "@/repo/entities";
import type {
	LedgerAccountCategoryID,
	LedgerAccountID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import type { LedgerAccountCategoryRepo } from "@/repo/LedgerAccountCategoryRepo";
import type { LedgerAccountRepo } from "@/repo/LedgerAccountRepo";
import type { LedgerRepo } from "@/repo/LedgerRepo";

class LedgerAccountService {
	constructor(
		private readonly ledgerAccountRepo: LedgerAccountRepo,
		private readonly ledgerRepo: LedgerRepo,
		private readonly ledgerAccountCategoryRepo: LedgerAccountCategoryRepo
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
		_orgId: OrgID,
		entity: LedgerAccountEntity
	): Promise<LedgerAccountEntity> {
		return this.ledgerAccountRepo.upsertLedgerAccount(entity);
	}

	public async updateLedgerAccount(
		_orgId: OrgID,
		_ledgerId: LedgerID,
		entity: LedgerAccountEntity
	): Promise<LedgerAccountEntity> {
		return this.ledgerAccountRepo.upsertLedgerAccount(entity);
	}

	public async deleteLedgerAccount(
		orgId: OrgID,
		ledgerId: LedgerID,
		id: LedgerAccountID
	): Promise<void> {
		return this.ledgerAccountRepo.deleteLedgerAccount(orgId, ledgerId, id);
	}

	// Ledger Account Category
	public async listLedgerAccountCategories(
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Promise<LedgerAccountCategoryEntity[]> {
		return this.ledgerAccountCategoryRepo.listLedgerAccountCategories(ledgerId, offset, limit);
	}

	public async getLedgerAccountCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Promise<LedgerAccountCategoryEntity> {
		return this.ledgerAccountCategoryRepo.getLedgerAccountCategory(ledgerId, categoryId);
	}

	public async createLedgerAccountCategory(
		entity: LedgerAccountCategoryEntity
	): Promise<LedgerAccountCategoryEntity> {
		return this.ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);
	}

	public async updateLedgerAccountCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		entity: LedgerAccountCategoryEntity
	): Promise<LedgerAccountCategoryEntity> {
		// Verify exists first
		await this.ledgerAccountCategoryRepo.getLedgerAccountCategory(ledgerId, categoryId);
		return this.ledgerAccountCategoryRepo.upsertLedgerAccountCategory(entity);
	}

	public async deleteLedgerAccountCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Promise<void> {
		return this.ledgerAccountCategoryRepo.deleteLedgerAccountCategory(ledgerId, categoryId);
	}

	public async linkLedgerAccountToCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Promise<void> {
		return this.ledgerAccountCategoryRepo.linkAccountToCategory(ledgerId, categoryId, accountId);
	}

	public async unlinkLedgerAccountToCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Promise<void> {
		return this.ledgerAccountCategoryRepo.unlinkAccountFromCategory(ledgerId, categoryId, accountId);
	}

	public async linkLedgerAccountCategoryToCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Promise<void> {
		return this.ledgerAccountCategoryRepo.linkCategoryToParent(
			ledgerId,
			categoryId,
			parentCategoryId
		);
	}

	public async unlinkLedgerAccountCategoryToCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Promise<void> {
		return this.ledgerAccountCategoryRepo.unlinkCategoryFromParent(
			ledgerId,
			categoryId,
			parentCategoryId
		);
	}

	// Ledger Account Settlement
	public listLedgerAccountSettlements(
		_offset: number,
		_limit: number
	): Promise<LedgerAccountSettlementEntity[]> {
		throw new NotImplementedError(
			"Account settlements require LedgerAccountSettlementsTable and LedgerAccountSettlementEntity implementation"
		);
	}

	public getLedgerAccountSettlement(_id: string): Promise<LedgerAccountSettlementEntity> {
		throw new NotImplementedError(
			"Account settlements require LedgerAccountSettlementsTable and LedgerAccountSettlementEntity implementation"
		);
	}

	public createLedgerAccountSettlement(
		_entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		throw new NotImplementedError(
			"Account settlements require LedgerAccountSettlementsTable and LedgerAccountSettlementEntity implementation"
		);
	}

	public updateLedgerAccountSettlement(
		_id: string,
		_entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	public deleteLedgerAccountSettlement(_id: string): Promise<void> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	public addLedgerAccountSettlementEntries(_id: string, _entries: string[]): Promise<void> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	public removeLedgerAccountSettlementEntries(_id: string, _entries: string[]): Promise<void> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	// Ledger Account Statement
	public getLedgerAccountStatement(_id: string): Promise<LedgerAccountStatementEntity> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	public createLedgerAccountStatement(
		_entity: LedgerAccountStatementEntity
	): Promise<LedgerAccountStatementEntity> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	// Ledger Account Balance Monitor§
	public listLedgerAccountBalanceMonitors(
		_offset: number,
		_limit: number
	): Promise<LedgerAccountBalanceMonitorEntity[]> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	public getLedgerAccountBalanceMonitor(_id: string): Promise<LedgerAccountBalanceMonitorEntity> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	public createLedgerAccountBalanceMonitor(
		_entity: LedgerAccountBalanceMonitorEntity
	): Promise<LedgerAccountBalanceMonitorEntity> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	public updateLedgerAccountBalanceMonitor(
		_id: string,
		_entity: LedgerAccountBalanceMonitorEntity
	): Promise<LedgerAccountBalanceMonitorEntity> {
		throw new NotImplementedError("Feature not yet implemented");
	}

	public deleteLedgerAccountBalanceMonitor(_id: string): Promise<void> {
		throw new NotImplementedError("Feature not yet implemented");
	}
}

export { LedgerAccountService };
