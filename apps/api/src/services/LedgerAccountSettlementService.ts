import { TypeID } from "typeid-js";
import { ConflictError } from "@/lib/errors";
import { LedgerAccountSettlementEntity } from "@/repo/entities";
import type {
	LedgerAccountSettlementID,
	LedgerID,
	LedgerTransactionID,
	OrgID,
} from "@/repo/entities/types";
import type { LedgerAccountSettlementRepo } from "@/repo/LedgerAccountSettlementRepo";
import type { NormalBalance, SettlementStatus } from "@/routes/ledgers/schema";

type SettlementTransactionRequest = {
	readonly status: "posted";
	readonly description?: string;
	readonly metadata?: Record<string, string>;
	readonly ledgerEntries: Array<{
		readonly accountId: string;
		readonly direction: "debit" | "credit";
		readonly amount: number;
		readonly metadata?: Record<string, string>;
	}>;
};

interface SettlementTransactionCaller {
	createTransaction(
		orgId: OrgID,
		ledgerId: LedgerID,
		idempotencyKey: string,
		request: SettlementTransactionRequest
	): Promise<{ readonly id: LedgerTransactionID; readonly status: "pending" | "posted" | "voided" }>;
}

interface LedgerAccountSettlementRequest {
	transactionId: string;
	settledAccountId: string;
	contraAccountId: string;
	status: SettlementStatus;
	description?: string;
	externalReference?: string;
	effectiveAtUpperBound?: string;
	metadata?: Record<string, unknown>;
}

class LedgerAccountSettlementService {
	constructor(
		private readonly ledgerAccountSettlementRepo: LedgerAccountSettlementRepo,
		private readonly transactionCaller: SettlementTransactionCaller
	) {}

	public async listLedgerAccountSettlements(
		orgId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Promise<LedgerAccountSettlementEntity[]> {
		return this.ledgerAccountSettlementRepo.listSettlements(orgId, ledgerId, offset, limit);
	}

	public async getLedgerAccountSettlement(
		orgId: OrgID,
		id: LedgerAccountSettlementID
	): Promise<LedgerAccountSettlementEntity> {
		return this.ledgerAccountSettlementRepo.getSettlement(orgId, id);
	}

	public async createLedgerAccountSettlement(
		orgId: OrgID,
		currency: string,
		currencyExponent: number,
		normalBalance: NormalBalance,
		request: LedgerAccountSettlementRequest
	): Promise<LedgerAccountSettlementEntity> {
		// Note: Validation that both accounts belong to the same ledger is done in the route layer
		const entity = LedgerAccountSettlementEntity.fromRequest(
			request,
			orgId,
			currency,
			currencyExponent,
			normalBalance
		);
		return this.ledgerAccountSettlementRepo.createSettlement(entity);
	}

	public async updateLedgerAccountSettlement(
		orgId: OrgID,
		id: string,
		currency: string,
		currencyExponent: number,
		normalBalance: NormalBalance,
		request: LedgerAccountSettlementRequest
	): Promise<LedgerAccountSettlementEntity> {
		const settlementId = TypeID.fromString<"las">(id) as LedgerAccountSettlementID;
		// Verify settlement exists
		await this.ledgerAccountSettlementRepo.getSettlement(orgId, settlementId);
		const entity = LedgerAccountSettlementEntity.fromRequest(
			request,
			orgId,
			currency,
			currencyExponent,
			normalBalance,
			id
		);
		return this.ledgerAccountSettlementRepo.updateSettlement(entity);
	}

	public async deleteLedgerAccountSettlement(
		orgId: OrgID,
		id: LedgerAccountSettlementID
	): Promise<void> {
		return this.ledgerAccountSettlementRepo.deleteSettlement(orgId, id);
	}

	public async addLedgerAccountSettlementEntries(
		orgId: OrgID,
		id: LedgerAccountSettlementID,
		entries: string[]
	): Promise<void> {
		return this.ledgerAccountSettlementRepo.addEntriesToSettlement(orgId, id, entries);
	}

	public async removeLedgerAccountSettlementEntries(
		orgId: OrgID,
		id: LedgerAccountSettlementID,
		entries: string[]
	): Promise<void> {
		return this.ledgerAccountSettlementRepo.removeEntriesFromSettlement(orgId, id, entries);
	}

	public async transitionSettlementStatus(
		orgId: OrgID,
		ledgerId: LedgerID,
		id: LedgerAccountSettlementID,
		targetStatus: SettlementStatus
	): Promise<LedgerAccountSettlementEntity> {
		const settlement = await this.ledgerAccountSettlementRepo.getSettlement(orgId, id);

		// Validate transition
		this.validateStatusTransition(settlement.status, targetStatus);

		// Handle transition-specific logic
		if (targetStatus === "pending" && settlement.status === "processing") {
			// Calculate and update amount
			const amount = await this.ledgerAccountSettlementRepo.calculateAmount(id);
			const updatedSettlement = settlement.withAmount(amount);
			await this.ledgerAccountSettlementRepo.updateSettlement(updatedSettlement);
		}

		// For pending → posted transition, create the ledger transaction
		if (targetStatus === "posted" && settlement.status === "pending") {
			// Create a ledger transaction with two entries:
			// - Debit/Credit the settled account (reduces its balance)
			// - Credit/Debit the contra account (receives the funds)
			const transactionRequest: SettlementTransactionRequest = {
				description: settlement.description ?? `Settlement ${id.toString()}`,
				status: "posted" as const,
				metadata: {
					...settlement.metadata,
					settlementId: id.toString(),
				},
				ledgerEntries: [
					{
						accountId: settlement.settledAccountId.toString(),
						direction: settlement.normalBalance === "debit" ? ("credit" as const) : ("debit" as const),
						amount: settlement.amount,
						metadata: {},
					},
					{
						accountId: settlement.contraAccountId.toString(),
						direction: settlement.normalBalance === "debit" ? ("debit" as const) : ("credit" as const),
						amount: settlement.amount,
						metadata: {},
					},
				],
			};

			const transaction = await this.transactionCaller.createTransaction(
				orgId,
				ledgerId,
				`settlement:${id.toString()}`,
				transactionRequest
			);
			if (transaction.status !== "posted") {
				throw new ConflictError("Settlement Transaction must be Posted");
			}

			// Link the transaction to the settlement
			const updatedSettlement = settlement.withTransactionId(transaction.id);
			await this.ledgerAccountSettlementRepo.updateSettlement(updatedSettlement);
		}

		return this.ledgerAccountSettlementRepo.updateStatus(orgId, id, targetStatus);
	}

	private validateStatusTransition(
		currentStatus: SettlementStatus,
		newStatus: SettlementStatus
	): void {
		const validTransitions: Record<SettlementStatus, SettlementStatus[]> = {
			drafting: ["processing"],
			processing: ["pending", "drafting"],
			pending: ["posted", "drafting"],
			posted: ["archiving"],
			archiving: ["archived"],
			archived: [],
		};

		if (!validTransitions[currentStatus].includes(newStatus)) {
			throw new ConflictError(`Invalid status transition from '${currentStatus}' to '${newStatus}'`);
		}
	}
}

export type { SettlementTransactionCaller, SettlementTransactionRequest };
export { LedgerAccountSettlementService };
