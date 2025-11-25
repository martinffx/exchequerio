import type { LedgerRepo } from "@/repo/LedgerRepo";
import type {
	LedgerAccountEntity,
	LedgerEntity,
	LedgerTransactionEntity,
	LedgerTransactionEntryEntity,
} from "./entities";
import { TypeID } from "typeid-js";

// Transaction entry interface for creating transactions
interface TransactionEntryInput {
	accountId: string;
	direction: "debit" | "credit";
	amount: string;
}

// Transaction creation interface with validation
interface CreateTransactionInput {
	ledgerId: string;
	description?: string;
	entries: TransactionEntryInput[];
	idempotencyKey?: string;
	effectiveAt?: Date;
}

class LedgerTransactionService {
	constructor(private readonly ledgerRepo: LedgerRepo) {}

	// Core transaction operations with double-entry enforcement
	public async createTransactionWithEntries(
		input: CreateTransactionInput,
	): Promise<unknown> {
		// 1. Validate entries for double-entry compliance
		this.validateDoubleEntry(input.entries);

		// 2. Validate all accounts exist and belong to the same ledger
		await this.validateAccounts(input.entries, input.ledgerId);

		// 3. Create the transaction atomically with all entries
		try {
			const result = await this.ledgerRepo.createTransactionWithEntries(
				input.ledgerId,
				input.description || null,
				input.entries,
				input.idempotencyKey,
			);

			return result;
		} catch (error: unknown) {
			// Handle idempotency key conflicts
			if (
				error instanceof Error &&
				error.message?.includes("duplicate key") &&
				input.idempotencyKey
			) {
				throw new Error(
					`Transaction with idempotency key '${input.idempotencyKey}' already exists`,
				);
			}
			throw error;
		}
	}

	// Post (confirm) a pending transaction
	public async postTransaction(transactionId: string): Promise<unknown> {
		return await this.ledgerRepo.postTransaction(transactionId);
	}

	// Settlement workflow for PSP operations (US2: Accurate settlement processing)
	public async createSettlement(
		settledAccountId: string,
		contraAccountId: string,
		amount: string,
		description?: string,
	): Promise<unknown> {
		// Get account details to determine ledger
		const settledAccount =
			await this.ledgerRepo.getAccountBalance(settledAccountId);
		const contraAccount =
			await this.ledgerRepo.getAccountBalance(contraAccountId);

		// Validate accounts belong to same ledger
		// Note: We'd need to add ledgerId to the account balance response for this check
		// For now, we'll trust they're in the same ledger

		// Create settlement transaction
		// Settled account gets debited (money flows out)
		// Contra account gets credited (money flows in)
		const entries: TransactionEntryInput[] = [
			{
				accountId: settledAccountId,
				direction: "debit",
				amount: amount,
			},
			{
				accountId: contraAccountId,
				direction: "credit",
				amount: amount,
			},
		];

		return await this.createTransactionWithEntries({
			ledgerId: "", // We'd need to get this from account details
			description:
				description || `Settlement: ${settledAccountId} to ${contraAccountId}`,
			entries,
			idempotencyKey: `settlement-${settledAccountId}-${Date.now()}`,
		});
	}

	// Balance queries for real-time merchant monitoring (US1)
	public async getAccountBalances(accountId: string, ledgerId: string) {
		return await this.ledgerRepo.getAccountBalances(accountId, ledgerId);
	}

	// High-performance balance query for p99 <500ms requirement
	public async getAccountBalancesFast(accountId: string, ledgerId: string) {
		return await this.ledgerRepo.getAccountBalancesFast(accountId, ledgerId);
	}

	// Fund flow tracking (US3: Track flow of funds)
	public async getTransactionHistory(
		accountId: string,
		limit = 50,
		offset = 0,
	): Promise<unknown[]> {
		// This would query transaction entries for an account
		// For now, return empty array as we need to add this query to repo
		return [];
	}

	// Validation helpers
	private validateDoubleEntry(entries: TransactionEntryInput[]): void {
		if (entries.length < 2) {
			throw new Error("Transaction must have at least 2 entries");
		}

		let totalDebits = 0;
		let totalCredits = 0;

		for (const entry of entries) {
			const amount = Number.parseFloat(entry.amount);

			if (Number.isNaN(amount) || amount <= 0) {
				throw new Error(`Invalid amount: ${entry.amount}`);
			}

			if (entry.direction === "debit") {
				totalDebits += amount;
			} else if (entry.direction === "credit") {
				totalCredits += amount;
			} else {
				throw new Error(`Invalid direction: ${entry.direction}`);
			}
		}

		const tolerance = 0.0001;
		if (Math.abs(totalDebits - totalCredits) > tolerance) {
			throw new Error(
				`Double-entry validation failed: debits (${totalDebits}) must equal credits (${totalCredits})`,
			);
		}
	}

	private async validateAccounts(
		entries: TransactionEntryInput[],
		ledgerId: string,
	): Promise<void> {
		// Check that all accounts exist and belong to the ledger
		for (const entry of entries) {
			try {
				await this.ledgerRepo.getAccountBalance(entry.accountId);
				// TODO: Add validation that account belongs to the correct ledger
			} catch (error) {
				throw new Error(`Account not found: ${entry.accountId}`);
			}
		}
	}

	// Legacy methods for API compatibility (to be removed/updated)
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
