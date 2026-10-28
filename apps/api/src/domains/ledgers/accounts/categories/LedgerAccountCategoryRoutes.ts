import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { CurrentToken, requirePermissions } from "@/auth";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID } from "@/lib/ids";
import { parseId } from "@/lib/utils";
import { LedgerAccountCategoryServiceTag } from "./LedgerAccountCategoryService";

const parseLedgerId = (ledgerId: string) => parseId<"lgr", LedgerID>("lgr", ledgerId);
const parseCategoryId = (categoryId: string) =>
	parseId<"lac", LedgerAccountCategoryID>("lac", categoryId);
const parseAccountId = (accountId: string) => parseId<"lat", LedgerAccountID>("lat", accountId);

/** Category CRUD, balances, and Account/Category membership routes. */
const LedgerAccountCategoryRoutes = HttpApiBuilder.group(LedgerApi, "categories", handlers =>
	Effect.gen(function* () {
		const service = yield* LedgerAccountCategoryServiceTag;
		return handlers
			.handle("balances", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:read"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const categoryId = yield* parseCategoryId(params.categoryId);
					const balances = yield* service.getLedgerAccountCategoryBalances(
						token.orgId,
						ledgerId,
						categoryId
					);
					return balances.toResponse();
				})
			)
			.handle("list", ({ params, query }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:read"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const categories = yield* service.listLedgerAccountCategories(
						token.orgId,
						ledgerId,
						query.offset,
						query.limit
					);
					return categories.map(category => category.toResponse());
				})
			)
			.handle("get", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:read"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const categoryId = yield* parseCategoryId(params.categoryId);
					const category = yield* service.getLedgerAccountCategory(token.orgId, ledgerId, categoryId);
					return category.toResponse();
				})
			)
			.handle("create", ({ params, payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const category = yield* service.createLedgerAccountCategory(token.orgId, ledgerId, payload);
					return category.toResponse();
				})
			)
			.handle("update", ({ params, payload }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const categoryId = yield* parseCategoryId(params.categoryId);
					const category = yield* service.updateLedgerAccountCategory(
						token.orgId,
						ledgerId,
						categoryId,
						payload
					);
					return category.toResponse();
				})
			)
			.handle("delete", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:delete"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const categoryId = yield* parseCategoryId(params.categoryId);
					yield* service.deleteLedgerAccountCategory(token.orgId, ledgerId, categoryId);
				})
			)
			.handle("linkAccount", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const categoryId = yield* parseCategoryId(params.categoryId);
					const accountId = yield* parseAccountId(params.accountId);
					yield* service.linkLedgerAccountToCategory(token.orgId, ledgerId, categoryId, accountId);
				})
			)
			.handle("unlinkAccount", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const categoryId = yield* parseCategoryId(params.categoryId);
					const accountId = yield* parseAccountId(params.accountId);
					yield* service.unlinkLedgerAccountToCategory(token.orgId, ledgerId, categoryId, accountId);
				})
			)
			.handle("linkCategory", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const categoryId = yield* parseCategoryId(params.categoryId);
					const parentCategoryId = yield* parseCategoryId(params.parentCategoryId);
					yield* service.linkLedgerAccountCategoryToCategory(
						token.orgId,
						ledgerId,
						categoryId,
						parentCategoryId
					);
				})
			)
			.handle("unlinkCategory", ({ params }) =>
				Effect.gen(function* () {
					yield* requirePermissions(["ledger:account:category:write"]);
					const token = yield* CurrentToken;
					const ledgerId = yield* parseLedgerId(params.ledgerId);
					const categoryId = yield* parseCategoryId(params.categoryId);
					const parentCategoryId = yield* parseCategoryId(params.parentCategoryId);
					yield* service.unlinkLedgerAccountCategoryToCategory(
						token.orgId,
						ledgerId,
						categoryId,
						parentCategoryId
					);
				})
			);
	})
);

export { LedgerAccountCategoryRoutes };
