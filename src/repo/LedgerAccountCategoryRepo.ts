import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { ConflictError, NotFoundError } from "@/errors";
import { LedgerAccountCategoryEntity } from "@/repo/entities/LedgerAccountCategoryEntity";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID } from "@/repo/entities/types";
import { getDBErrorCode, isDBError } from "./errors";
import {
	LedgerAccountCategoriesTable,
	LedgerAccountCategoryAccountsTable,
	LedgerAccountCategoryParentsTable,
} from "./schema";
import type { DrizzleDB } from "./types";

/**
 * Repository for ledger account category data access operations.
 * Handles CRUD operations with ledger tenancy and many-to-many relationships.
 */
class LedgerAccountCategoryRepo {
	constructor(private readonly db: DrizzleDB) {}

	/**
	 * Lists all ledger account categories for a specific ledger with pagination.
	 *
	 * @param ledgerId - Ledger ID to list categories from
	 * @param offset - Number of records to skip for pagination
	 * @param limit - Maximum number of records to return
	 * @returns Array of ledger account category entities
	 */
	public async listLedgerAccountCategories(
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Promise<LedgerAccountCategoryEntity[]> {
		const results = await this.db
			.select(getTableColumns(LedgerAccountCategoriesTable))
			.from(LedgerAccountCategoriesTable)
			.where(eq(LedgerAccountCategoriesTable.ledgerId, ledgerId.toString()))
			.orderBy(desc(LedgerAccountCategoriesTable.created))
			.limit(limit)
			.offset(offset);

		return results.map(record => LedgerAccountCategoryEntity.fromRecord(record));
	}

	/**
	 * Retrieves a single ledger account category by ID with ledger validation.
	 *
	 * @param ledgerId - Ledger ID for tenancy validation
	 * @param categoryId - Unique category identifier
	 * @returns The ledger account category entity
	 * @throws {NotFoundError} If category not found or doesn't belong to the ledger
	 */
	public async getLedgerAccountCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Promise<LedgerAccountCategoryEntity> {
		const result = await this.db
			.select(getTableColumns(LedgerAccountCategoriesTable))
			.from(LedgerAccountCategoriesTable)
			.where(
				and(
					eq(LedgerAccountCategoriesTable.id, categoryId.toString()),
					eq(LedgerAccountCategoriesTable.ledgerId, ledgerId.toString())
				)
			)
			.limit(1);

		if (result.length === 0) {
			throw new NotFoundError(`Category not found: ${categoryId.toString()}`);
		}

		return LedgerAccountCategoryEntity.fromRecord(result[0]);
	}

	/**
	 * Creates a new ledger account category or updates an existing one (upsert).
	 *
	 * @param entity - The ledger account category entity to create or update
	 * @returns The created or updated ledger account category entity
	 * @throws {NotFoundError} If the referenced ledger doesn't exist
	 * @throws {ConflictError} If immutable fields were changed
	 */
	public async upsertLedgerAccountCategory(
		entity: LedgerAccountCategoryEntity
	): Promise<LedgerAccountCategoryEntity> {
		try {
			const record = entity.toRecord();

			const result = await this.db
				.insert(LedgerAccountCategoriesTable)
				.values(record)
				.onConflictDoUpdate({
					target: LedgerAccountCategoriesTable.id,
					set: {
						name: record.name,
						description: record.description,
						normalBalance: record.normalBalance,
						metadata: record.metadata,
						updated: record.updated,
					},
					where: eq(LedgerAccountCategoriesTable.ledgerId, entity.ledgerId.toString()),
				})
				.returning();

			if (result.length === 0) {
				throw new ConflictError({ message: "Category not found or ledgerId mismatch" });
			}

			return LedgerAccountCategoryEntity.fromRecord(result[0]);
		} catch (error) {
			// PostgreSQL foreign key violation (ledger doesn't exist)
			if (isDBError(error) && getDBErrorCode(error) === "23503") {
				throw new NotFoundError(`Ledger not found: ${entity.ledgerId.toString()}`);
			}
			throw error;
		}
	}

	/**
	 * Deletes a ledger account category with ledger validation.
	 *
	 * @param ledgerId - Ledger ID for tenancy validation
	 * @param categoryId - Unique category identifier to delete
	 * @throws {NotFoundError} If category not found or doesn't belong to the ledger
	 *
	 * @remarks
	 * - CASCADE deletes on junction tables handle cleanup of parent/account relationships
	 * - No manual dependency checks needed - DB enforces referential integrity
	 */
	public async deleteLedgerAccountCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Promise<void> {
		const deleteResult = await this.db
			.delete(LedgerAccountCategoriesTable)
			.where(
				and(
					eq(LedgerAccountCategoriesTable.id, categoryId.toString()),
					eq(LedgerAccountCategoriesTable.ledgerId, ledgerId.toString())
				)
			)
			.returning({ id: LedgerAccountCategoriesTable.id });

		if (deleteResult.length === 0) {
			throw new NotFoundError(`Category not found: ${categoryId.toString()}`);
		}
	}

	/**
	 * Links an account to a category (many-to-many).
	 *
	 * @param ledgerId - Ledger ID for tenancy validation
	 * @param categoryId - Category to link to
	 * @param accountId - Account to link
	 * @throws {NotFoundError} If category or account doesn't exist
	 *
	 * @remarks
	 * - Uses onConflictDoNothing for idempotent operation
	 * - Verifies category exists and belongs to ledger first
	 */
	public async linkAccountToCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Promise<void> {
		// Verify category exists and belongs to ledger
		await this.getLedgerAccountCategory(ledgerId, categoryId);

		try {
			await this.db
				.insert(LedgerAccountCategoryAccountsTable)
				.values({
					categoryId: categoryId.toString(),
					accountId: accountId.toString(),
				})
				.onConflictDoNothing();
		} catch (error) {
			// PostgreSQL foreign key violation (account doesn't exist)
			if (isDBError(error) && getDBErrorCode(error) === "23503") {
				throw new NotFoundError(`Account not found: ${accountId.toString()}`);
			}
			throw error;
		}
	}

	/**
	 * Unlinks an account from a category.
	 *
	 * @param ledgerId - Ledger ID for tenancy validation
	 * @param categoryId - Category to unlink from
	 * @param accountId - Account to unlink
	 * @throws {NotFoundError} If category doesn't exist or account not linked to category
	 */
	public async unlinkAccountFromCategory(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Promise<void> {
		// Verify category exists and belongs to ledger
		await this.getLedgerAccountCategory(ledgerId, categoryId);

		const result = await this.db
			.delete(LedgerAccountCategoryAccountsTable)
			.where(
				and(
					eq(LedgerAccountCategoryAccountsTable.categoryId, categoryId.toString()),
					eq(LedgerAccountCategoryAccountsTable.accountId, accountId.toString())
				)
			)
			.returning({ categoryId: LedgerAccountCategoryAccountsTable.categoryId });

		if (result.length === 0) {
			throw new NotFoundError(
				`Account ${accountId.toString()} not linked to category ${categoryId.toString()}`
			);
		}
	}

	/**
	 * Links a category to a parent category (many-to-many hierarchy).
	 *
	 * @param ledgerId - Ledger ID for tenancy validation
	 * @param categoryId - Child category to link
	 * @param parentCategoryId - Parent category to link to
	 * @throws {NotFoundError} If either category doesn't exist
	 * @throws {ConflictError} If attempting self-reference
	 *
	 * @remarks
	 * - Prevents self-reference via DB CHECK constraint
	 * - Verifies both categories exist and belong to same ledger
	 * - Uses onConflictDoNothing for idempotent operation
	 */
	public async linkCategoryToParent(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Promise<void> {
		// Verify both categories exist and belong to same ledger
		await this.getLedgerAccountCategory(ledgerId, categoryId);
		await this.getLedgerAccountCategory(ledgerId, parentCategoryId);

		// Prevent self-reference
		if (categoryId.toString() === parentCategoryId.toString()) {
			throw new ConflictError({ message: "Category cannot be its own parent" });
		}

		try {
			await this.db
				.insert(LedgerAccountCategoryParentsTable)
				.values({
					categoryId: categoryId.toString(),
					parentCategoryId: parentCategoryId.toString(),
				})
				.onConflictDoNothing();
		} catch (error) {
			// PostgreSQL CHECK constraint violation (self-reference)
			if (error instanceof Error && "code" in error && error.code === "23514") {
				throw new ConflictError({ message: "Category cannot be its own parent" });
			}
			throw error;
		}
	}

	/**
	 * Unlinks a category from a parent category.
	 *
	 * @param ledgerId - Ledger ID for tenancy validation
	 * @param categoryId - Child category to unlink
	 * @param parentCategoryId - Parent category to unlink from
	 * @throws {NotFoundError} If category doesn't exist or not linked to parent
	 */
	public async unlinkCategoryFromParent(
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Promise<void> {
		// Verify category exists and belongs to ledger
		await this.getLedgerAccountCategory(ledgerId, categoryId);

		const result = await this.db
			.delete(LedgerAccountCategoryParentsTable)
			.where(
				and(
					eq(LedgerAccountCategoryParentsTable.categoryId, categoryId.toString()),
					eq(LedgerAccountCategoryParentsTable.parentCategoryId, parentCategoryId.toString())
				)
			)
			.returning({ categoryId: LedgerAccountCategoryParentsTable.categoryId });

		if (result.length === 0) {
			throw new NotFoundError(
				`Category ${categoryId.toString()} not linked to parent ${parentCategoryId.toString()}`
			);
		}
	}
}

export { LedgerAccountCategoryRepo };
