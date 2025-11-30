import { NotImplementedError } from "@/errors";
import type { LedgerAccountRepo } from "@/repo/LedgerAccountRepo";
import type { LedgerRepo } from "@/repo/LedgerRepo";
import type {
	LedgerAccountBalanceMonitorEntity,
	LedgerAccountCategoryEntity,
	LedgerAccountEntity,
	LedgerAccountSettlementEntity,
	LedgerAccountStatementEntity,
} from "./entities";
import type { LedgerAccountID, LedgerID, OrgID } from "./entities/types";

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
	public listLedgerAccountCategories(
		_offset: number,
		_limit: number
	): Promise<LedgerAccountCategoryEntity[]> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		);
	}

	public getLedgerAccountCategory(_id: string): Promise<LedgerAccountCategoryEntity> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		);
	}

	public createLedgerAccountCategory(
		_entity: LedgerAccountCategoryEntity
	): Promise<LedgerAccountCategoryEntity> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		);
	}

	public updateLedgerAccountCategory(
		_id: string,
		_entity: LedgerAccountCategoryEntity
	): Promise<LedgerAccountCategoryEntity> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		);
	}

	public deleteLedgerAccountCategory(_id: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		);
	}

	public linkLedgerAccountToCategory(_id: string, _accountId: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		);
	}

	public unlinkLedgerAccountToCategory(_id: string, _accountId: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		);
	}

	public linkLedgerAccountCategoryToCategory(_id: string, _categoryId: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		);
	}

	public unlinkLedgerAccountCategoryToCategory(_id: string, _categoryId: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
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
