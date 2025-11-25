import type { LedgerRepo } from "@/repo/LedgerRepo"
import type { LedgerTransactionRepo } from "@/repo/LedgerTransactionRepo"
import {
	LedgerAccountEntity,
	LedgerEntity,
	LedgerTransactionEntity,
	LedgerTransactionEntryEntity,
} from "./entities"
import { TypeID } from "typeid-js"
import type { OrgID, LedgerID } from "./entities/types"
import { NotImplementedError } from "@/errors"

// Transaction entry interface for creating transactions
interface TransactionEntryInput {
	accountId: string
	direction: "debit" | "credit"
	amount: string
}

// Transaction creation interface with validation
interface CreateTransactionInput {
	ledgerId: string
	description?: string
	entries: TransactionEntryInput[]
	idempotencyKey?: string
	effectiveAt?: Date
}

class LedgerTransactionService {
	constructor(
		private readonly ledgerTransactionRepo: LedgerTransactionRepo,
		private readonly ledgerRepo: LedgerRepo
	) {}

	// Core transaction operations with double-entry enforcement
	public async createTransactionWithEntries(
		input: CreateTransactionInput
	): Promise<LedgerTransactionEntity> {
		// 1. Validate entries for double-entry compliance
		this.validateDoubleEntry(input.entries)

		// 2. Validate all accounts exist and belong to the same ledger
		await this.validateAccounts(input.entries, input.ledgerId)

		// 3. Create the transaction atomically with all entries
		try {
			// Create transaction entity using the factory method
			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				TypeID.fromString<"lgr">(input.ledgerId) as LedgerID,
				input.entries,
				input.description,
				input.idempotencyKey
			)

			// Create entry entities
			const entryEntities = transactionEntity.entries || []

			const result = await this.ledgerTransactionRepo.createTransactionWithEntries(
				"org123", // TODO: Get from context/auth
				transactionEntity,
				entryEntities
			)

			return result
		} catch (error: unknown) {
			// Handle idempotency key conflicts
			if (error instanceof Error && error.message?.includes("duplicate key") && input.idempotencyKey) {
				throw new Error(`Transaction with idempotency key '${input.idempotencyKey}' already exists`)
			}
			throw error
		}
	}

	// Post (confirm) a pending transaction
	public async postTransaction(transactionId: string): Promise<LedgerTransactionEntity> {
		// TODO: Implement post transaction logic
		throw new NotImplementedError("Feature not yet implemented")
	}

	// Settlement workflow for PSP operations (US2: Accurate settlement processing)
	public async createSettlement(
		settledAccountId: string,
		contraAccountId: string,
		amount: string,
		description?: string
	): Promise<LedgerTransactionEntity> {
		// Create settlement transaction entries
		const settledAccount = {
			accountId: settledAccountId,
			direction: "debit" as const,
			amount,
		}

		const contraAccount = {
			accountId: contraAccountId,
			direction: "credit" as const,
			amount,
		}

		const entries = [settledAccount, contraAccount]

		return this.createTransactionWithEntries({
			ledgerId: "default", // TODO: Get from context
			description: description || `Settlement: ${settledAccountId} -> ${contraAccountId}`,
			entries,
		})
	}

	// Balance queries for account monitoring
	public async getAccountBalances(accountId: string, ledgerId: string): Promise<any> {
		// TODO: Implement balance calculation
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async getAccountBalancesFast(accountId: string, ledgerId: string): Promise<any> {
		// TODO: Implement fast balance calculation
		throw new NotImplementedError("Feature not yet implemented")
	}

	// Transaction history and reporting
	public async getTransactionHistory(
		accountId: string,
		limit: number,
		offset: number
	): Promise<LedgerTransactionEntity[]> {
		// TODO: Implement transaction history
		throw new NotImplementedError("Feature not yet implemented")
	}

	// CRUD operations for transactions
	public async listLedgerTransactions(
		offset: number,
		limit: number
	): Promise<LedgerTransactionEntity[]> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async getLedgerTransaction(id: string): Promise<LedgerTransactionEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async createLedgerTransaction(
		entity: LedgerTransactionEntity
	): Promise<LedgerTransactionEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async updateLedgerTransaction(
		id: string,
		entity: LedgerTransactionEntity
	): Promise<LedgerTransactionEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async deleteLedgerTransaction(id: string): Promise<void> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	// Transaction entry operations
	public async listLedgerTransactionEntries(
		offset: number,
		limit: number
	): Promise<LedgerTransactionEntryEntity[]> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async getLedgerTransactionEntry(id: string): Promise<LedgerTransactionEntryEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async createLedgerTransactionEntry(
		entity: LedgerTransactionEntryEntity
	): Promise<LedgerTransactionEntryEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async updateLedgerTransactionEntry(
		id: string,
		entity: LedgerTransactionEntryEntity
	): Promise<LedgerTransactionEntryEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	public async deleteLedgerTransactionEntry(id: string): Promise<void> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented")
	}

	// Private validation methods
	private validateDoubleEntry(entries: TransactionEntryInput[]): void {
		let totalDebits = 0
		let totalCredits = 0

		for (const entry of entries) {
			const amount = Number.parseFloat(entry.amount)
			if (entry.direction === "debit") {
				totalDebits += amount
			} else {
				totalCredits += amount
			}
		}

		if (Math.abs(totalDebits - totalCredits) > 0.0001) {
			throw new Error("Double-entry validation failed: total debits must equal total credits")
		}
	}

	private async validateAccounts(entries: TransactionEntryInput[], ledgerId: string): Promise<void> {
		// TODO: Implement account validation
		// For now, just pass validation
	}
}

export { LedgerTransactionService }
