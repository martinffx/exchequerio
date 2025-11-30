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
	 * Create transaction with entries and update account balances atomically.
	 * Uses optimistic locking and upserts for idempotency.
	 */
	public async createTransaction(
		organizationId: string,
		transactionEntity: LedgerTransactionEntity,
		entryEntities: LedgerTransactionEntryEntity[]
	): Promise<LedgerTransactionEntity> {
		return await this.db.transaction(async tx => {
			// 1. Validate ledger belongs to organization and get currency info
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
				// Amount is already integer minor units
				if (entry.direction === "debit") {
					totalDebits += entry.amount;
				} else {
					totalCredits += entry.amount;
				}
			}

			if (totalDebits !== totalCredits) {
				throw new ConflictError(
					"Double-entry validation failed: total debits must equal total credits"
				);
			}

			// 3. Upsert the transaction record
			const transactionRecord = transactionEntity.toRecord();
			const transactionResult = await tx
				.insert(LedgerTransactionsTable)
				.values(transactionRecord)
				.onConflictDoUpdate({
					target: LedgerTransactionsTable.id,
					set: { updated: new Date() },
				})
				.returning();

			const createdTransaction = transactionResult[0];

			// 4. Create entries and update account balances atomically
			for (const entryEntity of entryEntities) {
				// Lock account for update to prevent race conditions
				const accounts = await tx
					.select()
					.from(LedgerAccountsTable)
					.where(eq(LedgerAccountsTable.id, entryEntity.accountId.toString()))
					.for("update");

				if (accounts.length === 0) {
					throw new NotFoundError(`Account not found: ${entryEntity.accountId.toString()}`);
				}

				const account = accounts[0];

				// Entry amount is already integer minor units - use directly
				const entryAmountMinor = entryEntity.amount;

				// Calculate new balance using integer arithmetic
				let newPostedAmount = account.postedAmount;
				let newPostedCredits = account.postedCredits;
				let newPostedDebits = account.postedDebits;

				// Apply double-entry accounting rules
				if (account.normalBalance === "debit") {
					if (entryEntity.direction === "debit") {
						newPostedAmount += entryAmountMinor;
						newPostedDebits += entryAmountMinor;
					} else {
						newPostedAmount -= entryAmountMinor;
						newPostedCredits += entryAmountMinor;
					}
				} else {
					// credit normal balance
					if (entryEntity.direction === "credit") {
						newPostedAmount += entryAmountMinor;
						newPostedCredits += entryAmountMinor;
					} else {
						newPostedAmount -= entryAmountMinor;
						newPostedDebits += entryAmountMinor;
					}
				}

				// Update account balance with optimistic locking
				const updateResult = await tx
					.update(LedgerAccountsTable)
					.set({
						postedAmount: newPostedAmount,
						postedCredits: newPostedCredits,
						postedDebits: newPostedDebits,
						availableAmount: newPostedAmount,
						availableCredits: newPostedCredits,
						availableDebits: newPostedDebits,
						lockVersion: account.lockVersion + 1,
						updated: new Date(),
					})
					.where(
						and(
							eq(LedgerAccountsTable.id, entryEntity.accountId.toString()),
							eq(LedgerAccountsTable.lockVersion, account.lockVersion)
						)
					)
					.returning();

				if (updateResult.length === 0) {
					throw new ConflictError(
						`Account ${entryEntity.accountId.toString()} was modified by another transaction`
					);
				}

				// Upsert transaction entry record
				const entryRecord = entryEntity.toRecord();
				entryRecord.transactionId = createdTransaction.id;
				await tx
					.insert(LedgerTransactionEntriesTable)
					.values(entryRecord)
					.onConflictDoUpdate({
						target: LedgerTransactionEntriesTable.id,
						set: { updated: new Date() },
					});
			}

			// 5. Return the created transaction as entity
			return LedgerTransactionEntity.fromRecord(createdTransaction);
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
		return await this.db.transaction(async tx => {
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

	/**
	 * Delete a transaction and all its entries (for testing/cleanup purposes)
	 * WARNING: This bypasses business logic - only use for tests
	 */
	public async deleteTransaction(
		organizationId: string,
		ledgerId: string,
		transactionId: string
	): Promise<void> {
		await this.db.transaction(async tx => {
			// Verify transaction belongs to this org/ledger
			const transaction = await tx
				.select()
				.from(LedgerTransactionsTable)
				.where(eq(LedgerTransactionsTable.id, transactionId))
				.limit(1);

			if (transaction.length === 0) {
				throw new NotFoundError(`Transaction not found: ${transactionId}`);
			}

			if (transaction[0].ledgerId !== ledgerId) {
				throw new NotFoundError(`Transaction not found: ${transactionId}`);
			}

			// Delete entries first (FK constraint)
			await tx
				.delete(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, transactionId));

			// Then delete transaction
			await tx.delete(LedgerTransactionsTable).where(eq(LedgerTransactionsTable.id, transactionId));
		});
	}
}

export { LedgerTransactionRepo };
