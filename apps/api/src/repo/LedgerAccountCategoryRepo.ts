import { and, desc, eq, getTableColumns } from "drizzle-orm";
// oxlint-disable-next-line boundaries/element-types -- The in-place Category migration reuses shared PostgreSQL error inspection.
import { postgresConstraint, postgresErrorCode } from "@/db/errors";
// oxlint-disable-next-line boundaries/element-types -- The legacy Category repository must expose the canonical Account ownership error.
import { AccountNotFound } from "@/domains/ledgers/accounts/AccountErrors";
// oxlint-disable-next-line boundaries/element-types -- The legacy Category repository must expose the canonical Ledger ownership error.
import { LedgerNotFound } from "@/domains/ledgers/LedgerErrors";
import { LedgerAccountCategoryEntity } from "@/repo/entities/LedgerAccountCategoryEntity";
import type {
	LedgerAccountCategoryID,
	LedgerAccountID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import {
	CategoryConflict,
	CategoryNotFound,
	CategoryPersistenceDecodingFailure,
	mapCategoryInfrastructureError,
} from "./LedgerAccountCategoryErrors";
import {
	LedgerAccountCategoriesTable,
	LedgerAccountCategoryAccountsTable,
	LedgerAccountCategoryParentsTable,
} from "./schema";
import type { DrizzleDB } from "./types";

const decodeCategory = (
	record: Parameters<typeof LedgerAccountCategoryEntity.fromRecord>[0]
): LedgerAccountCategoryEntity => {
	try {
		return LedgerAccountCategoryEntity.fromRecord(record);
	} catch (error) {
		throw new CategoryPersistenceDecodingFailure(error);
	}
};

const isTypedFailure = (cause: unknown) =>
	cause instanceof CategoryNotFound ||
	cause instanceof CategoryConflict ||
	cause instanceof LedgerNotFound ||
	cause instanceof AccountNotFound ||
	cause instanceof CategoryPersistenceDecodingFailure;

const rethrowPersistence = (cause: unknown): never => {
	throw isTypedFailure(cause) ? cause : mapCategoryInfrastructureError(cause);
};

class LedgerAccountCategoryRepo {
	constructor(private readonly db: DrizzleDB) {}

	public async listLedgerAccountCategories(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Promise<LedgerAccountCategoryEntity[]> {
		try {
			const rows = await this.db
				.select(getTableColumns(LedgerAccountCategoriesTable))
				.from(LedgerAccountCategoriesTable)
				.where(
					and(
						eq(LedgerAccountCategoriesTable.organizationId, organizationId.toString()),
						eq(LedgerAccountCategoriesTable.ledgerId, ledgerId.toString())
					)
				)
				.orderBy(desc(LedgerAccountCategoriesTable.created))
				.limit(limit)
				.offset(offset);
			return rows.map(row => decodeCategory(row));
		} catch (error) {
			return rethrowPersistence(error);
		}
	}

	public async getLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Promise<LedgerAccountCategoryEntity> {
		try {
			const rows = await this.db
				.select(getTableColumns(LedgerAccountCategoriesTable))
				.from(LedgerAccountCategoriesTable)
				.where(
					and(
						eq(LedgerAccountCategoriesTable.organizationId, organizationId.toString()),
						eq(LedgerAccountCategoriesTable.ledgerId, ledgerId.toString()),
						eq(LedgerAccountCategoriesTable.id, categoryId.toString())
					)
				)
				.limit(1);
			if (rows.length === 0) {
				throw new CategoryNotFound(`Category not found: ${categoryId.toString()}`);
			}
			return decodeCategory(rows[0]);
		} catch (error) {
			return rethrowPersistence(error);
		}
	}

	public async upsertLedgerAccountCategory(
		entity: LedgerAccountCategoryEntity
	): Promise<LedgerAccountCategoryEntity> {
		try {
			const record = entity.toRecord();
			const rows = await this.db
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
					where: and(
						eq(LedgerAccountCategoriesTable.organizationId, entity.organizationId.toString()),
						eq(LedgerAccountCategoriesTable.ledgerId, entity.ledgerId.toString())
					),
				})
				.returning();
			if (rows.length === 0) {
				throw new CategoryConflict("Category not found or ledgerId mismatch");
			}
			return decodeCategory(rows[0]);
		} catch (error) {
			if (postgresErrorCode(error) === "23503") throw new LedgerNotFound();
			return rethrowPersistence(error);
		}
	}

	public async deleteLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Promise<void> {
		try {
			const rows = await this.db
				.delete(LedgerAccountCategoriesTable)
				.where(
					and(
						eq(LedgerAccountCategoriesTable.organizationId, organizationId.toString()),
						eq(LedgerAccountCategoriesTable.ledgerId, ledgerId.toString()),
						eq(LedgerAccountCategoriesTable.id, categoryId.toString())
					)
				)
				.returning({ id: LedgerAccountCategoriesTable.id });
			if (rows.length === 0) {
				throw new CategoryNotFound(`Category not found: ${categoryId.toString()}`);
			}
		} catch (error) {
			rethrowPersistence(error);
		}
	}

	public async linkAccountToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Promise<void> {
		await this.getLedgerAccountCategory(organizationId, ledgerId, categoryId);
		try {
			await this.db
				.insert(LedgerAccountCategoryAccountsTable)
				.values({
					organizationId: organizationId.toString(),
					ledgerId: ledgerId.toString(),
					categoryId: categoryId.toString(),
					accountId: accountId.toString(),
				})
				.onConflictDoNothing();
		} catch (error) {
			if (postgresErrorCode(error) === "23503") {
				const constraint = postgresConstraint(error);
				if (constraint === "ledger_account_category_accounts_account_ownership_fk") {
					throw new AccountNotFound();
				}
				if (constraint === "ledger_account_category_accounts_category_ownership_fk") {
					throw new CategoryNotFound(`Category not found: ${categoryId.toString()}`);
				}
			}
			rethrowPersistence(error);
		}
	}

	public async unlinkAccountFromCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Promise<void> {
		await this.getLedgerAccountCategory(organizationId, ledgerId, categoryId);
		try {
			const rows = await this.db
				.delete(LedgerAccountCategoryAccountsTable)
				.where(
					and(
						eq(LedgerAccountCategoryAccountsTable.organizationId, organizationId.toString()),
						eq(LedgerAccountCategoryAccountsTable.ledgerId, ledgerId.toString()),
						eq(LedgerAccountCategoryAccountsTable.categoryId, categoryId.toString()),
						eq(LedgerAccountCategoryAccountsTable.accountId, accountId.toString())
					)
				)
				.returning({ categoryId: LedgerAccountCategoryAccountsTable.categoryId });
			if (rows.length === 0) {
				throw new CategoryNotFound(
					`Account ${accountId.toString()} not linked to category ${categoryId.toString()}`
				);
			}
		} catch (error) {
			rethrowPersistence(error);
		}
	}

	public async linkCategoryToParent(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Promise<void> {
		await this.getLedgerAccountCategory(organizationId, ledgerId, categoryId);
		await this.getLedgerAccountCategory(organizationId, ledgerId, parentCategoryId);
		if (categoryId.toString() === parentCategoryId.toString()) {
			throw new CategoryConflict("Category cannot be its own parent");
		}
		try {
			await this.db
				.insert(LedgerAccountCategoryParentsTable)
				.values({
					organizationId: organizationId.toString(),
					ledgerId: ledgerId.toString(),
					categoryId: categoryId.toString(),
					parentCategoryId: parentCategoryId.toString(),
				})
				.onConflictDoNothing();
		} catch (error) {
			if (postgresErrorCode(error) === "23514") {
				throw new CategoryConflict("Category cannot be its own parent");
			}
			if (postgresErrorCode(error) === "23503") {
				const constraint = postgresConstraint(error);
				if (constraint === "ledger_account_category_parents_child_ownership_fk") {
					throw new CategoryNotFound(`Category not found: ${categoryId.toString()}`);
				}
				if (constraint === "ledger_account_category_parents_parent_ownership_fk") {
					throw new CategoryNotFound(`Category not found: ${parentCategoryId.toString()}`);
				}
			}
			rethrowPersistence(error);
		}
	}

	public async unlinkCategoryFromParent(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Promise<void> {
		await this.getLedgerAccountCategory(organizationId, ledgerId, categoryId);
		try {
			const rows = await this.db
				.delete(LedgerAccountCategoryParentsTable)
				.where(
					and(
						eq(LedgerAccountCategoryParentsTable.organizationId, organizationId.toString()),
						eq(LedgerAccountCategoryParentsTable.ledgerId, ledgerId.toString()),
						eq(LedgerAccountCategoryParentsTable.categoryId, categoryId.toString()),
						eq(LedgerAccountCategoryParentsTable.parentCategoryId, parentCategoryId.toString())
					)
				)
				.returning({ categoryId: LedgerAccountCategoryParentsTable.categoryId });
			if (rows.length === 0) {
				throw new CategoryNotFound(
					`Category ${categoryId.toString()} not linked to parent ${parentCategoryId.toString()}`
				);
			}
		} catch (error) {
			rethrowPersistence(error);
		}
	}
}

export { LedgerAccountCategoryRepo };
