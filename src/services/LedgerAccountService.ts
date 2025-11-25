import type { LedgerRepo } from "@/repo/LedgerRepo";
import type {
	LedgerAccountBalanceMonitorEntity,
	LedgerAccountCategoryEntity,
	LedgerAccountEntity,
	LedgerAccountSettlementEntity,
	LedgerAccountStatementEntity,
} from "./entities";

class LedgerAccountService {
	constructor(private readonly ledgerRepo: LedgerRepo) {}

	// Ledger Account
	public async listLedgerAccounts(
		offset: number,
		limit: number,
	): Promise<LedgerAccountEntity[]> {
		throw new Error("Not implemented");
	}

	public async getLedgerAccount(id: string): Promise<LedgerAccountEntity> {
		// This would need a proper implementation with repository calls
		// For now, returning a placeholder to demonstrate the pattern
		throw new Error("Method needs repository implementation");
	}

	public async createLedgerAccount(
		entity: LedgerAccountEntity,
	): Promise<LedgerAccountEntity> {
		throw new Error("Not implemented");
	}

	public async updateLedgerAccount(
		id: string,
		entity: LedgerAccountEntity,
	): Promise<LedgerAccountEntity> {
		throw new Error("Not implemented");
	}

	public async deleteLedgerAccount(id: string): Promise<void> {
		throw new Error("Not implemented");
	}

	// Ledger Account Category
	public async listLedgerAccountCategories(
		offset: number,
		limit: number,
	): Promise<LedgerAccountCategoryEntity[]> {
		throw new Error("Not implemented");
	}

	public async getLedgerAccountCategory(
		id: string,
	): Promise<LedgerAccountCategoryEntity> {
		throw new Error("Not implemented");
	}

	public async createLedgerAccountCategory(
		entity: LedgerAccountCategoryEntity,
	): Promise<LedgerAccountCategoryEntity> {
		throw new Error("Not implemented");
	}

	public async updateLedgerAccountCategory(
		id: string,
		entity: LedgerAccountCategoryEntity,
	): Promise<LedgerAccountCategoryEntity> {
		throw new Error("Not implemented");
	}

	public async deleteLedgerAccountCategory(id: string): Promise<void> {
		throw new Error("Not implemented");
	}

	public async linkLedgerAccountToCategory(
		id: string,
		accountId: string,
	): Promise<void> {
		throw new Error("Not implemented");
	}

	public async unlinkLedgerAccountToCategory(
		id: string,
		accountId: string,
	): Promise<void> {
		throw new Error("Not implemented");
	}

	public async linkLedgerAccountCategoryToCategory(
		id: string,
		categoryId: string,
	): Promise<void> {
		throw new Error("Not implemented");
	}

	public async unlinkLedgerAccountCategoryToCategory(
		id: string,
		categoryId: string,
	): Promise<void> {
		throw new Error("Not implemented");
	}

	// Ledger Account Settlement
	public async listLedgerAccountSettlements(
		offset: number,
		limit: number,
	): Promise<LedgerAccountSettlementEntity[]> {
		throw new Error("Not implemented");
	}

	public async getLedgerAccountSettlement(
		id: string,
	): Promise<LedgerAccountSettlementEntity> {
		throw new Error("Not implemented");
	}

	public async createLedgerAccountSettlement(
		entity: LedgerAccountSettlementEntity,
	): Promise<LedgerAccountSettlementEntity> {
		throw new Error("Not implemented");
	}

	public async updateLedgerAccountSettlement(
		id: string,
		entity: LedgerAccountSettlementEntity,
	): Promise<LedgerAccountSettlementEntity> {
		throw new Error("Not implemented");
	}

	public async deleteLedgerAccountSettlement(id: string): Promise<void> {
		throw new Error("Not implemented");
	}

	public async addLedgerAccountSettlementEntries(
		id: string,
		entries: string[],
	): Promise<void> {
		throw new Error("Not implemented");
	}

	public async removeLedgerAccountSettlementEntries(
		id: string,
		entries: string[],
	): Promise<void> {
		throw new Error("Not implemented");
	}

	// Ledger Account Statement
	public async getLedgerAccountStatement(
		id: string,
	): Promise<LedgerAccountStatementEntity> {
		throw new Error("Not implemented");
	}

	public async createLedgerAccountStatement(
		entity: LedgerAccountStatementEntity,
	): Promise<LedgerAccountStatementEntity> {
		throw new Error("Not implemented");
	}

	// Ledger Account Balance Monitor§
	public async listLedgerAccountBalanceMonitors(
		offset: number,
		limit: number,
	): Promise<LedgerAccountBalanceMonitorEntity[]> {
		throw new Error("Not implemented");
	}

	public async getLedgerAccountBalanceMonitor(
		id: string,
	): Promise<LedgerAccountBalanceMonitorEntity> {
		throw new Error("Not implemented");
	}

	public async createLedgerAccountBalanceMonitor(
		entity: LedgerAccountBalanceMonitorEntity,
	): Promise<LedgerAccountBalanceMonitorEntity> {
		throw new Error("Not implemented");
	}

	public async updateLedgerAccountBalanceMonitor(
		id: string,
		entity: LedgerAccountBalanceMonitorEntity,
	): Promise<LedgerAccountBalanceMonitorEntity> {
		throw new Error("Not implemented");
	}

	public async deleteLedgerAccountBalanceMonitor(id: string): Promise<void> {
		throw new Error("Not implemented");
	}
}

export { LedgerAccountService };
