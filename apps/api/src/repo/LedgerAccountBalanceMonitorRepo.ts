import { desc, eq } from "drizzle-orm";
import { NotFoundError } from "@/errors";
import { LedgerAccountBalanceMonitorEntity } from "@/repo/entities/LedgerAccountBalanceMonitorEntity";
import type { LedgerAccountBalanceMonitorID } from "@/repo/entities/types";
import { LedgerAccountBalanceMonitorsTable } from "./schema";
import type { DrizzleDB } from "./types";

/**
 * Repository for ledger account balance monitor data access operations.
 * Handles CRUD operations for balance monitoring and alerts.
 */
class LedgerAccountBalanceMonitorRepo {
	constructor(private readonly db: DrizzleDB) {}

	/**
	 * Lists all balance monitors with pagination.
	 */
	public async listMonitors(
		offset: number,
		limit: number
	): Promise<LedgerAccountBalanceMonitorEntity[]> {
		const results = await this.db
			.select()
			.from(LedgerAccountBalanceMonitorsTable)
			.orderBy(desc(LedgerAccountBalanceMonitorsTable.created))
			.limit(limit)
			.offset(offset);

		return results.map(record => LedgerAccountBalanceMonitorEntity.fromRecord(record));
	}

	/**
	 * Retrieves a single balance monitor by ID.
	 */
	public async getMonitor(
		id: LedgerAccountBalanceMonitorID
	): Promise<LedgerAccountBalanceMonitorEntity> {
		const result = await this.db
			.select()
			.from(LedgerAccountBalanceMonitorsTable)
			.where(eq(LedgerAccountBalanceMonitorsTable.id, id.toString()))
			.limit(1);

		if (result.length === 0) {
			throw new NotFoundError(`Balance monitor not found: ${id.toString()}`);
		}

		return LedgerAccountBalanceMonitorEntity.fromRecord(result[0]);
	}

	/**
	 * Creates a new balance monitor.
	 */
	public async createMonitor(
		entity: LedgerAccountBalanceMonitorEntity
	): Promise<LedgerAccountBalanceMonitorEntity> {
		const record = entity.toRecord();

		const result = await this.db.insert(LedgerAccountBalanceMonitorsTable).values(record).returning();

		return LedgerAccountBalanceMonitorEntity.fromRecord(result[0]);
	}

	/**
	 * Updates an existing balance monitor.
	 */
	public async updateMonitor(
		id: LedgerAccountBalanceMonitorID,
		entity: LedgerAccountBalanceMonitorEntity
	): Promise<LedgerAccountBalanceMonitorEntity> {
		const record = entity.toRecord();

		const result = await this.db
			.update(LedgerAccountBalanceMonitorsTable)
			.set({
				...record,
				updated: new Date(),
			})
			.where(eq(LedgerAccountBalanceMonitorsTable.id, id.toString()))
			.returning();

		if (result.length === 0) {
			throw new NotFoundError(`Balance monitor not found: ${id.toString()}`);
		}

		return LedgerAccountBalanceMonitorEntity.fromRecord(result[0]);
	}

	/**
	 * Deletes a balance monitor.
	 */
	public async deleteMonitor(id: LedgerAccountBalanceMonitorID): Promise<void> {
		const result = await this.db
			.delete(LedgerAccountBalanceMonitorsTable)
			.where(eq(LedgerAccountBalanceMonitorsTable.id, id.toString()))
			.returning({ id: LedgerAccountBalanceMonitorsTable.id });

		if (result.length === 0) {
			throw new NotFoundError(`Balance monitor not found: ${id.toString()}`);
		}
	}
}

export { LedgerAccountBalanceMonitorRepo };
