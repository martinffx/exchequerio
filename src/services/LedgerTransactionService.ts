import { TypeID } from "typeid-js";
import { NotImplementedError } from "@/errors";
import type { LedgerTransactionRepo } from "@/repo/LedgerTransactionRepo";
import { LedgerTransactionEntity, type LedgerTransactionEntryEntity } from "./entities";

// Transaction entry interface for creating transactions
interface TransactionEntryInput {
	accountId: string;
	direction: "debit" | "credit";
	amount: number; // Integer minor units
}

// Transaction creation interface
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

	// Core transaction operations - entity enforces double-entry invariants
	public async createTransactionWithEntries(
		input: CreateTransactionInput
	): Promise<LedgerTransactionEntity> {
		try {
			// Create transaction entity - constructor validates all invariants
			const transactionEntity = LedgerTransactionEntity.createWithEntries(
				TypeID.fromString<"org">(input.organizationId),
				TypeID.fromString<"lgr">(input.ledgerId),
				input.entries,
				input.description,
				input.idempotencyKey
			);

			// Repository validates accounts exist and belong to ledger
			const result = await this.ledgerTransactionRepo.createTransaction(transactionEntity);

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
		organizationId: string,
		ledgerId: string,
		settledAccountId: string,
		contraAccountId: string,
		amount: number, // Integer minor units
		description?: string
	): Promise<LedgerTransactionEntity> {
		// Create settlement transaction entries (amount already in integer minor units)
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
			organizationId,
			ledgerId,
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
}

export { LedgerTransactionService };
