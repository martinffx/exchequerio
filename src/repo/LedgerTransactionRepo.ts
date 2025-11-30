import { and, desc, eq, inArray } from "drizzle-orm";
import { TypeID } from "typeid-js";
import { ConflictError, NotFoundError } from "@/errors";
import { LedgerTransactionEntity, LedgerTransactionEntryEntity } from "@/services/entities";
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
	 * Get a single transaction with entries and organization tenancy validation
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

		// Fetch entries for this transaction
		const entryRecords = await this.db
			.select()
			.from(LedgerTransactionEntriesTable)
			.where(eq(LedgerTransactionEntriesTable.transactionId, transactionId));

		const entries = entryRecords.map(entryRecord =>
			LedgerTransactionEntryEntity.fromRecord(entryRecord)
		);

		return LedgerTransactionEntity.fromRecordWithEntries(
			record.ledger_transactions,
			TypeID.fromString<"org">(organizationId),
			entries
		);
	}

	/**
	 * List transactions with entries, pagination, and organization tenancy
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

		// Fetch entries for all transactions
		const transactionIds = records.map(r => r.ledger_transactions.id);

		if (transactionIds.length === 0) {
			return [];
		}

		const allEntries = await this.db
			.select()
			.from(LedgerTransactionEntriesTable)
			.where(inArray(LedgerTransactionEntriesTable.transactionId, transactionIds));

		// Group entries by transaction ID
		const entriesByTransaction = new Map<string, LedgerTransactionEntryEntity[]>();
		for (const entryRecord of allEntries) {
			const entry = LedgerTransactionEntryEntity.fromRecord(entryRecord);
			const txId = entryRecord.transactionId;
			if (!entriesByTransaction.has(txId)) {
				entriesByTransaction.set(txId, []);
			}
			entriesByTransaction.get(txId)?.push(entry);
		}

		const orgId = TypeID.fromString<"org">(organizationId);

		return records.map(record => {
			const entries = entriesByTransaction.get(record.ledger_transactions.id) ?? [];
			return LedgerTransactionEntity.fromRecordWithEntries(record.ledger_transactions, orgId, entries);
		});
	}

	/**
	 * Create transaction with entries and update account balances atomically.
	 * Uses optimistic locking and upserts for idempotency.
	 * Entity invariants are enforced by LedgerTransactionEntity constructor.
	 */
	public async createTransaction(entity: LedgerTransactionEntity): Promise<LedgerTransactionEntity> {
		return await this.db.transaction(async tx => {
			// 1. Validate ledger belongs to organization
			const ledgerValidation = await tx
				.select()
				.from(LedgersTable)
				.where(
					and(
						eq(LedgersTable.id, entity.ledgerId.toString()),
						eq(LedgersTable.organizationId, entity.organizationId.toString())
					)
				)
				.limit(1);

			if (ledgerValidation.length === 0) {
				throw new NotFoundError(
					`Ledger not found or does not belong to organization: ${entity.ledgerId.toString()}`
				);
			}

			// 2. Upsert the transaction record
			const transactionRecord = entity.toRecord();
			const transactionResult = await tx
				.insert(LedgerTransactionsTable)
				.values(transactionRecord)
				.onConflictDoUpdate({
					target: LedgerTransactionsTable.id,
					set: { updated: new Date() },
				})
				.returning();

			const createdTransaction = transactionResult[0];

			// 3. Create entries and update account balances atomically
			for (const entryEntity of entity.entries) {
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

			// 4. Return the created transaction with entries
			return LedgerTransactionEntity.fromRecordWithEntries(
				createdTransaction,
				entity.organizationId,
				[...entity.entries] // Convert readonly to mutable array
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

			// 2. Fetch entries
			const entryRecords = await tx
				.select()
				.from(LedgerTransactionEntriesTable)
				.where(eq(LedgerTransactionEntriesTable.transactionId, transactionId));

			const entries = entryRecords.map(entryRecord =>
				LedgerTransactionEntryEntity.fromRecord(entryRecord)
			);

			const orgId = TypeID.fromString<"org">(organizationId);

			// 3. Check if transaction is already posted
			if (transactionRecord.status === "posted") {
				// Return existing transaction if already posted
				return LedgerTransactionEntity.fromRecordWithEntries(transactionRecord, orgId, entries);
			}

			// 4. Update transaction status to posted
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

			// 5. Return the updated transaction with entries
			return LedgerTransactionEntity.fromRecordWithEntries(updateResult[0], orgId, entries);
		});
	}

	/**
	 * Delete a transaction and all its entries (for testing/cleanup purposes)
	 * WARNING: This bypasses business logic - only use for tests
	 */
	public async deleteTransaction(
		_organizationId: string,
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
