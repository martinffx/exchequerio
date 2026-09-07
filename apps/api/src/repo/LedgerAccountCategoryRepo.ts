import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
// oxlint-disable-next-line boundaries/element-types -- The in-place migration uses the shared Effect database.
import { DatabaseTag, type EffectDrizzleDatabase, postgresErrorCode } from "@/db";
// oxlint-disable-next-line boundaries/element-types -- The in-place migration reuses shared PostgreSQL constraint inspection.
import { postgresConstraint } from "@/db/errors";
// oxlint-disable-next-line boundaries/element-types -- Relationship persistence exposes canonical ownership errors.
import { AccountNotFound } from "@/domains/ledgers/accounts/AccountErrors";
// oxlint-disable-next-line boundaries/element-types -- Category persistence exposes the canonical Ledger ownership error.
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
	type CategoryInfrastructureError,
	CategoryNotFound,
	CategoryPersistenceDecodingFailure,
	mapCategoryInfrastructureError,
} from "./LedgerAccountCategoryErrors";
import {
	LedgerAccountCategoriesTable,
	LedgerAccountCategoryAccountsTable,
	LedgerAccountCategoryParentsTable,
} from "./schema";

type CategoryListRepositoryError = CategoryInfrastructureError;
type CategoryGetRepositoryError = CategoryNotFound | CategoryInfrastructureError;
type CategoryUpsertRepositoryError =
	| LedgerNotFound
	| CategoryConflict
	| CategoryInfrastructureError;
type CategoryDeleteRepositoryError = CategoryNotFound | CategoryInfrastructureError;
type CategoryLinkAccountRepositoryError =
	| CategoryNotFound
	| AccountNotFound
	| CategoryInfrastructureError;
type CategoryUnlinkAccountRepositoryError = CategoryNotFound | CategoryInfrastructureError;
type CategoryLinkParentRepositoryError =
	| CategoryNotFound
	| CategoryConflict
	| CategoryInfrastructureError;
type CategoryUnlinkParentRepositoryError = CategoryNotFound | CategoryInfrastructureError;

