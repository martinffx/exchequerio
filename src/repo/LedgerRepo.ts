import { and, desc, eq } from "drizzle-orm";
import { ConflictError, NotFoundError } from "@/errors";
import type { LedgerID, OrgID } from "@/services";
import { LedgerEntity } from "@/services";
import { getDBErrorCode, isDBError } from "./errors";
import { LedgersTable } from "./schema";
import type { DrizzleDB } from "./types";

/**
 * Repository for ledger data access operations.
 * Handles CRUD operations with organization tenancy and FK constraint validation.
 */
class LedgerRepo {
	constructor(private readonly db: DrizzleDB) {}

	/**
	 * Retrieves a single ledger by ID with organization tenancy validation.
	 *
	 * @param orgId - Organization ID for tenancy isolation
	 * @param id - Unique ledger identifier
	 * @returns The ledger entity
	 * @throws {NotFoundError} If ledger not found or doesn't belong to the organization
	 */
	public async getLedger(orgId: OrgID, id: LedgerID): Promise<LedgerEntity> {
		const result = await this.db
			.select()
			.from(LedgersTable)
			.where(
				and(eq(LedgersTable.id, id.toString()), eq(LedgersTable.organizationId, orgId.toString()))
			)
			.limit(1);

		if (result.length === 0) {
			throw new NotFoundError(`Ledger not found: ${id.toString()}`);
		}

		return LedgerEntity.fromRecord(result[0]);
	}

	/**
	 * Lists all ledgers for an organization with pagination.
	 *
	 * @param orgId - Organization ID for tenancy isolation
	 * @param offset - Number of records to skip for pagination
	 * @param limit - Maximum number of records to return
	 * @returns Array of ledger entities
	 *
	 * @remarks
	 * - Results are ordered by created date (descending)
	 * - Returns empty array if no ledgers match the criteria
	 */
	public async listLedgers(orgId: OrgID, offset: number, limit: number): Promise<LedgerEntity[]> {
		const results = await this.db
			.select()
			.from(LedgersTable)
			.where(eq(LedgersTable.organizationId, orgId.toString()))
			.orderBy(desc(LedgersTable.created))
			.limit(limit)
			.offset(offset);

		return results.map(row => LedgerEntity.fromRecord(row));
	}

	/**
	 * Creates a new ledger or updates an existing one (upsert).
	 *
	 * @param entity - The ledger entity to create or update
	 * @returns The created or updated ledger entity
	 * @throws {NotFoundError} If the referenced organization doesn't exist
	 * @throws {ConflictError} If immutable fields were changed
	 *
	 * @remarks
	 * **Idempotent Operation:**
	 * - Uses PostgreSQL's ON CONFLICT DO UPDATE for atomic upsert
	 * - Automatically handles both create and update in a single query
	 *
	 * **On INSERT (new ledger):**
	 * - Validates organization FK constraint (throws NotFoundError if invalid)
	 *
	 * **On UPDATE (existing ledger):**
	 * - Validates immutable fields haven't changed (organizationId, currency, currencyExponent)
	 * - Only updates mutable fields: name, description, metadata
	 * - Auto-updates timestamp
	 *
	 * **Conflict Handling:**
	 * - Returns 0 rows if WHERE clause fails (immutable field change)
	 * - Throws ConflictError with descriptive message
	 *
	 * @example
	 * ```typescript
	 * // Create new ledger
	 * const newLedger = LedgerEntity.fromRequest(req, orgId);
	 * const created = await repo.upsertLedger(newLedger);
	 *
	 * // Update existing ledger
	 * const existing = await repo.getLedger(orgId, ledgerId);
	 * const updated = await repo.upsertLedger(existing);
	 * ```
	 */
	public async upsertLedger(entity: LedgerEntity): Promise<LedgerEntity> {
		try {
			const record = entity.toRecord();

			const result = await this.db
				.insert(LedgersTable)
				.values(record)
				.onConflictDoUpdate({
					target: LedgersTable.id,
					set: {
						name: record.name,
						description: record.description,
						metadata: record.metadata,
						updated: record.updated,
					},
					where: and(
						eq(LedgersTable.organizationId, entity.organizationId.toString()),
						eq(LedgersTable.currency, entity.currency),
						eq(LedgersTable.currencyExponent, entity.currencyExponent)
					),
				})
				.returning();

			if (result.length === 0) {
				throw new ConflictError({
					message:
						"Ledger not found or immutable fields (organizationId, currency, currencyExponent) were changed",
				});
			}

			return LedgerEntity.fromRecord(result[0]);
		} catch (error) {
			// PostgreSQL foreign key violation (organization doesn't exist)
			if (isDBError(error) && getDBErrorCode(error) === "23503") {
				throw new NotFoundError(`Organization not found: ${entity.organizationId.toString()}`);
			}
			throw error;
		}
	}

	/**
	 * Deletes a ledger with organization tenancy validation.
	 *
	 * @param orgId - Organization ID for tenancy isolation
	 * @param id - Unique ledger identifier to delete
	 * @throws {NotFoundError} If ledger not found or doesn't belong to the organization
	 * @throws {ConflictError} If ledger has dependent accounts
	 *
	 * @remarks
	 * **Safety Mechanisms:**
	 * - Validates organizationId and ledgerId in WHERE clause (single query)
	 * - Database FK constraints prevent deletion if accounts exist
	 * - No manual dependency checks needed - DB enforces referential integrity
	 *
	 * **Error Handling:**
	 * - PostgreSQL FK violation (error code 23503) is caught and translated to ConflictError
	 * - Provides user-friendly error message about existing accounts
	 *
	 * @example
	 * ```typescript
	 * try {
	 *   await repo.deleteLedger(orgId, ledgerId);
	 * } catch (error) {
	 *   if (error instanceof ConflictError) {
	 *     // Ledger has accounts, cannot delete
	 *   }
	 * }
	 * ```
	 */
	public async deleteLedger(orgId: OrgID, id: LedgerID): Promise<void> {
		try {
			const deleteResult = await this.db
				.delete(LedgersTable)
				.where(
					and(eq(LedgersTable.id, id.toString()), eq(LedgersTable.organizationId, orgId.toString()))
				)
				.returning({ id: LedgersTable.id });

			if (deleteResult.length === 0) {
				throw new NotFoundError(`Ledger not found: ${id.toString()}`);
			}
		} catch (error) {
			// PostgreSQL foreign key violation (ledger has dependent accounts)
			if (isDBError(error) && getDBErrorCode(error) === "23503") {
				throw new ConflictError({ message: "Cannot delete ledger with existing accounts" });
			}
			throw error;
		}
	}
}

export { LedgerRepo };
