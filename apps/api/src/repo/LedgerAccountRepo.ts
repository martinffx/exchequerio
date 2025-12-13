import { and, desc, eq, getTableColumns, like } from "drizzle-orm";
import { ConflictError, NotFoundError } from "@/errors";
import type { LedgerAccountID, LedgerID } from "@/repo/entities/LedgerAccountEntity";
import { LedgerAccountEntity } from "@/repo/entities/LedgerAccountEntity";
import type { OrgID } from "@/services";
import { getDBErrorCode, isDBError } from "./errors";
import { LedgerAccountsTable, LedgersTable } from "./schema";
import type { DrizzleDB } from "./types";

/**
 * Repository for ledger account data access operations.
 * Handles CRUD operations with organization tenancy, optimistic locking, and FK constraint validation.
 */
class LedgerAccountRepo {
	constructor(private readonly db: DrizzleDB) {}

	/**
	 * Retrieves a single ledger account by ID with organization tenancy validation.
	 *
	 * @param organizationId - Organization ID for tenancy isolation
	 * @param ledgerId - Ledger ID that owns the account
	 * @param accountId - Unique account identifier
	 * @returns The ledger account entity
	 * @throws {NotFoundError} If account not found or doesn't belong to the organization
	 *
	 * @remarks
	 * Uses an inner join with the ledgers table to validate organization ownership in a single query.
	 */
	public async getLedgerAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Promise<LedgerAccountEntity> {
		// Join with LedgersTable to validate organization tenancy
		const result = await this.db
			.select(getTableColumns(LedgerAccountsTable))
			.from(LedgerAccountsTable)
			.innerJoin(LedgersTable, eq(LedgerAccountsTable.ledgerId, LedgersTable.id))
			.where(
				and(
					eq(LedgerAccountsTable.id, accountId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					eq(LedgersTable.organizationId, organizationId.toString())
				)
			)
			.limit(1);

		if (result.length === 0) {
			throw new NotFoundError(`Account not found: ${accountId.toString()}`);
		}

		return LedgerAccountEntity.fromRecord(result[0]);
	}

	/**
	 * Lists all ledger accounts with pagination and optional name filtering.
	 *
	 * @param organizationId - Organization ID for tenancy isolation
	 * @param ledgerId - Ledger ID to list accounts from
	 * @param offset - Number of records to skip for pagination
	 * @param limit - Maximum number of records to return
	 * @param nameFilter - Optional SQL LIKE pattern to filter by account name
	 * @returns Array of ledger account entities
	 * @throws {NotFoundError} If the ledger doesn't exist or doesn't belong to the organization
	 *
	 * @remarks
	 * - Results are ordered by created date (descending)
	 * - Returns empty array if no accounts match the criteria (after validating ledger ownership)
	 * - Uses inner join to validate organization tenancy, with conditional validation on empty results
	 * - Optimized to use single query when results are found, two queries only when empty
	 */
	public async listLedgerAccounts(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number,
		nameFilter?: string
	): Promise<LedgerAccountEntity[]> {
		// Build where conditions with organization tenancy validation via inner join
		const whereConditions = [
			eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
			eq(LedgersTable.organizationId, organizationId.toString()),
		];

		if (nameFilter) {
			whereConditions.push(like(LedgerAccountsTable.name, nameFilter));
		}

		const results = await this.db
			.select(getTableColumns(LedgerAccountsTable))
			.from(LedgerAccountsTable)
			.innerJoin(LedgersTable, eq(LedgerAccountsTable.ledgerId, LedgersTable.id))
			.where(and(...whereConditions))
			.orderBy(desc(LedgerAccountsTable.created))
			.limit(limit)
			.offset(offset);

		// If no results and we're at offset 0 without filters, verify ledger ownership
		// This ensures we throw NotFoundError for invalid ledger access rather than returning empty array
		if (results.length === 0 && offset === 0 && !nameFilter) {
			const ledgerValidation = await this.db
				.select({ id: LedgersTable.id })
				.from(LedgersTable)
				.where(
					and(
						eq(LedgersTable.id, ledgerId.toString()),
						eq(LedgersTable.organizationId, organizationId.toString())
					)
				)
				.limit(1);

			if (ledgerValidation.length === 0) {
				throw new NotFoundError(
					`Ledger not found or does not belong to organization: ${ledgerId.toString()}`
				);
			}
		}

		return results.map(record => LedgerAccountEntity.fromRecord(record));
	}

	/**
	 * Creates a new ledger account or updates an existing one (upsert).
	 *
	 * @param entity - The ledger account entity to create or update
	 * @returns The created or updated ledger account entity with new lock version
	 * @throws {NotFoundError} If the referenced ledger doesn't exist or doesn't belong to the organization
	 * @throws {ConflictError} If optimistic locking fails or immutable fields were changed
	 *
	 * @remarks
	 * **Idempotent Operation:**
	 * - Uses PostgreSQL's ON CONFLICT DO UPDATE for atomic upsert
	 * - Automatically handles both create and update in a single query
	 *
	 * **On INSERT (new account):**
	 * - Validates ledger FK constraint (throws NotFoundError if invalid)
	 * - Initializes with lockVersion from entity.toRecord() (typically 1)
	 *
	 * **On UPDATE (existing account):**
	 * - Validates immutable fields haven't changed (organizationId, ledgerId)
	 * - Enforces optimistic locking via lockVersion check
	 * - Only updates mutable fields: name, description, metadata
	 * - Auto-increments lockVersion and updates timestamp
	 *
	 * **Conflict Handling:**
	 * - Returns 0 rows if WHERE clause fails (wrong lockVersion or immutable field change)
	 * - Throws ConflictError with descriptive message
	 *
	 * @example
	 * ```typescript
	 * // Create new account
	 * const newAccount = LedgerAccountEntity.fromRequest(req, orgId, ledgerId, "debit");
	 * const created = await repo.upsertLedgerAccount(newAccount);
	 *
	 * // Update existing account
	 * const existing = await repo.getLedgerAccount(orgId, ledgerId, accountId);
	 * const updated = await repo.upsertLedgerAccount(existing);
	 * ```
	 */
	public async upsertLedgerAccount(entity: LedgerAccountEntity): Promise<LedgerAccountEntity> {
		try {
			const record = entity.toRecord();
			// toRecord() always increments lockVersion, so record.lockVersion = entity.lockVersion + 1
			// For the WHERE clause, we need to check against the current DB version (before increment)
			const currentLockVersion = (record.lockVersion ?? 1) - 1;

			const result = await this.db
				.insert(LedgerAccountsTable)
				.values(record)
				.onConflictDoUpdate({
					target: LedgerAccountsTable.id,
					set: {
						name: record.name,
						description: record.description,
						metadata: record.metadata,
						lockVersion: record.lockVersion,
						updated: record.updated,
					},
					where: and(
						eq(LedgerAccountsTable.organizationId, entity.organizationId.toString()),
						eq(LedgerAccountsTable.ledgerId, entity.ledgerId.toString()),
						eq(LedgerAccountsTable.lockVersion, currentLockVersion)
					),
				})
				.returning();

			if (result.length === 0) {
				throw new ConflictError({
					message:
						"Account not found, was modified by another transaction, or immutable fields (organizationId/ledgerId) were changed",
				});
			}

			return LedgerAccountEntity.fromRecord(result[0]);
		} catch (error) {
			// PostgreSQL foreign key violation (ledger doesn't exist or doesn't match organization)
			if (isDBError(error) && getDBErrorCode(error) === "23503") {
				throw new NotFoundError(
					`Ledger not found or does not belong to organization: ${entity.ledgerId.toString()}`
				);
			}
			throw error;
		}
	}

	/**
	 * Deletes a ledger account with organization tenancy validation.
	 *
	 * @param organizationId - Organization ID for tenancy isolation
	 * @param ledgerId - Ledger ID that owns the account
	 * @param accountId - Unique account identifier to delete
	 * @throws {NotFoundError} If account not found or doesn't belong to the organization
	 * @throws {ConflictError} If account has dependent transaction entries
	 *
	 * @remarks
	 * **Safety Mechanisms:**
	 * - Validates organizationId, ledgerId, and accountId in WHERE clause (single query)
	 * - Database FK constraints prevent deletion if transaction entries exist
	 * - No manual dependency checks needed - DB enforces referential integrity
	 *
	 * **Error Handling:**
	 * - PostgreSQL FK violation (error code 23503) is caught and translated to ConflictError
	 * - Provides user-friendly error message about existing transaction entries
	 *
	 * @example
	 * ```typescript
	 * try {
	 *   await repo.deleteLedgerAccount(orgId, ledgerId, accountId);
	 * } catch (error) {
	 *   if (error instanceof ConflictError) {
	 *     // Account has transaction entries, cannot delete
	 *   }
	 * }
	 * ```
	 */
	public async deleteLedgerAccount(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Promise<void> {
		try {
			const deleteResult = await this.db
				.delete(LedgerAccountsTable)
				.where(
					and(
						eq(LedgerAccountsTable.id, accountId.toString()),
						eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
						eq(LedgerAccountsTable.organizationId, organizationId.toString())
					)
				)
				.returning({ id: LedgerAccountsTable.id });

			if (deleteResult.length === 0) {
				throw new NotFoundError(`Account not found: ${accountId.toString()}`);
			}
		} catch (error) {
			// PostgreSQL foreign key violation (account has dependent transaction entries)
			if (isDBError(error) && getDBErrorCode(error) === "23503") {
				throw new ConflictError({ message: "Cannot delete account with existing transaction entries" });
			}
			throw error;
		}
	}
}

export { LedgerAccountRepo };
