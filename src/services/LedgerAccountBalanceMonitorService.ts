import { TypeID } from "typeid-js";
import type { LedgerAccountBalanceMonitorEntity } from "@/repo/entities";
import type { LedgerAccountBalanceMonitorID } from "@/repo/entities/types";
import type { LedgerAccountBalanceMonitorRepo } from "@/repo/LedgerAccountBalanceMonitorRepo";

class LedgerAccountBalanceMonitorService {
	constructor(private readonly ledgerAccountBalanceMonitorRepo: LedgerAccountBalanceMonitorRepo) {}

	public async listLedgerAccountBalanceMonitors(
		offset: number,
		limit: number
	): Promise<LedgerAccountBalanceMonitorEntity[]> {
		return this.ledgerAccountBalanceMonitorRepo.listMonitors(offset, limit);
	}

	public async getLedgerAccountBalanceMonitor(
		id: string
	): Promise<LedgerAccountBalanceMonitorEntity> {
		const monitorId = TypeID.fromString<"lbm">(id) as LedgerAccountBalanceMonitorID;
		return this.ledgerAccountBalanceMonitorRepo.getMonitor(monitorId);
	}

	public async createLedgerAccountBalanceMonitor(
		entity: LedgerAccountBalanceMonitorEntity
	): Promise<LedgerAccountBalanceMonitorEntity> {
		return this.ledgerAccountBalanceMonitorRepo.createMonitor(entity);
	}

	public async updateLedgerAccountBalanceMonitor(
		id: string,
		entity: LedgerAccountBalanceMonitorEntity
	): Promise<LedgerAccountBalanceMonitorEntity> {
		const monitorId = TypeID.fromString<"lbm">(id) as LedgerAccountBalanceMonitorID;
		return this.ledgerAccountBalanceMonitorRepo.updateMonitor(monitorId, entity);
	}

	public async deleteLedgerAccountBalanceMonitor(id: string): Promise<void> {
		const monitorId = TypeID.fromString<"lbm">(id) as LedgerAccountBalanceMonitorID;
		return this.ledgerAccountBalanceMonitorRepo.deleteMonitor(monitorId);
	}
}

export { LedgerAccountBalanceMonitorService };
