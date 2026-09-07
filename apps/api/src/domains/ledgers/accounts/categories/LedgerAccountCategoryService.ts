import { Context, Effect, Layer } from "effect";
import {
	type LedgerGetError,
	LedgerServiceTag,
	type LedgerService,
} from "@/domains/ledgers/LedgerService";
import { LedgerAccountCategoryEntity } from "./LedgerAccountCategoryEntity";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID, OrgID } from "@/lib/ids";
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
} from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryRepo";
import type { LedgerAccountCategoryRequest } from "./LedgerAccountCategorySchema";

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
		private readonly ledgerService: Pick<LedgerService, "getLedger">
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
		ledgerId: LedgerID,
		request: LedgerAccountCategoryRequest
	): Effect.Effect<LedgerAccountCategoryEntity, CategoryCreateError> {
		return this.ledgerService.getLedger(organizationId, ledgerId).pipe(
			Effect.andThen(
				Effect.sync(() => LedgerAccountCategoryEntity.fromRequest(request, organizationId, ledgerId))
			),
			Effect.flatMap(entity => this.repository.upsertLedgerAccountCategory(entity))
		);
	}

	updateLedgerAccountCategory(
		organizationId: OrgID,
		ledgerId: LedgerID,
		categoryId: LedgerAccountCategoryID,
		request: LedgerAccountCategoryRequest
	): Effect.Effect<LedgerAccountCategoryEntity, CategoryUpdateError> {
		return this.ledgerService.getLedger(organizationId, ledgerId).pipe(
			Effect.flatMap(() =>
				this.repository.getLedgerAccountCategory(organizationId, ledgerId, categoryId)
			),
			Effect.andThen(
				Effect.sync(() =>
					LedgerAccountCategoryEntity.fromRequest(
						request,
						organizationId,
						ledgerId,
						categoryId.toString()
					)
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
