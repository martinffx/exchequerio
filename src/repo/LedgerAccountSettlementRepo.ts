import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { ConflictError, NotFoundError } from "@/errors";
import { LedgerAccountSettlementEntity } from "@/repo/entities/LedgerAccountSettlementEntity";
import type { LedgerAccountSettlementID, LedgerID, OrgID } from "@/repo/entities/types";
import type { SettlementStatus } from "@/routes/ledgers/schema";
import { getDBErrorCode, isDBError } from "./errors";
import {
	LedgerAccountSettlementEntriesTable,
	LedgerAccountSettlementsTable,
	LedgerAccountsTable,
	LedgerTransactionEntriesTable,
} from "./schema";
import type { DrizzleDB } from "./types";

/**
 * Repository for ledger account settlement data access operations.
 * Handles Modern Treasury-style settlements with entry attachments.
 */
class LedgerAccountSettlementRepo {
	constructor(private readonly db: DrizzleDB) {}

	/**
	 * Lists all settlements for a ledger with pagination.
	 */
	public async listSettlements(
		orgId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Promise<LedgerAccountSettlementEntity[]> {
		// Join with accounts to filter by ledger
		const results = await this.db
			.select(getTableColumns(LedgerAccountSettlementsTable))
			.from(LedgerAccountSettlementsTable)
			.innerJoin(
				LedgerAccountsTable,
				eq(LedgerAccountSettlementsTable.settledAccountId, LedgerAccountsTable.id)
			)
			.where(
				and(
					eq(LedgerAccountSettlementsTable.organizationId, orgId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			)
			.orderBy(desc(LedgerAccountSettlementsTable.created))
			.limit(limit)
			.offset(offset);

		return results.map(result => LedgerAccountSettlementEntity.fromRecord(result));
	}

	/**
	 * Gets a single settlement by ID.
	 */
	public async getSettlement(
		orgId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Promise<LedgerAccountSettlementEntity> {
		const result = await this.db
			.select(getTableColumns(LedgerAccountSettlementsTable))
			.from(LedgerAccountSettlementsTable)
			.where(
				and(
					eq(LedgerAccountSettlementsTable.id, settlementId.toString()),
					eq(LedgerAccountSettlementsTable.organizationId, orgId.toString())
				)
			)
			.limit(1);

		if (result.length === 0) {
			throw new NotFoundError(`Settlement not found: ${settlementId.toString()}`);
		}

		return LedgerAccountSettlementEntity.fromRecord(result[0]);
	}

	/**
	 * Creates a new settlement.
	 */
	public async createSettlement(
		entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		try {
			const record = entity.toRecord();

			const result = await this.db.insert(LedgerAccountSettlementsTable).values(record).returning();

			return LedgerAccountSettlementEntity.fromRecord(result[0]);
		} catch (error) {
			// PostgreSQL foreign key violation
			if (isDBError(error) && getDBErrorCode(error) === "23503") {
				throw new NotFoundError("Referenced account or organization not found");
			}
			// PostgreSQL check constraint violation (self-settle)
			if (isDBError(error) && getDBErrorCode(error) === "23514") {
				throw new ConflictError({
					message: "Cannot settle an account to itself",
				});
			}
			throw error;
		}
	}

	/**
	 * Updates an existing settlement.
	 * Only works on settlements in drafting status.
	 */
	public async updateSettlement(
		entity: LedgerAccountSettlementEntity
	): Promise<LedgerAccountSettlementEntity> {
		const record = entity.toRecord();

		const result = await this.db
			.update(LedgerAccountSettlementsTable)
			.set({
				...record,
				updated: new Date(),
			})
			.where(
				and(
					eq(LedgerAccountSettlementsTable.id, entity.id.toString()),
					eq(LedgerAccountSettlementsTable.organizationId, entity.organizationId.toString()),
					eq(LedgerAccountSettlementsTable.status, "drafting") // Only update drafting
				)
			)
			.returning();

		if (result.length === 0) {
			throw new ConflictError({
				message: "Settlement not found or not in drafting status",
			});
		}

		return LedgerAccountSettlementEntity.fromRecord(result[0]);
	}

	/**
	 * Deletes a settlement.
	 * Only works on settlements in drafting status.
	 */
	public async deleteSettlement(
		orgId: OrgID,
		settlementId: LedgerAccountSettlementID
	): Promise<void> {
		const result = await this.db
			.delete(LedgerAccountSettlementsTable)
			.where(
				and(
					eq(LedgerAccountSettlementsTable.id, settlementId.toString()),
					eq(LedgerAccountSettlementsTable.organizationId, orgId.toString()),
					eq(LedgerAccountSettlementsTable.status, "drafting") // Only delete drafting
				)
			)
			.returning({ id: LedgerAccountSettlementsTable.id });

		if (result.length === 0) {
			throw new ConflictError({
				message: "Settlement not found or not in drafting status",
			});
		}
	}

	/**
	 * Adds entries to a settlement.
	 * Validates that entries belong to the settled account, are posted, and not already attached.
	 */
	public async addEntriesToSettlement(
		orgId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Promise<void> {
		// Get settlement to verify it exists and is in drafting status
		const settlement = await this.getSettlement(orgId, settlementId);

		if (settlement.status !== "drafting") {
			throw new ConflictError({
				message: "Can only add entries to settlements in drafting status",
			});
		}

		// Validate all entries exist, belong to settled account, and are posted
		for (const entryId of entryIds) {
			const entryCheck = await this.db
				.select({
					id: LedgerTransactionEntriesTable.id,
					accountId: LedgerTransactionEntriesTable.accountId,
					status: LedgerTransactionEntriesTable.status,
				})
				.from(LedgerTransactionEntriesTable)
				.where(
					and(
						eq(LedgerTransactionEntriesTable.id, entryId),
						eq(LedgerTransactionEntriesTable.organizationId, orgId.toString())
					)
				)
				.limit(1);

			if (entryCheck.length === 0) {
				throw new NotFoundError(`Entry not found: ${entryId}`);
			}

			// Verify entry belongs to the settled account
			if (entryCheck[0].accountId !== settlement.settledAccountId.toString()) {
				throw new ConflictError({
					message: `Entry ${entryId} does not belong to the settled account`,
				});
			}

			// Verify entry is posted
			if (entryCheck[0].status !== "posted") {
				throw new ConflictError({
					message: `Entry ${entryId} is not posted (status: ${entryCheck[0].status})`,
				});
			}

			// Check if already attached to another settlement
			const existingAttachment = await this.db
				.select({ settlementId: LedgerAccountSettlementEntriesTable.settlementId })
				.from(LedgerAccountSettlementEntriesTable)
				.where(eq(LedgerAccountSettlementEntriesTable.entryId, entryId))
				.limit(1);

			if (existingAttachment.length > 0) {
				throw new ConflictError({
					message: `Entry ${entryId} is already attached to settlement ${existingAttachment[0].settlementId}`,
				});
			}
		}

		// Insert all entry links
		const inserts = entryIds.map(entryId => ({
			settlementId: settlementId.toString(),
			entryId,
		}));

		await this.db.insert(LedgerAccountSettlementEntriesTable).values(inserts).onConflictDoNothing();
	}

	/**
	 * Removes entries from a settlement.
	 */
	public async removeEntriesFromSettlement(
		orgId: OrgID,
		settlementId: LedgerAccountSettlementID,
		entryIds: string[]
	): Promise<void> {
		// Verify settlement exists and is in drafting status
		const settlement = await this.getSettlement(orgId, settlementId);

		if (settlement.status !== "drafting") {
			throw new ConflictError({
				message: "Can only remove entries from settlements in drafting status",
			});
		}

		// Remove all specified entries
		await this.db
			.delete(LedgerAccountSettlementEntriesTable)
			.where(
				and(
					eq(LedgerAccountSettlementEntriesTable.settlementId, settlementId.toString()),
					inArray(LedgerAccountSettlementEntriesTable.entryId, entryIds)
				)
			);
	}

	/**
	 * Gets all entry IDs attached to a settlement.
	 */
	public async getEntryIds(settlementId: LedgerAccountSettlementID): Promise<string[]> {
		const results = await this.db
			.select({ entryId: LedgerAccountSettlementEntriesTable.entryId })
			.from(LedgerAccountSettlementEntriesTable)
			.where(eq(LedgerAccountSettlementEntriesTable.settlementId, settlementId.toString()));

		return results.map(r => r.entryId);
	}

	/**
	 * Calculates the total amount of all attached entries.
	 * Returns the sum in integer minor units.
	 */
	public async calculateAmount(settlementId: LedgerAccountSettlementID): Promise<number> {
		const result = await this.db
			.select({
				total: sql<string>`COALESCE(SUM(${LedgerTransactionEntriesTable.amount}), 0)`,
			})
			.from(LedgerAccountSettlementEntriesTable)
			.innerJoin(
				LedgerTransactionEntriesTable,
				eq(LedgerAccountSettlementEntriesTable.entryId, LedgerTransactionEntriesTable.id)
			)
			.where(eq(LedgerAccountSettlementEntriesTable.settlementId, settlementId.toString()));

		// PostgreSQL SUM returns string for bigint columns
		return Number.parseInt(result[0]?.total ?? "0", 10);
	}

	/**
	 * Updates settlement status.
	 */
	public async updateStatus(
		orgId: OrgID,
		settlementId: LedgerAccountSettlementID,
		newStatus: SettlementStatus
	): Promise<LedgerAccountSettlementEntity> {
		const result = await this.db
			.update(LedgerAccountSettlementsTable)
			.set({
				status: newStatus,
				updated: new Date(),
			})
			.where(
				and(
					eq(LedgerAccountSettlementsTable.id, settlementId.toString()),
					eq(LedgerAccountSettlementsTable.organizationId, orgId.toString())
				)
			)
			.returning();

		if (result.length === 0) {
			throw new NotFoundError(`Settlement not found: ${settlementId.toString()}`);
		}

		return LedgerAccountSettlementEntity.fromRecord(result[0]);
	}
}

export { LedgerAccountSettlementRepo };
