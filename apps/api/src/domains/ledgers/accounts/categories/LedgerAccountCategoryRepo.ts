import { ConflictError } from "@/lib/errors";
import type { CategoryBalanceRecord, CategoryBalances } from "./LedgerAccountCategoryEntity";
import { encodeUuid } from "@/lib/utils";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DatabaseTag, type EffectDrizzleDatabase, postgresErrorCode } from "@/db";
import { postgresConstraint } from "@/db/errors";
import { AccountNotFound } from "@/domains/ledgers/accounts/AccountErrors";
import { LedgerNotFound } from "@/domains/ledgers/LedgerErrors";
import { LedgerAccountCategoryEntity } from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryEntity";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID, OrgID } from "@/lib/ids";
import {
	CategoryConflict,
	type CategoryInfrastructureError,
	CategoryNotFound,
	CategoryPersistenceDecodingFailure,
	mapCategoryInfrastructureError,
} from "./LedgerAccountCategoryErrors";
import {
	AssetsTable,
	LedgerAccountsTable,
	LedgerAccountCategoriesTable,
	LedgerAccountCategoryAccountsTable,
	LedgerAccountCategoryParentsTable,
} from "@/db/schema";

type CategoryBalancesRepositoryError = CategoryGetRepositoryError | ConflictError;

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
	getLedgerAccountCategoryBalances(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Effect.Effect<CategoryBalances, CategoryBalancesRepositoryError>;

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

	getLedgerAccountCategoryBalances(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Effect.Effect<CategoryBalances, CategoryBalancesRepositoryError> {
		return Effect.suspend(() =>
			this.db.execute<CategoryBalanceRecord>(
				sql`
   WITH RECURSIVE root AS (
    SELECT id, normal_balance FROM ${LedgerAccountCategoriesTable}
    WHERE organization_id = ${encodeUuid(organizationId)} AND ledger_id = ${encodeUuid(ledgerId)} AND id = ${encodeUuid(categoryId)}
   ), descendants(id) AS (
    SELECT id FROM root
    UNION
    SELECT links.category_id FROM ${LedgerAccountCategoryParentsTable} links
    JOIN descendants ON descendants.id = links.parent_category_id
    WHERE links.organization_id = ${encodeUuid(organizationId)} AND links.ledger_id = ${encodeUuid(ledgerId)}
   ), members AS (
    SELECT DISTINCT links.account_id FROM ${LedgerAccountCategoryAccountsTable} links
    JOIN descendants ON descendants.id = links.category_id
    WHERE links.organization_id = ${encodeUuid(organizationId)} AND links.ledger_id = ${encodeUuid(ledgerId)}
   ), totals AS (
    SELECT accounts.asset_id,
     SUM(accounts.posted_debits)::text AS posted_debits, SUM(accounts.posted_credits)::text AS posted_credits,
     SUM(accounts.pending_debits)::text AS pending_debits, SUM(accounts.pending_credits)::text AS pending_credits
    FROM ${LedgerAccountsTable} accounts JOIN members ON members.account_id = accounts.id
    WHERE accounts.organization_id = ${encodeUuid(organizationId)} AND accounts.ledger_id = ${encodeUuid(ledgerId)}
    GROUP BY accounts.asset_id
   )
   SELECT root.id, root.normal_balance AS "normalBalance",
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'id', assets.id, 'code', assets.code, 'minorUnitExponent', assets.minor_unit_exponent,
     'postedDebits', totals.posted_debits, 'postedCredits', totals.posted_credits,
     'pendingDebits', totals.pending_debits, 'pendingCredits', totals.pending_credits
    ) ORDER BY assets.id) FROM totals JOIN ${AssetsTable} assets ON assets.id = totals.asset_id
    WHERE assets.organization_id = ${encodeUuid(organizationId)}), '[]'::jsonb) AS assets
   FROM root
  `,
				"objects"
			)
		).pipe(
			Effect.mapError(mapCategoryInfrastructureError),
			Effect.flatMap(
				(rows): Effect.Effect<CategoryBalances, CategoryBalancesRepositoryError> =>
					rows.length === 0
						? Effect.fail(new CategoryNotFound(`Category not found: ${categoryId.toString()}`))
						: Effect.try({
								try: () => LedgerAccountCategoryEntity.balancesFromRecord(rows[0]),
								catch: cause =>
									cause instanceof ConflictError ? cause : new CategoryPersistenceDecodingFailure(cause),
							})
			)
		);
	}

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
					eq(LedgerAccountCategoriesTable.organizationId, encodeUuid(organizationId)),
					eq(LedgerAccountCategoriesTable.ledgerId, encodeUuid(ledgerId))
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
					eq(LedgerAccountCategoriesTable.organizationId, encodeUuid(organizationId)),
					eq(LedgerAccountCategoriesTable.ledgerId, encodeUuid(ledgerId)),
					eq(LedgerAccountCategoriesTable.id, encodeUuid(categoryId))
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
							eq(LedgerAccountCategoriesTable.organizationId, encodeUuid(entity.organizationId)),
							eq(LedgerAccountCategoriesTable.ledgerId, encodeUuid(entity.ledgerId))
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
					eq(LedgerAccountCategoriesTable.organizationId, encodeUuid(organizationId)),
					eq(LedgerAccountCategoriesTable.ledgerId, encodeUuid(ledgerId)),
					eq(LedgerAccountCategoriesTable.id, encodeUuid(categoryId))
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
						organizationId: encodeUuid(organizationId),
						ledgerId: encodeUuid(ledgerId),
						categoryId: encodeUuid(categoryId),
						accountId: encodeUuid(accountId),
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
							eq(LedgerAccountCategoryAccountsTable.organizationId, encodeUuid(organizationId)),
							eq(LedgerAccountCategoryAccountsTable.ledgerId, encodeUuid(ledgerId)),
							eq(LedgerAccountCategoryAccountsTable.categoryId, encodeUuid(categoryId)),
							eq(LedgerAccountCategoryAccountsTable.accountId, encodeUuid(accountId))
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
			// Only reject cycles visible to this check; simultaneous links may still race.
			const cycles = yield* this.db
				.execute<{ cycle: boolean }>(
					sql`
    WITH RECURSIVE descendants(id) AS (
     SELECT ${encodeUuid(categoryId)}::uuid
     UNION
     SELECT links.category_id FROM ${LedgerAccountCategoryParentsTable} links
     JOIN descendants ON descendants.id = links.parent_category_id
     WHERE links.organization_id = ${encodeUuid(organizationId)} AND links.ledger_id = ${encodeUuid(ledgerId)}
    )
    SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ${encodeUuid(parentCategoryId)})
     AND NOT EXISTS(SELECT 1 FROM ${LedgerAccountCategoryParentsTable}
      WHERE organization_id = ${encodeUuid(organizationId)} AND ledger_id = ${encodeUuid(ledgerId)}
      AND category_id = ${encodeUuid(categoryId)} AND parent_category_id = ${encodeUuid(parentCategoryId)}) AS cycle
   `,
					"objects"
				)
				.pipe(Effect.mapError(mapCategoryInfrastructureError));
			if (cycles[0].cycle)
				return yield* Effect.fail(new CategoryConflict("Category link would create a cycle"));
			yield* this.db
				.insert(LedgerAccountCategoryParentsTable)
				.values({
					organizationId: encodeUuid(organizationId),
					ledgerId: encodeUuid(ledgerId),
					categoryId: encodeUuid(categoryId),
					parentCategoryId: encodeUuid(parentCategoryId),
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
							eq(LedgerAccountCategoryParentsTable.organizationId, encodeUuid(organizationId)),
							eq(LedgerAccountCategoryParentsTable.ledgerId, encodeUuid(ledgerId)),
							eq(LedgerAccountCategoryParentsTable.categoryId, encodeUuid(categoryId)),
							eq(LedgerAccountCategoryParentsTable.parentCategoryId, encodeUuid(parentCategoryId))
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
	CategoryBalancesRepositoryError,
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
