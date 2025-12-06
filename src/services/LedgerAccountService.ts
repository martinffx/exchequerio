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
	LedgerAccountSettlementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import type { LedgerAccountCategoryRepo } from "@/repo/LedgerAccountCategoryRepo";
import type { LedgerAccountRepo } from "@/repo/LedgerAccountRepo";
import type { LedgerAccountSettlementRepo } from "@/repo/LedgerAccountSettlementRepo";
import type { LedgerRepo } from "@/repo/LedgerRepo";
import type { SettlementStatus } from "@/routes/ledgers/schema";

class LedgerAccountService {
	constructor(
		private readonly ledgerAccountRepo: LedgerAccountRepo,
		private readonly ledgerRepo: LedgerRepo,
		private readonly ledgerAccountCategoryRepo: LedgerAccountCategoryRepo,
		private readonly ledgerAccountSettlementRepo: LedgerAccountSettlementRepo
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
	public async listLedgerAccountSettlements(
		orgId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Promise<LedgerAccountSettlementEntity[]> {
		// Verify ledger exists
		await this.ledgerRepo.getLedger(orgId, ledgerId);
		return this.ledgerAccountSettlementRepo.listSettlements(orgId, ledgerId, offset, limit);
	}

	public async getLedgerAccountSettlement(
		orgId: OrgID,
		id: LedgerAccountSettlementID
	): Promise<LedgerAccountSettlementEntity> {
		return this.ledgerAccountSettlementRepo.getSettlement(orgId, id);
	}

	public async createLedgerAccountSettlement(
		_orgId: OrgID,
		entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		// Note: Database foreign keys ensure both accounts exist
		// TODO: Add validation that both accounts belong to the same ledger
		return this.ledgerAccountSettlementRepo.createSettlement(entity);
	}

	public async updateLedgerAccountSettlement(
		orgId: OrgID,
		id: LedgerAccountSettlementID,
		entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		// Verify settlement exists
		await this.ledgerAccountSettlementRepo.getSettlement(orgId, id);
		return this.ledgerAccountSettlementRepo.updateSettlement(entity);
	}

	public async deleteLedgerAccountSettlement(
		orgId: OrgID,
		id: LedgerAccountSettlementID
	): Promise<void> {
		return this.ledgerAccountSettlementRepo.deleteSettlement(orgId, id);
	}

	public async addLedgerAccountSettlementEntries(
		orgId: OrgID,
		id: LedgerAccountSettlementID,
		entries: string[]
	): Promise<void> {
		return this.ledgerAccountSettlementRepo.addEntriesToSettlement(orgId, id, entries);
	}

	public async removeLedgerAccountSettlementEntries(
		orgId: OrgID,
		id: LedgerAccountSettlementID,
		entries: string[]
	): Promise<void> {
		return this.ledgerAccountSettlementRepo.removeEntriesFromSettlement(orgId, id, entries);
	}

	public async transitionSettlementStatus(
		orgId: OrgID,
		id: LedgerAccountSettlementID,
		targetStatus: SettlementStatus
	): Promise<LedgerAccountSettlementEntity> {
		const settlement = await this.ledgerAccountSettlementRepo.getSettlement(orgId, id);

		// Validate transition
		this.validateStatusTransition(settlement.status, targetStatus);

		// Handle transition-specific logic
		if (targetStatus === "pending" && settlement.status === "processing") {
			// Calculate and update amount
			const amount = await this.ledgerAccountSettlementRepo.calculateAmount(id);
			const updatedSettlement = settlement.withAmount(amount);
			await this.ledgerAccountSettlementRepo.updateSettlement(updatedSettlement);
		}

		// TODO: For pending → posted transition, create the ledger transaction
		// This will be implemented in a follow-up task

		return this.ledgerAccountSettlementRepo.updateStatus(orgId, id, targetStatus);
	}

	private validateStatusTransition(
		currentStatus: SettlementStatus,
		newStatus: SettlementStatus
	): void {
		const validTransitions: Record<SettlementStatus, SettlementStatus[]> = {
			drafting: ["processing"],
			processing: ["pending", "drafting"],
			pending: ["posted", "drafting"],
			posted: ["archiving"],
			archiving: ["archived"],
			archived: [],
		};

		if (!validTransitions[currentStatus].includes(newStatus)) {
			throw new NotImplementedError(`Invalid transition from ${currentStatus} to ${newStatus}`);
		}
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
