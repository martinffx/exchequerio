import { TypeID } from "typeid-js";
import { NotImplementedError } from "@/errors";
import type { LedgerTransactionRepo } from "@/repo/LedgerTransactionRepo";
import { LedgerTransactionEntity, type LedgerTransactionEntryEntity } from "./entities";
import type { LedgerID } from "./entities/types";

// Transaction entry interface for creating transactions
interface TransactionEntryInput {
	accountId: string;
	direction: "debit" | "credit";
	amount: string;
}

// Transaction creation interface with validation
interface CreateTransactionInput {
	organizationId: string;
	ledgerId: string;
	description?: string;
	entries: TransactionEntryInput[];
	idempotencyKey?: string;
	effectiveAt?: Date;
}

class LedgerTransactionService {
	constructor(private readonly ledgerTransactionRepo: LedgerTransactionRepo) {}

	// Core transaction operations with double-entry enforcement
	public async createTransactionWithEntries(
		input: CreateTransactionInput
	): Promise<LedgerTransactionEntity> {
		// 1. Validate entries for double-entry compliance
		this.validateDoubleEntry(input.entries);

		// 2. Validate all accounts exist and belong to the same ledger
		await this.validateAccounts(input.entries, input.ledgerId);

		// 3. Create the transaction atomically with all entries
		try {
			// Create transaction entity using the factory method
			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				TypeID.fromString<"lgr">(input.ledgerId) as LedgerID,
				input.entries,
				input.description,
				input.idempotencyKey
			);

			// Create entry entities
			const entryEntities = transactionEntity.entries ?? [];

			const result = await this.ledgerTransactionRepo.createTransactionWithEntries(
				input.organizationId,
				transactionEntity,
				entryEntities
			);

			return result;
		} catch (error: unknown) {
			// Handle idempotency key conflicts
			if (error instanceof Error && error.message?.includes("duplicate key") && input.idempotencyKey) {
				throw new Error(`Transaction with idempotency key '${input.idempotencyKey}' already exists`);
			}
			throw error;
		}
	}

	// Post (confirm) a pending transaction
	public async postTransaction(transactionId: string): Promise<LedgerTransactionEntity> {
		// TODO: Get organizationId and ledgerId from context/auth
		// For now, use placeholder values
		const organizationId = "org123"; // TODO: Get from context/auth
		const ledgerId = "ledger456"; // TODO: Get from context/auth

		return await this.ledgerTransactionRepo.postTransaction(organizationId, ledgerId, transactionId);
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
		};

		const contraAccount = {
			accountId: contraAccountId,
			direction: "credit" as const,
			amount,
		};

		const entries = [settledAccount, contraAccount];

		return this.createTransactionWithEntries({
			organizationId: "default", // TODO: Get from context
			ledgerId: "default", // TODO: Get from context
			description: description ?? `Settlement: ${settledAccountId} -> ${contraAccountId}`,
			entries,
		});
	}

	// Balance queries for account monitoring
	public getAccountBalances(
		_accountId: string,
		_ledgerId: string
	): Promise<Record<string, unknown>> {
		// TODO: Implement balance calculation
		throw new NotImplementedError("Feature not yet implemented");
	}

	public getAccountBalancesFast(
		_accountId: string,
		_ledgerId: string
	): Promise<Record<string, unknown>> {
		// TODO: Implement fast balance calculation
		throw new NotImplementedError("Feature not yet implemented");
	}

	// Transaction history and reporting
	public getTransactionHistory(
		_accountId: string,
		_limit: number,
		_offset: number
	): Promise<LedgerTransactionEntity[]> {
		// TODO: Implement transaction history
		throw new NotImplementedError("Feature not yet implemented");
	}

	// CRUD operations for transactions
	public listLedgerTransactions(
		_offset: number,
		_limit: number
	): Promise<LedgerTransactionEntity[]> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	public getLedgerTransaction(_id: string): Promise<LedgerTransactionEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	public createLedgerTransaction(
		_entity: LedgerTransactionEntity
	): Promise<LedgerTransactionEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	public updateLedgerTransaction(
		_id: string,
		_entity: LedgerTransactionEntity
	): Promise<LedgerTransactionEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	public deleteLedgerTransaction(_id: string): Promise<void> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	// Transaction entry operations
	public listLedgerTransactionEntries(
		_offset: number,
		_limit: number
	): Promise<LedgerTransactionEntryEntity[]> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	public getLedgerTransactionEntry(_id: string): Promise<LedgerTransactionEntryEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	public createLedgerTransactionEntry(
		_entity: LedgerTransactionEntryEntity
	): Promise<LedgerTransactionEntryEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	public updateLedgerTransactionEntry(
		_id: string,
		_entity: LedgerTransactionEntryEntity
	): Promise<LedgerTransactionEntryEntity> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	public deleteLedgerTransactionEntry(_id: string): Promise<void> {
		// TODO: Implement with proper organization tenancy
		throw new NotImplementedError("Feature not yet implemented");
	}

	// Private validation methods
	private validateDoubleEntry(entries: TransactionEntryInput[]): void {
		let totalDebits = 0;
		let totalCredits = 0;

		for (const entry of entries) {
			const amount = Number.parseFloat(entry.amount);
			if (entry.direction === "debit") {
				totalDebits += amount;
			} else {
				totalCredits += amount;
			}
		}

		if (Math.abs(totalDebits - totalCredits) > 0.0001) {
			throw new Error("Double-entry validation failed: total debits must equal total credits");
		}
	}

	private async validateAccounts(
		_entries: TransactionEntryInput[],
		_ledgerId: string
	): Promise<void> {
		// TODO: Implement account validation
		// For now, just pass validation
	}
}

export { LedgerTransactionService };
