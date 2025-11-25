import type { LedgerRepo } from "@/repo/LedgerRepo"
import type { LedgerAccountRepo } from "@/repo/LedgerAccountRepo"
import type {
	LedgerAccountBalanceMonitorEntity,
	LedgerAccountCategoryEntity,
	LedgerAccountEntity,
	LedgerAccountSettlementEntity,
	LedgerAccountStatementEntity,
} from "./entities"
import type { OrgID, LedgerID, LedgerAccountID } from "./entities/types"
import { NotImplementedError } from "@/errors"

class LedgerAccountService {
	constructor(
		private readonly ledgerAccountRepo: LedgerAccountRepo,
		private readonly ledgerRepo: LedgerRepo
	) {}

	// Ledger Account - Core CRUD operations
	public async listLedgerAccounts(
		orgId: OrgID,
		ledgerId: LedgerID,
		offset: number = 0,
		limit: number = 50
	): Promise<LedgerAccountEntity[]> {
		await this.ledgerRepo.getLedger(orgId, ledgerId) // Verify ledger exists
		return this.ledgerAccountRepo.listLedgerAccounts(orgId.toString(), ledgerId, offset, limit)
	}

	public async getLedgerAccount(
		orgId: OrgID,
		ledgerId: LedgerID,
		id: LedgerAccountID
	): Promise<LedgerAccountEntity> {
		return this.ledgerAccountRepo.getLedgerAccount(orgId.toString(), ledgerId, id)
	}

	public async createLedgerAccount(
		orgId: OrgID,
		entity: LedgerAccountEntity
	): Promise<LedgerAccountEntity> {
		await this.ledgerRepo.getLedger(orgId, entity.ledgerId) // Verify ledger exists
		return this.ledgerAccountRepo.createLedgerAccount(orgId.toString(), entity)
	}

	public async updateLedgerAccount(
		orgId: OrgID,
		ledgerId: LedgerID,
		entity: LedgerAccountEntity
	): Promise<LedgerAccountEntity> {
		return this.ledgerAccountRepo.updateLedgerAccount(orgId.toString(), ledgerId, entity)
	}

	public async deleteLedgerAccount(
		orgId: OrgID,
		ledgerId: LedgerID,
		id: LedgerAccountID
	): Promise<void> {
		return this.ledgerAccountRepo.deleteLedgerAccount(orgId.toString(), ledgerId, id)
	}

	// Ledger Account Category
	public async listLedgerAccountCategories(
		offset: number,
		limit: number
	): Promise<LedgerAccountCategoryEntity[]> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		)
	}

	public async getLedgerAccountCategory(id: string): Promise<LedgerAccountCategoryEntity> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		)
	}

	public async createLedgerAccountCategory(
		entity: LedgerAccountCategoryEntity
	): Promise<LedgerAccountCategoryEntity> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		)
	}

	public async updateLedgerAccountCategory(
		id: string,
		entity: LedgerAccountCategoryEntity
	): Promise<LedgerAccountCategoryEntity> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		)
	}

	public async deleteLedgerAccountCategory(id: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		)
	}

	public async linkLedgerAccountToCategory(id: string, accountId: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		)
	}

	public async unlinkLedgerAccountToCategory(id: string, accountId: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		)
	}

	public async linkLedgerAccountCategoryToCategory(id: string, categoryId: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		)
	}

	public async unlinkLedgerAccountCategoryToCategory(id: string, categoryId: string): Promise<void> {
		throw new NotImplementedError(
			"Account categories require LedgerAccountCategoriesTable and LedgerAccountCategoryEntity implementation"
		)
	}

	// Ledger Account Settlement
	public async listLedgerAccountSettlements(
		offset: number,
		limit: number
	): Promise<LedgerAccountSettlementEntity[]> {
		throw new NotImplementedError(
			"Account settlements require LedgerAccountSettlementsTable and LedgerAccountSettlementEntity implementation"
		)
	}

	public async getLedgerAccountSettlement(id: string): Promise<LedgerAccountSettlementEntity> {
		throw new NotImplementedError(
			"Account settlements require LedgerAccountSettlementsTable and LedgerAccountSettlementEntity implementation"
		)
	}

	public async createLedgerAccountSettlement(
		entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		throw new NotImplementedError(
			"Account settlements require LedgerAccountSettlementsTable and LedgerAccountSettlementEntity implementation"
		)
	}

	public async updateLedgerAccountSettlement(
		id: string,
		entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async deleteLedgerAccountSettlement(id: string): Promise<void> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async addLedgerAccountSettlementEntries(id: string, entries: string[]): Promise<void> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async removeLedgerAccountSettlementEntries(id: string, entries: string[]): Promise<void> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	// Ledger Account Statement
	public async getLedgerAccountStatement(id: string): Promise<LedgerAccountStatementEntity> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async createLedgerAccountStatement(
		entity: LedgerAccountStatementEntity
	): Promise<LedgerAccountStatementEntity> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	// Ledger Account Balance Monitor§
	public async listLedgerAccountBalanceMonitors(
		offset: number,
		limit: number
	): Promise<LedgerAccountBalanceMonitorEntity[]> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async getLedgerAccountBalanceMonitor(
		id: string
	): Promise<LedgerAccountBalanceMonitorEntity> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async createLedgerAccountBalanceMonitor(
		entity: LedgerAccountBalanceMonitorEntity
	): Promise<LedgerAccountBalanceMonitorEntity> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async updateLedgerAccountBalanceMonitor(
		id: string,
		entity: LedgerAccountBalanceMonitorEntity
	): Promise<LedgerAccountBalanceMonitorEntity> {
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async deleteLedgerAccountBalanceMonitor(id: string): Promise<void> {
		throw new NotImplementedError("Feature not yet implemented")
	}
}

export { LedgerAccountService }
