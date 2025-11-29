import { and, desc, eq } from "drizzle-orm";
import { ConflictError, NotFoundError } from "@/errors";
import { LedgerTransactionEntity, type LedgerTransactionEntryEntity } from "@/services/entities";
import {
	LedgerAccountsTable,
	LedgersTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "./schema";
import type { DrizzleDB } from "./types";

class LedgerTransactionRepo {
	constructor(private readonly db: DrizzleDB) {}

	/**
	 * Database transaction wrapper for ACID operations
	 */
	public async withTransaction<T>(function_: (tx: DrizzleDB) => Promise<T>): Promise<T> {
		return await this.db.transaction(function_);
	}

	/**
	 * Get a single transaction with organization tenancy validation
	 */
	public async getLedgerTransaction(
		organizationId: string,
		ledgerId: string,
		transactionId: string
	): Promise<LedgerTransactionEntity> {
		const records = await this.db
			.select()
			.from(LedgerTransactionsTable)
			.innerJoin(LedgersTable, eq(LedgerTransactionsTable.ledgerId, LedgersTable.id))
			.where(
				and(
					eq(LedgersTable.organizationId, organizationId),
					eq(LedgerTransactionsTable.ledgerId, ledgerId),
					eq(LedgerTransactionsTable.id, transactionId)
				)
			)
			.limit(1);

		if (records.length === 0) {
			throw new NotFoundError(`Transaction not found: ${transactionId}`);
		}

		const record = records[0];
		return LedgerTransactionEntity.fromRecord(record.ledger_transactions);
	}

	/**
	 * List transactions with pagination and organization tenancy
	 */
	public async listLedgerTransactions(
		organizationId: string,
		ledgerId: string,
		offset: number,
		limit: number
	): Promise<LedgerTransactionEntity[]> {
		const records = await this.db
			.select()
			.from(LedgerTransactionsTable)
			.innerJoin(LedgersTable, eq(LedgerTransactionsTable.ledgerId, LedgersTable.id))
			.where(
				and(
					eq(LedgersTable.organizationId, organizationId),
					eq(LedgerTransactionsTable.ledgerId, ledgerId)
				)
			)
			.orderBy(desc(LedgerTransactionsTable.created))
			.limit(limit)
			.offset(offset);

		return records.map(record => LedgerTransactionEntity.fromRecord(record.ledger_transactions));
	}

	/**
	 * Create transaction with entries using entity transformation pattern
	 */
	public async createTransactionWithEntries(
		organizationId: string,
		transactionEntity: LedgerTransactionEntity,
		entryEntities: LedgerTransactionEntryEntity[]
	): Promise<LedgerTransactionEntity> {
		return await this.withTransaction(async tx => {
			// 1. Validate ledger belongs to organization
			const ledgerValidation = await tx
				.select()
				.from(LedgersTable)
				.where(
					and(
						eq(LedgersTable.id, transactionEntity.ledgerId.toString()),
						eq(LedgersTable.organizationId, organizationId)
					)
				)
				.limit(1);

			if (ledgerValidation.length === 0) {
				throw new NotFoundError(
					`Ledger not found or does not belong to organization: ${transactionEntity.ledgerId.toString()}`
				);
			}

			// 2. Validate double-entry rule: debits must equal credits
			let totalDebits = 0;
			let totalCredits = 0;

			for (const entry of entryEntities) {
				const amount = Number.parseFloat(entry.amount);
				if (entry.direction === "debit") {
					totalDebits += amount;
				} else {
					totalCredits += amount;
				}
			}

			if (Math.abs(totalDebits - totalCredits) > 0.0001) {
				throw new ConflictError(
					"Double-entry validation failed: total debits must equal total credits"
				);
			}

			// 3. Create the transaction record
			const transactionRecord = transactionEntity.toRecord();
			const transactionResult = await tx
				.insert(LedgerTransactionsTable)
				.values(transactionRecord)
				.returning();

			const createdTransaction = transactionResult[0];

			// 4. Create entries and update account balances atomically
			for (const entryEntity of entryEntities) {
				// Lock account for update to prevent race conditions
				const account = await this.getAccountWithLockInternal(entryEntity.accountId.toString(), tx);

				// Calculate new balance based on normal balance and entry direction
				const currentBalance = Number.parseFloat(account.balanceAmount);
				const entryAmount = Number.parseFloat(entryEntity.amount);
				let newBalance: number;

				// Apply double-entry accounting rules
				if (account.normalBalance === "debit") {
					newBalance =
						entryEntity.direction === "debit"
							? currentBalance + entryAmount
							: currentBalance - entryAmount;
				} else {
					// credit normal balance
					newBalance =
						entryEntity.direction === "credit"
							? currentBalance + entryAmount
							: currentBalance - entryAmount;
				}

				// Update account balance with optimistic locking
				await this.updateAccountBalanceInternal(
					entryEntity.accountId.toString(),
					newBalance.toFixed(4),
					account.lockVersion,
					tx
				);

				// Create transaction entry record
				const entryRecord = entryEntity.toRecord();
				entryRecord.transactionId = createdTransaction.id;
				await tx.insert(LedgerTransactionEntriesTable).values(entryRecord);
			}

			// 5. Return the created transaction as entity
			return LedgerTransactionEntity.fromRecord(createdTransaction);
		});
	}

	/**
	 * Get account with row-level lock for atomic operations
	 */
	private async getAccountWithLockInternal(accountId: string, tx: DrizzleDB) {
		const accounts = await tx
			.select()
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.id, accountId))
			.for("update");

		if (accounts.length === 0) {
			throw new NotFoundError(`Account ${accountId} not found`);
		}

		return accounts[0];
	}

	/**
	 * Update account balance with optimistic locking
	 */
	private async updateAccountBalanceInternal(
		accountId: string,
		balance: string,
		expectedVersion: number,
		tx: DrizzleDB
	): Promise<void> {
		const result = await tx
			.update(LedgerAccountsTable)
			.set({
				balanceAmount: balance,
				lockVersion: expectedVersion + 1,
				updated: new Date(),
			})
			.where(
				and(eq(LedgerAccountsTable.id, accountId), eq(LedgerAccountsTable.lockVersion, expectedVersion))
			);

		// Check if update was successful (optimistic lock check)
		if (result.rowCount === 0) {
			throw new ConflictError(
				`Account ${accountId} was modified by another transaction (version mismatch)`
			);
		}
	}

	// Public method for creating transactions with callback (for test compatibility)
	public async createTransaction<T>(callback: (tx: DrizzleDB) => Promise<T>): Promise<T> {
		return await this.db.transaction(callback);
	}

	// Public wrapper for getAccountWithLock (for test compatibility)
	public async getAccountWithLock(accountId: string): Promise<Record<string, unknown>> {
		return await this.withTransaction(async tx => {
			return await this.getAccountWithLockInternal(accountId, tx);
		});
	}

	// Public wrapper for updateAccountBalance (for test compatibility)
	public async updateAccountBalance(
		accountId: string,
		amount: string,
		direction: "debit" | "credit"
	): Promise<void> {
		return await this.withTransaction(async tx => {
			// Get current account state
			const account = await this.getAccountWithLockInternal(accountId, tx);

			// Calculate new balance
			const currentBalance = Number.parseFloat(account.balanceAmount);
			const amountNumber = Number.parseFloat(amount);
			let newBalance: number;

			if (account.normalBalance === "debit") {
				newBalance =
					direction === "debit" ? currentBalance + amountNumber : currentBalance - amountNumber;
			} else {
				// credit normal balance
				newBalance =
					direction === "credit" ? currentBalance + amountNumber : currentBalance - amountNumber;
			}

			// Update the balance
			await this.updateAccountBalanceInternal(
				accountId,
				newBalance.toFixed(4),
				account.lockVersion,
				tx
			);
		});
	}

	/**
	 * Post (confirm) a pending transaction with organization tenancy
	 */
	public async postTransaction(
		organizationId: string,
		ledgerId: string,
		transactionId: string
	): Promise<LedgerTransactionEntity> {
		return await this.withTransaction(async tx => {
			// 1. Get the transaction with organization tenancy validation
			const transactionRecords = await tx
				.select()
				.from(LedgerTransactionsTable)
				.innerJoin(LedgersTable, eq(LedgerTransactionsTable.ledgerId, LedgersTable.id))
				.where(
					and(
						eq(LedgersTable.organizationId, organizationId),
						eq(LedgerTransactionsTable.ledgerId, ledgerId),
						eq(LedgerTransactionsTable.id, transactionId)
					)
				)
				.limit(1);

			if (transactionRecords.length === 0) {
				throw new NotFoundError(`Transaction not found: ${transactionId}`);
			}

			const transactionRecord = transactionRecords[0].ledger_transactions;

			// 2. Check if transaction is already posted
			if (transactionRecord.status === "posted") {
				// Return existing transaction if already posted
				return LedgerTransactionEntity.fromRecord(transactionRecord);
			}

			// 3. Update transaction status to posted
			const updateResult = await tx
				.update(LedgerTransactionsTable)
				.set({
					status: "posted",
					updated: new Date(),
				})
				.where(eq(LedgerTransactionsTable.id, transactionId))
				.returning();

			if (updateResult.length === 0) {
				throw new NotFoundError(`Transaction not found: ${transactionId}`);
			}

			// 4. Return the updated transaction
			return LedgerTransactionEntity.fromRecord(updateResult[0]);
		});
	}
}

export { LedgerTransactionRepo };
