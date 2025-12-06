import { and, desc, eq, inArray } from "drizzle-orm";
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/errors";
import {
	LedgerAccountEntity,
	type LedgerID,
	LedgerTransactionEntity,
	LedgerTransactionEntryEntity,
	type LedgerTransactionID,
	type OrgID,
} from "@/repo/entities";
import { handleDBError, isDBError } from "./errors";
import {
	LedgerAccountsTable,
	LedgersTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "./schema";
import type { DrizzleDB } from "./types";

/**
 * Repository for ledger transaction data access operations.
 *
 * Handles CRUD operations for transactions and their entries with:
 * - Organization-level multi-tenancy enforcement
 * - Optimistic locking for concurrent balance updates
 * - Atomic transaction processing with rollback support
 * - Double-entry bookkeeping invariant enforcement
 */
class LedgerTransactionRepo {
	constructor(private readonly db: DrizzleDB) {}

	/**
	 * Retrieves a single ledger transaction with all its entries.
	 *
	 * @param organizationId - Organization ID for tenancy validation
	 * @param ledgerId - Ledger ID the transaction belongs to
	 * @param transactionId - Unique transaction identifier
	 * @returns The transaction entity with all associated entries
	 * @throws {NotFoundError} When transaction doesn't exist or belongs to different organization
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

		return LedgerTransactionEntity.fromRecord(record.ledger_transactions, entries);
	}

	/**
	 * Lists ledger transactions with pagination and tenancy validation.
	 *
	 * Fetches transactions separately from entries to ensure pagination
	 * applies to transaction count, not to the joined result set.
	 *
	 * @param organizationId - Organization ID for tenancy validation
	 * @param ledgerId - Ledger ID to filter transactions
	 * @param offset - Number of transactions to skip (for pagination)
	 * @param limit - Maximum number of transactions to return
	 * @returns Array of transaction entities with their entries, ordered by creation date (newest first)
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

		const transactionIds = records.map(r => r.ledger_transactions.id);
		if (transactionIds.length === 0) {
			return [];
		}

		// Fetch entries for all transactions
		// we fetch transaction entries separately
		// because we do not want to messs with the pagination.
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

		return records.map(record => {
			const entries = entriesByTransaction.get(record.ledger_transactions.id) ?? [];
			return LedgerTransactionEntity.fromRecord(record.ledger_transactions, entries);
		});
	}

	/**
	 * Creates a new transaction with entries and updates account balances atomically.
	 *
	 * Uses optimistic locking approach:
	 * 1. READ: Fetch all affected accounts (outside transaction, no locks)
	 * 2. VALIDATE & BUILD: Check accounts exist, calculate balance updates in-memory
	 * 3. WRITE: Execute batched writes in single database transaction
	 *
	 * Features:
	 * - Optimistic locking prevents concurrent balance conflicts
	 * - Idempotent via upsert operations on transaction/entry IDs
	 * - Double-entry invariants enforced by LedgerTransactionEntity
	 * - Atomic rollback on any failure
	 *
	 * @param transaction - The transaction entity to create (with entries)
	 * @returns The created transaction entity
	 * @throws {NotFoundError} When a referenced account doesn't exist
	 * @throws {ConflictError} When optimistic lock fails (concurrent modification)
	 * @throws {InternalServerError} For unexpected database errors
	 */
	public async createTransaction(
		transaction: LedgerTransactionEntity
	): Promise<LedgerTransactionEntity> {
		// 1. Fetch all ledger accounts
		const accountIds = transaction.entries.map(e => e.accountId.toString());
		const accounts = await this.db
			.select()
			.from(LedgerAccountsTable)
			.where(and(inArray(LedgerAccountsTable.id, accountIds)));

		// 2. Update balances In-memory
		const ledgerAccountsById = new Map(
			accounts.map(a => {
				const account = LedgerAccountEntity.fromRecord(a);
				return [account.id.toString(), account];
			})
		);
		const ledgerAccounts = transaction.entries.map(entry => {
			const account = ledgerAccountsById.get(entry.accountId.toString());
			if (account !== undefined) {
				return account.applyEntry(entry);
			}
			throw new NotFoundError(
				`Missing Ledger Account ${entry.accountId.toString()}, for entry ${entry.id.toString()}`
			);
		});

		// 3. Write all the changes for the Ledger Transaction
		//    in a single DB transaction
		try {
			return await this.db.transaction(async tx => {
				// 3a. Insert transaction record (idempotent via upsert)
				const transactionRecord = transaction.toRecord();
				const transactionResult = await tx
					.insert(LedgerTransactionsTable)
					.values(transactionRecord)
					.onConflictDoUpdate({
						target: LedgerTransactionsTable.id,
						set: {
							ledgerId: transactionRecord.ledgerId,
							organizationId: transactionRecord.organizationId,
							description: transactionRecord.description,
							status: transactionRecord.status,
							metadata: transactionRecord.metadata,
							updated: transactionRecord.updated,
						},
					})
					.returning();
				const createdTransaction = LedgerTransactionEntity.fromRecord(transactionResult[0], [
					...transaction.entries,
				]);

				// 3b. Insert all entries in batch (idempotent via upsert)
				await Promise.all(
					transaction.entries.map(async entry => {
						const entryRecord = entry.toRecord();
						await tx
							.insert(LedgerTransactionEntriesTable)
							.values(entryRecord)
							.onConflictDoUpdate({
								target: LedgerTransactionEntriesTable.id,
								set: {
									transactionId: entryRecord.transactionId,
									accountId: entryRecord.accountId,
									organizationId: entryRecord.organizationId,
									direction: entryRecord.direction,
									amount: entryRecord.amount,
									currency: entryRecord.currency,
									currencyExponent: entryRecord.currencyExponent,
									status: entryRecord.status,
									metadata: entryRecord.metadata,
									updated: entryRecord.updated,
								},
							});
					})
				);

				// 3c. Update all account balances in parallel with optimistic locking
				await Promise.all(
					ledgerAccounts.map(async account => {
						const result = await tx
							.update(LedgerAccountsTable)
							.set(account.toRecord())
							.where(
								and(
									eq(LedgerAccountsTable.id, account.id.toString()),
									eq(LedgerAccountsTable.lockVersion, account.lockVersion)
								)
							)
							.returning();

						// No rows updated = optimistic lock failure
						if (result.length === 0) {
							throw new ConflictError({
								message: `Account ${account.id.toString()} was modified by another transaction`,
								retryable: true,
							});
						}

						// More than one row updated = data integrity issue
						if (result.length > 1) {
							throw new ConflictError({
								message: `Data integrity error: Updated ${result.length} rows for account ${account.id.toString()}, expected 1`,
							});
						}

						return LedgerAccountEntity.fromRecord(result[0]);
					})
				);

				// Return the created transaction with entries
				return createdTransaction;
			});
		} catch (error: unknown) {
			if (
				error instanceof ConflictError ||
				error instanceof ServiceUnavailableError ||
				error instanceof NotFoundError
			) {
				throw error;
			}

			if (isDBError(error)) {
				throw handleDBError(error, {
					ledgerId: transaction.ledgerId.toString(),
					transactionId: transaction.id.toString(),
					idempotencyKey: transaction.idempotencyKey,
				});
			}

			throw new InternalServerError("Unexpected error during transaction creation", error);
		}
	}

	/**
	 * Posts (confirms) a pending transaction, updating its status and account balances.
	 *
	 * Similar to createTransaction but for existing pending transactions:
	 * 1. Fetches the pending transaction with entries
	 * 2. Validates it's in pending status (returns early if already posted)
	 * 3. Calculates balance updates for all affected accounts
	 * 4. Atomically updates transaction status and account balances
	 *
	 * Features:
	 * - Idempotent: safe to call multiple times (returns existing if already posted)
	 * - Optimistic locking for account balance updates
	 * - Organization tenancy validation
	 *
	 * @param organizationId - Organization ID for tenancy validation
	 * @param ledgerId - Ledger ID the transaction belongs to
	 * @param transactionId - Transaction ID to post
	 * @returns The posted transaction entity
	 * @throws {NotFoundError} When transaction doesn't exist or account is missing
	 * @throws {ConflictError} When optimistic lock fails (concurrent modification)
	 * @throws {InternalServerError} For unexpected database errors
	 */
	public async postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Promise<LedgerTransactionEntity> {
		// 1. Get the transaction with organization tenancy validation
		const transactionRecords = await this.db
			.select()
			.from(LedgerTransactionsTable)
			.innerJoin(
				LedgerTransactionEntriesTable,
				eq(LedgerTransactionsTable.id, LedgerTransactionEntriesTable.transactionId)
			)
			.where(
				and(
					eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
					eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
					eq(LedgerTransactionsTable.id, transactionId.toString())
				)
			);

		if (transactionRecords.length === 0) {
			throw new NotFoundError(`Transaction not found: ${transactionId.toString()}`, {
				transactionId: transactionId.toString(),
				ledgerId: ledgerId.toString(),
				organizationId: organizationId.toString(),
			});
		}

		const entities = transactionRecords.map(tx =>
			LedgerTransactionEntryEntity.fromRecord(tx.ledger_transaction_entries)
		);
		const transactionRecord = LedgerTransactionEntity.fromRecord(
			transactionRecords[0].ledger_transactions,
			entities
		);

		// 2. Check if transaction is already posted
		if (transactionRecord.status === "posted") {
			// Return existing transaction if already posted
			return transactionRecord;
		}

		// 3. Post Transaction
		const postedTransaction = transactionRecord.postTransaction();

		// 4. Fetch all ledger accounts for Transaction
		const accountIds = postedTransaction.entries.map(e => e.accountId.toString());
		const accounts = await this.db
			.select()
			.from(LedgerAccountsTable)
			.where(and(inArray(LedgerAccountsTable.id, accountIds)));

		// 5. Update balances In-memory
		const ledgerAccountsById = new Map(
			accounts.map(a => {
				const account = LedgerAccountEntity.fromRecord(a);
				return [account.id.toString(), account];
			})
		);
		const ledgerAccounts = postedTransaction.entries.map(entry => {
			const account = ledgerAccountsById.get(entry.accountId.toString());
			if (account !== undefined) {
				return account.applyEntry(entry);
			}
			throw new NotFoundError(
				`Missing Ledger Account ${entry.accountId.toString()}, for entry ${entry.id.toString()}`
			);
		});

		// 6. Write everything in a single Transaction
		try {
			await this.db.transaction(async tx => {
				// 6.1. Update transaction
				await tx
					.update(LedgerTransactionsTable)
					.set(postedTransaction.toRecord())
					.where(eq(LedgerTransactionsTable.id, transactionId.toString()))
					.returning();

				// 6.2 Update Transaction Entries
				await Promise.all(
					postedTransaction.entries.map(async entry => {
						await tx.insert(LedgerTransactionEntriesTable).values(entry.toRecord()).onConflictDoNothing({
							target: LedgerTransactionEntriesTable.id,
						});
					})
				);

				// 6.3 Update Account Balances
				await Promise.all(
					ledgerAccounts.map(async account => {
						const result = await tx
							.update(LedgerAccountsTable)
							.set(account.toRecord())
							.where(
								and(
									eq(LedgerAccountsTable.id, account.id.toString()),
									eq(LedgerAccountsTable.lockVersion, account.lockVersion)
								)
							)
							.returning();

						// No rows updated = optimistic lock failure
						if (result.length === 0) {
							throw new ConflictError({
								message: `Account ${account.id.toString()} was modified by another transaction`,
								retryable: true,
								context: {
									transactionId: transactionId.toString(),
									ledgerId: ledgerId.toString(),
									organizationId: organizationId.toString(),
								},
							});
						}

						// More than one row updated = data integrity issue
						if (result.length > 1) {
							throw new ConflictError({
								message: `Data integrity error: Updated ${result.length} rows for account ${account.id.toString()}, expected 1`,
								context: {
									transactionId: transactionId.toString(),
									ledgerId: ledgerId.toString(),
									organizationId: organizationId.toString(),
								},
							});
						}

						return LedgerAccountEntity.fromRecord(result[0]);
					})
				);
			});

			return postedTransaction;
		} catch (error: unknown) {
			if (
				error instanceof ConflictError ||
				error instanceof ServiceUnavailableError ||
				error instanceof NotFoundError
			) {
				throw error;
			}

			if (isDBError(error)) {
				throw handleDBError(error, {
					ledgerId: postedTransaction.ledgerId.toString(),
					transactionId: postedTransaction.id.toString(),
					idempotencyKey: postedTransaction.idempotencyKey,
				});
			}

			throw new InternalServerError("Unexpected error during transaction creation", error);
		}
	}

	/**
	 * Deletes a transaction and all its entries.
	 *
	 * WARNING: This bypasses business logic and does NOT update account balances.
	 * Only use for testing or cleanup purposes where balance consistency is not required.
	 *
	 * @param organizationId - Organization ID for tenancy validation
	 * @param ledgerId - Ledger ID the transaction belongs to
	 * @param transactionId - Transaction ID to delete
	 */
	public async deleteTransaction(
		organizationId: string,
		ledgerId: string,
		transactionId: string
	): Promise<void> {
		await this.db.transaction(async tx => {
			// Delete entries first (FK constraint)
			await tx
				.delete(LedgerTransactionEntriesTable)
				.where(
					and(
						eq(LedgerTransactionEntriesTable.organizationId, organizationId),
						eq(LedgerTransactionEntriesTable.transactionId, transactionId)
					)
				);

			// Then delete transaction
			await tx
				.delete(LedgerTransactionsTable)
				.where(
					and(
						eq(LedgerTransactionsTable.organizationId, organizationId),
						eq(LedgerTransactionsTable.ledgerId, ledgerId),
						eq(LedgerTransactionsTable.id, transactionId)
					)
				);
		});
	}

	/**
	 * Deletes a transaction with proper balance reversal.
	 *
	 * Unlike deleteTransaction, this method:
	 * 1. Reverses balance updates for all affected accounts
	 * 2. Uses optimistic locking to prevent concurrent modification issues
	 * 3. Atomically deletes the transaction and entries
	 *
	 * This is the proper way to delete transactions while maintaining balance consistency.
	 *
	 * @param organizationId - Organization ID for tenancy validation
	 * @param ledgerId - Ledger ID the transaction belongs to
	 * @param transactionId - Transaction ID to delete
	 * @param transaction - The transaction entity (with entries) to delete
	 * @throws {NotFoundError} When a referenced account doesn't exist
	 * @throws {ConflictError} When optimistic lock fails (concurrent modification)
	 * @throws {InternalServerError} For unexpected database errors
	 */
	public async deleteTransactionWithBalanceUpdate(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		transaction: LedgerTransactionEntity
	): Promise<void> {
		// 1. Fetch all affected accounts
		const accountIds = transaction.entries.map(e => e.accountId.toString());
		const accounts = await this.db
			.select()
			.from(LedgerAccountsTable)
			.where(and(inArray(LedgerAccountsTable.id, accountIds)));

		// 2. Reverse balance updates in-memory
		const ledgerAccountsById = new Map(
			accounts.map(a => {
				const account = LedgerAccountEntity.fromRecord(a);
				return [account.id.toString(), account];
			})
		);

		// Reverse each entry (negate the amount effect)
		const ledgerAccounts = transaction.entries.map(entry => {
			const account = ledgerAccountsById.get(entry.accountId.toString());
			if (account === undefined) {
				throw new NotFoundError(
					`Missing Ledger Account ${entry.accountId.toString()}, for entry ${entry.id.toString()}`
				);
			}

			// Reverse the entry by applying it with opposite direction
			const reversedDirection = entry.direction === "debit" ? "credit" : "debit";
			return account.applyEntry({
				direction: reversedDirection,
				amount: entry.amount,
			});
		});

		// 3. Delete transaction and update balances atomically
		try {
			await this.db.transaction(async tx => {
				// 3a. Delete entries first (FK constraint)
				await tx
					.delete(LedgerTransactionEntriesTable)
					.where(
						and(
							eq(LedgerTransactionEntriesTable.organizationId, organizationId.toString()),
							eq(LedgerTransactionEntriesTable.transactionId, transactionId.toString())
						)
					);

				// 3b. Delete transaction
				await tx
					.delete(LedgerTransactionsTable)
					.where(
						and(
							eq(LedgerTransactionsTable.organizationId, organizationId.toString()),
							eq(LedgerTransactionsTable.ledgerId, ledgerId.toString()),
							eq(LedgerTransactionsTable.id, transactionId.toString())
						)
					);

				// 3c. Update all account balances with optimistic locking
				await Promise.all(
					ledgerAccounts.map(async account => {
						const result = await tx
							.update(LedgerAccountsTable)
							.set(account.toRecord())
							.where(
								and(
									eq(LedgerAccountsTable.id, account.id.toString()),
									eq(LedgerAccountsTable.lockVersion, account.lockVersion)
								)
							)
							.returning();

						// No rows updated = optimistic lock failure
						if (result.length === 0) {
							throw new ConflictError({
								message: `Account ${account.id.toString()} was modified by another transaction`,
								retryable: true,
								context: {
									transactionId: transactionId.toString(),
									ledgerId: ledgerId.toString(),
									organizationId: organizationId.toString(),
								},
							});
						}

						// More than one row updated = data integrity issue
						if (result.length > 1) {
							throw new ConflictError({
								message: `Data integrity error: Updated ${result.length} rows for account ${account.id.toString()}, expected 1`,
								context: {
									transactionId: transactionId.toString(),
									ledgerId: ledgerId.toString(),
									organizationId: organizationId.toString(),
								},
							});
						}

						return LedgerAccountEntity.fromRecord(result[0]);
					})
				);
			});
		} catch (error: unknown) {
			if (
				error instanceof ConflictError ||
				error instanceof ServiceUnavailableError ||
				error instanceof NotFoundError
			) {
				throw error;
			}

			if (isDBError(error)) {
				throw handleDBError(error, {
					ledgerId: ledgerId.toString(),
					transactionId: transactionId.toString(),
					organizationId: organizationId.toString(),
				});
			}

			throw new InternalServerError("Unexpected error during transaction deletion", error);
		}
	}
}

export { LedgerTransactionRepo };
