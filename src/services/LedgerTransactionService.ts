import type { LedgerRepo } from "@/repo/LedgerRepo";
import type {
	LedgerAccountEntity,
	LedgerEntity,
	LedgerTransactionEntity,
	LedgerTransactionEntryEntity,
} from "./entities";

class LedgerTransactionService {
	constructor(private readonly ledgerRepo: LedgerRepo) {}

	// Ledger Transaction
	public async listLedgerTransactions(
		offset: number,
		limit: number,
	): Promise<LedgerTransactionEntity[]> {
		throw new Error("Not implemented");
	}

	public async getLedgerTransaction(
		id: string,
	): Promise<LedgerTransactionEntity> {
		throw new Error("Not implemented");
	}

	public async createLedgerTransaction(
		entity: LedgerTransactionEntity,
	): Promise<LedgerTransactionEntity> {
		throw new Error("Not implemented");
	}

	public async updateLedgerTransaction(
		id: string,
		entity: LedgerTransactionEntity,
	): Promise<LedgerTransactionEntity> {
		throw new Error("Not implemented");
	}

	public async deleteLedgerTransaction(id: string): Promise<void> {
		throw new Error("Not implemented");
	}

	// Ledger Transaction Entry
	public async listLedgerTransactionEntries(
		offset: number,
		limit: number,
	): Promise<LedgerTransactionEntryEntity[]> {
		throw new Error("Not implemented");
	}

	public async getLedgerTransactionEntry(
		id: string,
	): Promise<LedgerTransactionEntryEntity> {
		throw new Error("Not implemented");
	}

	public async createLedgerTransactionEntry(
		entity: LedgerTransactionEntryEntity,
	): Promise<LedgerTransactionEntryEntity> {
		throw new Error("Not implemented");
	}

	public async updateLedgerTransactionEntry(
		id: string,
		entity: LedgerTransactionEntryEntity,
	): Promise<LedgerTransactionEntryEntity> {
		throw new Error("Not implemented");
	}

	public async deleteLedgerTransactionEntry(id: string): Promise<void> {
		throw new Error("Not implemented");
	}
}

export { LedgerTransactionService };
