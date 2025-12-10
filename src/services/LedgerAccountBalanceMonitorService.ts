import { TypeID } from "typeid-js";
import { LedgerAccountBalanceMonitorEntity } from "@/repo/entities";
import type { LedgerAccountBalanceMonitorID } from "@/repo/entities/types";
import type { LedgerAccountBalanceMonitorRepo } from "@/repo/LedgerAccountBalanceMonitorRepo";

type AlertCondition = {
	field: "balance" | "created" | "updated";
	operator: "=" | "<" | ">" | "<=" | ">=" | "!=";
	value: number;
};

interface LedgerAccountBalanceMonitorRequest {
	accountId: string;
	description?: string;
	alertCondition: AlertCondition[];
	metadata?: Record<string, unknown>;
}

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
		request: LedgerAccountBalanceMonitorRequest
	): Promise<LedgerAccountBalanceMonitorEntity> {
		const entity = LedgerAccountBalanceMonitorEntity.fromRequest(request);
		return this.ledgerAccountBalanceMonitorRepo.createMonitor(entity);
	}

	public async updateLedgerAccountBalanceMonitor(
		id: string,
		request: LedgerAccountBalanceMonitorRequest
	): Promise<LedgerAccountBalanceMonitorEntity> {
		const monitorId = TypeID.fromString<"lbm">(id) as LedgerAccountBalanceMonitorID;
		const entity = LedgerAccountBalanceMonitorEntity.fromRequest(request, id);
		return this.ledgerAccountBalanceMonitorRepo.updateMonitor(monitorId, entity);
	}

	public async deleteLedgerAccountBalanceMonitor(id: string): Promise<void> {
		const monitorId = TypeID.fromString<"lbm">(id) as LedgerAccountBalanceMonitorID;
		return this.ledgerAccountBalanceMonitorRepo.deleteMonitor(monitorId);
	}
}

export { LedgerAccountBalanceMonitorService };
