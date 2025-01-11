import type { LedgerEntity, LedgerID, OrgID } from "@/services";
import type { DrizzleDB } from "./types";

class LedgerRepo {
	constructor(private readonly db: DrizzleDB) {}

	public async getLedger(orgId: OrgID, id: LedgerID): Promise<LedgerEntity> {
		throw new Error("Not implemented");
	}

	public async listLedgers(
		orgId: OrgID,
		offset: number,
		limit: number,
	): Promise<LedgerEntity[]> {
		throw new Error("Not implemented");
	}

	public async createLedger(
		orgId: OrgID,
		rq: LedgerEntity,
	): Promise<LedgerEntity> {
		throw new Error("Not implemented");
	}

	public async updateLedger(
		orgId: OrgID,
		entity: LedgerEntity,
	): Promise<LedgerEntity> {
		throw new Error("Not implemented");
	}

	public async deleteLedger(orgId: OrgID, id: LedgerID): Promise<void> {
		throw new Error("Not implemented");
	}
}

export { LedgerRepo };
