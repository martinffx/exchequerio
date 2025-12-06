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
		const result = await this.ledgerTransactionRepo.createTransaction(transactionEntity);

		return result;
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
