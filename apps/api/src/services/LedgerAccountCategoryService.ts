import { TypeID } from "typeid-js";
import { LedgerAccountCategoryEntity } from "@/repo/entities";
import type {
	LedgerAccountCategoryID,
	LedgerAccountID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import type { LedgerAccountCategoryRepo } from "@/repo/LedgerAccountCategoryRepo";

interface LedgerAccountCategoryRequest {
	name: string;
	description?: string;
	normalBalance: "debit" | "credit";
	metadata?: Record<string, unknown>;
}

interface LedgerOwnership {
	getLedger(organizationId: OrgID, ledgerId: LedgerID): Promise<unknown>;
}

class LedgerAccountCategoryService {
	constructor(
		private readonly ledgerAccountCategoryRepo: LedgerAccountCategoryRepo,
		private readonly ledgerOwnership: LedgerOwnership
	) {}

	public async listLedgerAccountCategories(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Promise<LedgerAccountCategoryEntity[]> {
		await this.ledgerOwnership.getLedger(organizationId, ledgerId);
		return this.ledgerAccountCategoryRepo.listLedgerAccountCategories(
			organizationId,
			ledgerId,
			offset,
			limit
		);
	}

	public async getLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Promise<LedgerAccountCategoryEntity> {
		await this.ledgerOwnership.getLedger(organizationId, ledgerId);
		return this.ledgerAccountCategoryRepo.getLedgerAccountCategory(
			organizationId,
			ledgerId,
			categoryId
		);
	}

	public async createLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: string,
		request: LedgerAccountCategoryRequest
	): Promise<LedgerAccountCategoryEntity> {
		const ledgerIdTyped = TypeID.fromString<"lgr">(ledgerId) as LedgerID;
		await this.ledgerOwnership.getLedger(organizationId, ledgerIdTyped);
		return this.ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
			LedgerAccountCategoryEntity.fromRequest(request, organizationId, ledgerIdTyped)
		);
	}

	public async updateLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: string,
		categoryId: string,
		request: LedgerAccountCategoryRequest
	): Promise<LedgerAccountCategoryEntity> {
		const ledgerIdTyped = TypeID.fromString<"lgr">(ledgerId) as LedgerID;
		const categoryIdTyped = TypeID.fromString<"lac">(categoryId) as LedgerAccountCategoryID;
		await this.ledgerOwnership.getLedger(organizationId, ledgerIdTyped);
		await this.ledgerAccountCategoryRepo.getLedgerAccountCategory(
			organizationId,
			ledgerIdTyped,
			categoryIdTyped
		);
		return this.ledgerAccountCategoryRepo.upsertLedgerAccountCategory(
			LedgerAccountCategoryEntity.fromRequest(request, organizationId, ledgerIdTyped, categoryId)
		);
	}

	public async deleteLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Promise<void> {
		await this.ledgerOwnership.getLedger(organizationId, ledgerId);
		return this.ledgerAccountCategoryRepo.deleteLedgerAccountCategory(
			organizationId,
			ledgerId,
			categoryId
		);
	}

	public async linkLedgerAccountToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Promise<void> {
		await this.ledgerOwnership.getLedger(organizationId, ledgerId);
		return this.ledgerAccountCategoryRepo.linkAccountToCategory(
			organizationId,
			ledgerId,
			categoryId,
			accountId
		);
	}

	public async unlinkLedgerAccountToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Promise<void> {
		await this.ledgerOwnership.getLedger(organizationId, ledgerId);
		return this.ledgerAccountCategoryRepo.unlinkAccountFromCategory(
			organizationId,
			ledgerId,
			categoryId,
			accountId
		);
	}

	public async linkLedgerAccountCategoryToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Promise<void> {
		await this.ledgerOwnership.getLedger(organizationId, ledgerId);
		return this.ledgerAccountCategoryRepo.linkCategoryToParent(
			organizationId,
			ledgerId,
			categoryId,
			parentCategoryId
		);
	}

	public async unlinkLedgerAccountCategoryToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Promise<void> {
		await this.ledgerOwnership.getLedger(organizationId, ledgerId);
		return this.ledgerAccountCategoryRepo.unlinkCategoryFromParent(
			organizationId,
			ledgerId,
			categoryId,
			parentCategoryId
		);
	}
}

export type { LedgerOwnership };
export { LedgerAccountCategoryService };