interface LedgerAccountCategoryRepo {
	listLedgerAccountCategories(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Effect.Effect<LedgerAccountCategoryEntity[], CategoryListRepositoryError>;
	getLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Effect.Effect<LedgerAccountCategoryEntity, CategoryGetRepositoryError>;
	upsertLedgerAccountCategory(
		entity: LedgerAccountCategoryEntity
	): Effect.Effect<LedgerAccountCategoryEntity, CategoryUpsertRepositoryError>;
	deleteLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Effect.Effect<void, CategoryDeleteRepositoryError>;
	linkAccountToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Effect.Effect<void, CategoryLinkAccountRepositoryError>;
	unlinkAccountFromCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Effect.Effect<void, CategoryUnlinkAccountRepositoryError>;
	linkCategoryToParent(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Effect.Effect<void, CategoryLinkParentRepositoryError>;
	unlinkCategoryFromParent(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Effect.Effect<void, CategoryUnlinkParentRepositoryError>;
}

const LedgerAccountCategoryRepoTag = Context.Service<LedgerAccountCategoryRepo>(
	"LedgerAccountCategoryRepo"
);
const decodeCategory = (
	record: Parameters<typeof LedgerAccountCategoryEntity.fromRecord>[0]
): Effect.Effect<LedgerAccountCategoryEntity, CategoryPersistenceDecodingFailure> =>
	Effect.try({
		try: () => LedgerAccountCategoryEntity.fromRecord(record),
		catch: cause => new CategoryPersistenceDecodingFailure(cause),
	});
const requireCategory = (
	rows: Parameters<typeof decodeCategory>[0][],
	categoryId: LedgerAccountCategoryID
): Effect.Effect<
	LedgerAccountCategoryEntity,
	CategoryNotFound | CategoryPersistenceDecodingFailure
> => {
	if (rows.length === 0)
		return Effect.fail(new CategoryNotFound(`Category not found: ${categoryId.toString()}`));
	return decodeCategory(rows[0]);
};
const requireUpsertedCategory = (
	rows: Parameters<typeof decodeCategory>[0][]
): Effect.Effect<
	LedgerAccountCategoryEntity,
	CategoryConflict | CategoryPersistenceDecodingFailure
> => {
	if (rows.length === 0)
		return Effect.fail(new CategoryConflict("Category not found or ledgerId mismatch"));
	return decodeCategory(rows[0]);
};

class LedgerAccountCategoryRepoLive implements LedgerAccountCategoryRepo {
	constructor(private readonly db: EffectDrizzleDatabase) {}

	listLedgerAccountCategories(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Effect.Effect<LedgerAccountCategoryEntity[], CategoryListRepositoryError> {
		return this.db
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
			.offset(offset)
			.pipe(
				Effect.flatMap(rows => Effect.all(rows.map(row => decodeCategory(row)))),
				Effect.mapError(mapCategoryInfrastructureError)
			);
	}

	getLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Effect.Effect<LedgerAccountCategoryEntity, CategoryGetRepositoryError> {
		return this.db
			.select(getTableColumns(LedgerAccountCategoriesTable))
			.from(LedgerAccountCategoriesTable)
			.where(
				and(
					eq(LedgerAccountCategoriesTable.organizationId, organizationId.toString()),
					eq(LedgerAccountCategoriesTable.ledgerId, ledgerId.toString()),
					eq(LedgerAccountCategoriesTable.id, categoryId.toString())
				)
			)
			.limit(1)
			.pipe(
				Effect.mapError(mapCategoryInfrastructureError),
				Effect.flatMap(rows => requireCategory(rows, categoryId))
			);
	}

	upsertLedgerAccountCategory(
		entity: LedgerAccountCategoryEntity
	): Effect.Effect<LedgerAccountCategoryEntity, CategoryUpsertRepositoryError> {
		return Effect.try({
			try: () => entity.toRecord(),
			catch: mapCategoryInfrastructureError,
		}).pipe(
			Effect.flatMap(record =>
				this.db
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
					.returning()
					.pipe(
						Effect.mapError(cause =>
							postgresErrorCode(cause) === "23503"
								? new LedgerNotFound({ cause })
								: mapCategoryInfrastructureError(cause)
						),
						Effect.flatMap(requireUpsertedCategory)
					)
			)
		);
	}

	deleteLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Effect.Effect<void, CategoryDeleteRepositoryError> {
		return this.db
			.delete(LedgerAccountCategoriesTable)
			.where(
				and(
					eq(LedgerAccountCategoriesTable.organizationId, organizationId.toString()),
					eq(LedgerAccountCategoriesTable.ledgerId, ledgerId.toString()),
					eq(LedgerAccountCategoriesTable.id, categoryId.toString())
				)
			)
			.returning({ id: LedgerAccountCategoriesTable.id })
			.pipe(
				Effect.mapError(mapCategoryInfrastructureError),
				Effect.flatMap(rows =>
					rows.length === 0
						? Effect.fail(new CategoryNotFound(`Category not found: ${categoryId.toString()}`))
						: Effect.void
				)
			);
	}

	linkAccountToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Effect.Effect<void, CategoryLinkAccountRepositoryError> {
		return this.getLedgerAccountCategory(organizationId, ledgerId, categoryId).pipe(
			Effect.andThen(
				this.db
					.insert(LedgerAccountCategoryAccountsTable)
					.values({
						organizationId: organizationId.toString(),
						ledgerId: ledgerId.toString(),
						categoryId: categoryId.toString(),
						accountId: accountId.toString(),
					})
					.onConflictDoNothing()
					.pipe(
						Effect.mapError(cause => {
							if (postgresErrorCode(cause) === "23503") {
								const constraint = postgresConstraint(cause);
								if (constraint === "ledger_account_category_accounts_account_ownership_fk")
									return new AccountNotFound({ cause });
								if (constraint === "ledger_account_category_accounts_category_ownership_fk")
									return new CategoryNotFound(`Category not found: ${categoryId.toString()}`, { cause });
							}
							return mapCategoryInfrastructureError(cause);
						})
					)
			),
			Effect.asVoid
		);
	}

	unlinkAccountFromCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Effect.Effect<void, CategoryUnlinkAccountRepositoryError> {
		return this.getLedgerAccountCategory(organizationId, ledgerId, categoryId).pipe(
			Effect.andThen(
				this.db
					.delete(LedgerAccountCategoryAccountsTable)
					.where(
						and(
							eq(LedgerAccountCategoryAccountsTable.organizationId, organizationId.toString()),
							eq(LedgerAccountCategoryAccountsTable.ledgerId, ledgerId.toString()),
							eq(LedgerAccountCategoryAccountsTable.categoryId, categoryId.toString()),
							eq(LedgerAccountCategoryAccountsTable.accountId, accountId.toString())
						)
					)
					.returning({ categoryId: LedgerAccountCategoryAccountsTable.categoryId })
					.pipe(Effect.mapError(mapCategoryInfrastructureError))
			),
			Effect.flatMap(rows =>
				rows.length === 0
					? Effect.fail(
							new CategoryNotFound(
								`Account ${accountId.toString()} not linked to category ${categoryId.toString()}`
							)
						)
					: Effect.void
			)
		);
	}

	linkCategoryToParent(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Effect.Effect<void, CategoryLinkParentRepositoryError> {
		return Effect.gen({ self: this }, function* () {
			yield* this.getLedgerAccountCategory(organizationId, ledgerId, categoryId);
			yield* this.getLedgerAccountCategory(organizationId, ledgerId, parentCategoryId);
			if (categoryId.toString() === parentCategoryId.toString())
				return yield* Effect.fail(new CategoryConflict("Category cannot be its own parent"));
			yield* this.db
				.insert(LedgerAccountCategoryParentsTable)
				.values({
					organizationId: organizationId.toString(),
					ledgerId: ledgerId.toString(),
					categoryId: categoryId.toString(),
					parentCategoryId: parentCategoryId.toString(),
				})
				.onConflictDoNothing()
				.pipe(
					Effect.mapError(cause => {
						if (postgresErrorCode(cause) === "23514")
							return new CategoryConflict("Category cannot be its own parent", { cause });
						if (postgresErrorCode(cause) === "23503") {
							const constraint = postgresConstraint(cause);
							if (constraint === "ledger_account_category_parents_child_ownership_fk")
								return new CategoryNotFound(`Category not found: ${categoryId.toString()}`, { cause });
							if (constraint === "ledger_account_category_parents_parent_ownership_fk")
								return new CategoryNotFound(`Category not found: ${parentCategoryId.toString()}`, {
									cause,
								});
						}
						return mapCategoryInfrastructureError(cause);
					})
				);
		}).pipe(Effect.asVoid);
	}

	unlinkCategoryFromParent(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Effect.Effect<void, CategoryUnlinkParentRepositoryError> {
		return this.getLedgerAccountCategory(organizationId, ledgerId, categoryId).pipe(
			Effect.andThen(
				this.db
					.delete(LedgerAccountCategoryParentsTable)
					.where(
						and(
							eq(LedgerAccountCategoryParentsTable.organizationId, organizationId.toString()),
							eq(LedgerAccountCategoryParentsTable.ledgerId, ledgerId.toString()),
							eq(LedgerAccountCategoryParentsTable.categoryId, categoryId.toString()),
							eq(LedgerAccountCategoryParentsTable.parentCategoryId, parentCategoryId.toString())
						)
					)
					.returning({ categoryId: LedgerAccountCategoryParentsTable.categoryId })
					.pipe(Effect.mapError(mapCategoryInfrastructureError))
			),
			Effect.flatMap(rows =>
				rows.length === 0
					? Effect.fail(
							new CategoryNotFound(
								`Category ${categoryId.toString()} not linked to parent ${parentCategoryId.toString()}`
							)
						)
					: Effect.void
			)
		);
	}
}

const ledgerAccountCategoryRepoLayer = Layer.effect(
	LedgerAccountCategoryRepoTag,
	DatabaseTag.pipe(Effect.map(database => new LedgerAccountCategoryRepoLive(database.effectDb)))
);

export type {
	CategoryDeleteRepositoryError,
	CategoryGetRepositoryError,
	CategoryLinkAccountRepositoryError,
	CategoryLinkParentRepositoryError,
	CategoryListRepositoryError,
	CategoryUnlinkAccountRepositoryError,
	CategoryUnlinkParentRepositoryError,
	CategoryUpsertRepositoryError,
	LedgerAccountCategoryRepo,
};
export {
	LedgerAccountCategoryRepoLive,
	LedgerAccountCategoryRepoTag,
	ledgerAccountCategoryRepoLayer,
};
