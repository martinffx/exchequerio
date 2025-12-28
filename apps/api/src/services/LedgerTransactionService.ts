import { retry } from "radash";
import { ConflictError, NotFoundError } from "@/errors";
import {
	type LedgerID,
	LedgerTransactionEntity,
	type LedgerTransactionID,
	type OrgID,
} from "@/repo/entities";
import type { LedgerRepo } from "@/repo/LedgerRepo";
import type { LedgerTransactionRepo } from "@/repo/LedgerTransactionRepo";
import type { LedgerTransactionRequest } from "@/routes/ledgers/schema";

class LedgerTransactionService {
	constructor(
		private readonly ledgerTransactionRepo: LedgerTransactionRepo,
		private readonly ledgerRepo: LedgerRepo
	) {}

	public async listTransactions(
		orgId: OrgID,
		ledgerId: LedgerID,
		offset = 0,
		limit = 20
	): Promise<LedgerTransactionEntity[]> {
		return this.ledgerTransactionRepo.listLedgerTransactions(
			orgId.toString(),
			ledgerId.toString(),
			offset,
			limit
		);
	}

	public async getLedgerTransaction(
		orgId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Promise<LedgerTransactionEntity> {
		return this.ledgerTransactionRepo.getLedgerTransaction(
			orgId.toString(),
			ledgerId.toString(),
			transactionId.toString()
		);
	}

	// Core transaction operations - entity enforces double-entry invariants
	public async createTransaction(
		orgId: OrgID,
		ledgerId: LedgerID,
		rq: LedgerTransactionRequest
	): Promise<LedgerTransactionEntity> {
		// Fetch ledger to get currency information
		const ledger = await this.ledgerRepo.getLedger(orgId, ledgerId);

		if (!ledger) {
			throw new NotFoundError(`Ledger ${ledgerId.toString()} not found`, {
				organizationId: orgId.toString(),
				ledgerId: ledgerId.toString(),
			});
		}

		// Create transaction entity - constructor validates all invariants
		const transactionEntity = LedgerTransactionEntity.fromRequest({
			rq,
			ledger,
		});

		// Repository validates accounts exist and belong to ledger
		// Retry on 409 conflicts (optimistic locking) with exponential backoff + jitter
		const result = await retry(
			{
				times: 5,
				delay: 50,
				backoff: attempt => {
					// Exponential backoff with full jitter, capped at 1s to prevent long waits
					const base = Math.min(1000, 50 * 2 ** attempt);
					return Math.floor(Math.random() * base);
				},
			},
			async exit => {
				try {
					return await this.ledgerTransactionRepo.createTransaction(transactionEntity);
				} catch (error) {
					// Only retry on ConflictError with retryable flag
					if (error instanceof ConflictError && error.retryable) {
						throw error; // Let retry handle it
					}
					// For non-retryable errors, exit immediately
					exit(error);
					throw error; // TypeScript requires this
				}
			}
		);

		return result;
	}

	// Update a pending transaction
	public async updateTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID,
		updates: {
			description?: string;
			metadata?: Record<string, unknown>;
			effectiveAt?: string;
		}
	): Promise<LedgerTransactionEntity> {
		return await this.ledgerTransactionRepo.updateTransaction(
			organizationId,
			ledgerId,
			transactionId,
			updates
		);
	}

	// Post (confirm) a pending transaction
	public async postTransaction(
		organizationId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Promise<LedgerTransactionEntity> {
		return await this.ledgerTransactionRepo.postTransaction(organizationId, ledgerId, transactionId);
	}

	/**
	 * Deletes a transaction with balance updates.
	 * Posted transactions can only be deleted in test environment.
	 *
	 * @throws {ConflictError} If transaction is posted and not in test environment
	 */
	public async deleteTransaction(
		orgId: OrgID,
		ledgerId: LedgerID,
		transactionId: LedgerTransactionID
	): Promise<void> {
		const existing = await this.getLedgerTransaction(orgId, ledgerId, transactionId);

		// Cannot delete posted transactions in production
		if (existing.status === "posted" && process.env.NODE_ENV !== "test") {
			throw new ConflictError({
				message: "Cannot delete a posted transaction outside of test environment",
			});
		}

		await this.ledgerTransactionRepo.deleteTransactionWithBalanceUpdate(
			orgId,
			ledgerId,
			transactionId,
			existing
		);
	}
}

export { LedgerTransactionService };
