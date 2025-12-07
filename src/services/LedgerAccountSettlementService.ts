import { ConflictError } from "@/errors";
import type { LedgerAccountSettlementEntity } from "@/repo/entities";
import type { LedgerAccountSettlementID, LedgerID, OrgID } from "@/repo/entities/types";
import type { LedgerAccountSettlementRepo } from "@/repo/LedgerAccountSettlementRepo";
import type { LedgerRepo } from "@/repo/LedgerRepo";
import type { SettlementStatus } from "@/routes/ledgers/schema";

class LedgerAccountSettlementService {
	constructor(
		private readonly ledgerAccountSettlementRepo: LedgerAccountSettlementRepo,
		private readonly ledgerRepo: LedgerRepo
	) {}

	public async listLedgerAccountSettlements(
		orgId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Promise<LedgerAccountSettlementEntity[]> {
		// Verify ledger exists
		await this.ledgerRepo.getLedger(orgId, ledgerId);
		return this.ledgerAccountSettlementRepo.listSettlements(orgId, ledgerId, offset, limit);
	}

	public async getLedgerAccountSettlement(
		orgId: OrgID,
		id: LedgerAccountSettlementID
	): Promise<LedgerAccountSettlementEntity> {
		return this.ledgerAccountSettlementRepo.getSettlement(orgId, id);
	}

	public async createLedgerAccountSettlement(
		entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		// Note: Database foreign keys ensure both accounts exist
		// TODO: Add validation that both accounts belong to the same ledger
		return this.ledgerAccountSettlementRepo.createSettlement(entity);
	}

	public async updateLedgerAccountSettlement(
		orgId: OrgID,
		id: LedgerAccountSettlementID,
		entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		// Verify settlement exists
		await this.ledgerAccountSettlementRepo.getSettlement(orgId, id);
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

		// TODO: For pending → posted transition, create the ledger transaction
		// This will be implemented in a follow-up task

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
			throw new ConflictError({
				message: `Invalid status transition from '${currentStatus}' to '${newStatus}'`,
			});
		}
	}
}

export { LedgerAccountSettlementService };
