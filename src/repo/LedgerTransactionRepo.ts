import { and, desc, eq, inArray } from "drizzle-orm";
import { TypeID } from "typeid-js";
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/errors";
import {
	LedgerAccountEntity,
	LedgerTransactionEntity,
	LedgerTransactionEntryEntity,
} from "@/services/entities";
import { handleDBError, isDBError } from "./errors";
import {
	LedgerAccountsTable,
	LedgersTable,
	LedgerTransactionEntriesTable,
	LedgerTransactionsTable,
} from "./schema";
import type { DrizzleDB } from "./types";

interface BalanceUpdate {
	id: string;
	newPostedAmount: number;
	newPostedCredits: number;
	newPostedDebits: number;
	expectedLockVersion: number;
}

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

		return LedgerTransactionEntity.fromRecord(record.ledger_transactions, entries);
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
	 *
	 * Optimistic locking approach:
	 * 1. READ: Fetch all accounts (outside transaction, no locks)
	 * 2. VALIDATE & BUILD: Check accounts, calculate balance updates in-memory
	 * 3. WRITE: Execute batched writes in single transaction
	 *
	 * Uses optimistic locking and upserts for idempotency.
	 * Entity invariants are enforced by LedgerTransactionEntity constructor.
	 */
	public async createTransaction(
		transaction: LedgerTransactionEntity
	): Promise<LedgerTransactionEntity> {
		// 1. Fetch all ledger accounts
		const accountIds = transaction.entries.map(e => e.accountId.toString());
		const accounts = await this.db
			.select()
			.from(LedgerAccountsTable)
			.where(inArray(LedgerAccountsTable.id, accountIds));

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
				// 3a. Insert transaction record
				const transactionResult = await tx
					.insert(LedgerTransactionsTable)
					.values(transaction.toRecord())
					.onConflictDoNothing({
						target: LedgerTransactionsTable.id,
					})
					.returning();
				const createdTransaction = LedgerTransactionEntity.fromRecord(transactionResult[0], [
					...transaction.entries,
				]);

				// 3b. Insert all entries in batch
				await Promise.all(
					transaction.entries.map(async entry => {
						await tx.insert(LedgerTransactionEntriesTable).values(entry.toRecord()).onConflictDoNothing({
							target: LedgerTransactionEntriesTable.id,
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
							throw new ConflictError(
								`Account ${account.id.toString()} was modified by another transaction`
							);
						}

						// More than one row updated = data integrity issue
						if (result.length > 1) {
							throw new ConflictError(
								`Data integrity error: Updated ${result.length} rows for account ${account.id.toString()}, expected 1`
							);
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

			throw new InternalServerError("Unexpected error during transaction creation");
		}
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
			// Delete entries first (FK constraint)
			await tx
				.delete(LedgerTransactionEntriesTable)
				.where(
					and(
						eq(LedgerTransactionEntriesTable.led, transactionId),
						eq(LedgerTransactionEntriesTable.transactionId, transactionId),
						eq(LedgerTransactionEntriesTable.transactionId, transactionId)
					)
				);

			// Then delete transaction
			await tx.delete(LedgerTransactionsTable).where(eq(LedgerTransactionsTable.id, transactionId));
		});
	}
}

export { LedgerTransactionRepo };
