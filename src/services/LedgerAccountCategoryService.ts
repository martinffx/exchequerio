import type { LedgerAccountCategoryEntity } from "@/repo/entities";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID } from "@/repo/entities/types";
import type { LedgerAccountCategoryRepo } from "@/repo/LedgerAccountCategoryRepo";

class LedgerAccountCategoryService {
	constructor(private readonly ledgerAccountCategoryRepo: LedgerAccountCategoryRepo) {}

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
}

export { LedgerAccountCategoryService };
