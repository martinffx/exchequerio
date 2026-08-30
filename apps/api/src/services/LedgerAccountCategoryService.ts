import { Context, Effect, Layer } from "effect";
import { TypeID } from "typeid-js";
// oxlint-disable boundaries/element-types -- The approved in-place migration composes Category orchestration with the integrated Ledger service.
import {
	type LedgerGetError,
	LedgerServiceTag,
	type LedgerService,
} from "@/domains/ledgers/LedgerService";
// oxlint-enable boundaries/element-types
import { LedgerAccountCategoryEntity } from "@/repo/entities";
import type {
	LedgerAccountCategoryID,
	LedgerAccountID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import {
	type CategoryDeleteRepositoryError,
	type CategoryGetRepositoryError,
	type CategoryLinkAccountRepositoryError,
	type CategoryLinkParentRepositoryError,
	type CategoryListRepositoryError,
	type CategoryUnlinkAccountRepositoryError,
	type CategoryUnlinkParentRepositoryError,
	type CategoryUpsertRepositoryError,
	type LedgerAccountCategoryRepo,
	LedgerAccountCategoryRepoTag,
} from "@/repo/LedgerAccountCategoryRepo";
import type { LedgerAccountCategoryRequest } from "@/routes/ledgers/schema";

type CategoryListError = LedgerGetError | CategoryListRepositoryError;
type CategoryGetError = LedgerGetError | CategoryGetRepositoryError;
type CategoryCreateError = LedgerGetError | CategoryUpsertRepositoryError;
type CategoryUpdateError =
	| LedgerGetError
	| CategoryGetRepositoryError
	| CategoryUpsertRepositoryError;
type CategoryDeleteError = LedgerGetError | CategoryDeleteRepositoryError;
type CategoryLinkAccountError = LedgerGetError | CategoryLinkAccountRepositoryError;
type CategoryUnlinkAccountError = LedgerGetError | CategoryUnlinkAccountRepositoryError;
type CategoryLinkParentError = LedgerGetError | CategoryLinkParentRepositoryError;
type CategoryUnlinkParentError = LedgerGetError | CategoryUnlinkParentRepositoryError;

class LedgerAccountCategoryService {
	constructor(
		private readonly repository: LedgerAccountCategoryRepo,
		private readonly ledgerService: LedgerService
	) {}

	listLedgerAccountCategories(
		organizationId: OrgID,
		ledgerId: LedgerID,
		offset: number,
		limit: number
	): Effect.Effect<LedgerAccountCategoryEntity[], CategoryListError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(
				Effect.flatMap(() =>
					this.repository.listLedgerAccountCategories(organizationId, ledgerId, offset, limit)
				)
			);
	}

	getLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Effect.Effect<LedgerAccountCategoryEntity, CategoryGetError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(
				Effect.flatMap(() =>
					this.repository.getLedgerAccountCategory(organizationId, ledgerId, categoryId)
				)
			);
	}

	createLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: string,
		request: LedgerAccountCategoryRequest
	): Effect.Effect<LedgerAccountCategoryEntity, CategoryCreateError> {
		const typedLedgerId = TypeID.fromString<"lgr">(ledgerId) as LedgerID;
		return this.ledgerService.getLedger(organizationId, typedLedgerId).pipe(
			Effect.andThen(
				Effect.sync(() =>
					LedgerAccountCategoryEntity.fromRequest(request, organizationId, typedLedgerId)
				)
			),
			Effect.flatMap(entity => this.repository.upsertLedgerAccountCategory(entity))
		);
	}

	updateLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: string,
		categoryId: string,
		request: LedgerAccountCategoryRequest
	): Effect.Effect<LedgerAccountCategoryEntity, CategoryUpdateError> {
		const typedLedgerId = TypeID.fromString<"lgr">(ledgerId) as LedgerID;
		const typedCategoryId = TypeID.fromString<"lac">(categoryId) as LedgerAccountCategoryID;
		return this.ledgerService.getLedger(organizationId, typedLedgerId).pipe(
			Effect.flatMap(() =>
				this.repository.getLedgerAccountCategory(organizationId, typedLedgerId, typedCategoryId)
			),
			Effect.andThen(
				Effect.sync(() =>
					LedgerAccountCategoryEntity.fromRequest(request, organizationId, typedLedgerId, categoryId)
				)
			),
			Effect.flatMap(entity => this.repository.upsertLedgerAccountCategory(entity))
		);
	}

	deleteLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID
	): Effect.Effect<void, CategoryDeleteError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(
				Effect.flatMap(() =>
					this.repository.deleteLedgerAccountCategory(organizationId, ledgerId, categoryId)
				)
			);
	}

	linkLedgerAccountToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Effect.Effect<void, CategoryLinkAccountError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(
				Effect.flatMap(() =>
					this.repository.linkAccountToCategory(organizationId, ledgerId, categoryId, accountId)
				)
			);
	}

	unlinkLedgerAccountToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		accountId: LedgerAccountID
	): Effect.Effect<void, CategoryUnlinkAccountError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(
				Effect.flatMap(() =>
					this.repository.unlinkAccountFromCategory(organizationId, ledgerId, categoryId, accountId)
				)
			);
	}

	linkLedgerAccountCategoryToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Effect.Effect<void, CategoryLinkParentError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(
				Effect.flatMap(() =>
					this.repository.linkCategoryToParent(organizationId, ledgerId, categoryId, parentCategoryId)
				)
			);
	}

	unlinkLedgerAccountCategoryToCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		parentCategoryId: LedgerAccountCategoryID
	): Effect.Effect<void, CategoryUnlinkParentError> {
		return this.ledgerService
			.getLedger(organizationId, ledgerId)
			.pipe(
				Effect.flatMap(() =>
					this.repository.unlinkCategoryFromParent(
						organizationId,
						ledgerId,
						categoryId,
						parentCategoryId
					)
				)
			);
	}
}

const LedgerAccountCategoryServiceTag = Context.Service<LedgerAccountCategoryService>(
	"LedgerAccountCategoryService"
);
const ledgerAccountCategoryServiceLayer = Layer.effect(
	LedgerAccountCategoryServiceTag,
	Effect.gen(function* () {
		const repository = yield* LedgerAccountCategoryRepoTag;
		const ledgerService = yield* LedgerServiceTag;
		return new LedgerAccountCategoryService(repository, ledgerService);
	})
);

export type {
	CategoryCreateError,
	CategoryDeleteError,
	CategoryGetError,
	CategoryLinkAccountError,
	CategoryLinkParentError,
	CategoryListError,
	CategoryUnlinkAccountError,
	CategoryUnlinkParentError,
	CategoryUpdateError,
};
export {
	LedgerAccountCategoryService,
	LedgerAccountCategoryServiceTag,
	ledgerAccountCategoryServiceLayer,
};
