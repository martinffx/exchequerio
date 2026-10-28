import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { operation, throttledConflictErrors, throttledNotFoundErrors } from "@/lib/ApiContract";
import { PaginationQuery } from "@/lib/schema";
import { Schema } from "effect";
import {
	LedgerAccountCategoryBalancesResponse,
	LedgerAccountCategoryIdParams,
	LedgerAccountCategoryRequest,
	LedgerAccountCategoryResponse,
	LedgerIdParameters,
	LinkAccountToCategoryParams,
	LinkCategoryToCategoryParams,
} from "./LedgerAccountCategorySchema";

// Collection paths keep their trailing slash, as today's OpenAPI document has it.
// Every Category route declares 429. Permissions are enforced by the handlers:
// read for GETs, write for create/update/link/unlink, delete for DELETE /:categoryId.

const prefix = "/ledgers/:ledgerId/accounts/categories";

const CategoriesApi = HttpApiGroup.make("categories")
	.add(
		HttpApiEndpoint.get("balances", `${prefix}/:categoryId/balances`, {
			params: LedgerAccountCategoryIdParams,
			success: LedgerAccountCategoryBalancesResponse,
			error: throttledConflictErrors,
		}).annotateMerge(
			operation(
				"getLedgerAccountCategoryBalances",
				"Get Ledger Account Category balances",
				"Current balances by Asset for all distinct descendant Accounts, using one snapshot and the Category's normal balance. Membership changes after the snapshot appear on the next read."
			)
		),
		HttpApiEndpoint.get("list", `${prefix}/`, {
			params: LedgerIdParameters,
			query: PaginationQuery,
			success: Schema.Array(LedgerAccountCategoryResponse),
			error: throttledNotFoundErrors,
		}).annotateMerge(
			operation(
				"listLedgerAccountCategories",
				"List Ledger Account Categories",
				"List Ledger Account Categories"
			)
		),
		HttpApiEndpoint.get("get", `${prefix}/:categoryId`, {
			params: LedgerAccountCategoryIdParams,
			success: LedgerAccountCategoryResponse,
			error: throttledNotFoundErrors,
		}).annotateMerge(
			operation(
				"getLedgerAccountCategory",
				"Get Ledger Account Category",
				"Get Ledger Account Category"
			)
		),
		// Legacy create answers 200 without a Location header.
		HttpApiEndpoint.post("create", `${prefix}/`, {
			params: LedgerIdParameters,
			payload: LedgerAccountCategoryRequest,
			success: LedgerAccountCategoryResponse,
			error: throttledConflictErrors,
		}).annotateMerge(
			operation(
				"createLedgerAccountCategory",
				"Create Ledger Account Category",
				"Create Ledger Account Category"
			)
		),
		HttpApiEndpoint.put("update", `${prefix}/:categoryId`, {
			params: LedgerAccountCategoryIdParams,
			payload: LedgerAccountCategoryRequest,
			success: LedgerAccountCategoryResponse,
			error: throttledConflictErrors,
		}).annotateMerge(
			operation(
				"updateLedgerAccountCategory",
				"Update Ledger Account Category",
				"Update Ledger Account Category"
			)
		),
		HttpApiEndpoint.delete("delete", `${prefix}/:categoryId`, {
			params: LedgerAccountCategoryIdParams,
			success: HttpApiSchema.Empty(200),
			error: throttledConflictErrors,
		}).annotateMerge(
			operation(
				"deleteLedgerAccountCategory",
				"Delete Ledger Account Category",
				"Delete Ledger Account Category"
			)
		),
		HttpApiEndpoint.patch("linkAccount", `${prefix}/:categoryId/accounts/:accountId`, {
			params: LinkAccountToCategoryParams,
			success: HttpApiSchema.Empty(200),
			error: throttledConflictErrors,
		}).annotateMerge(
			operation(
				"linkLedgerAccountToCategory",
				"Link Ledger Account to Category",
				"Add a Ledger Account to a Ledger Account Category."
			)
		),
		HttpApiEndpoint.delete("unlinkAccount", `${prefix}/:categoryId/accounts/:accountId`, {
			params: LinkAccountToCategoryParams,
			success: HttpApiSchema.Empty(200),
			error: throttledConflictErrors,
		}).annotateMerge(
			operation(
				"unlinkLedgerAccountToCategory",
				"Unlink Ledger Account to Category",
				"Remove a Ledger Account from a Ledger Account Category"
			)
		),
		HttpApiEndpoint.patch("linkCategory", `${prefix}/:categoryId/categories/:parentCategoryId`, {
			params: LinkCategoryToCategoryParams,
			success: HttpApiSchema.Empty(200),
			error: throttledConflictErrors,
		}).annotateMerge(
			operation(
				"linkLedgerAccountCategoryToCategory",
				"Link Ledger Account Category to Category",
				"Nest a Ledger Account Category within a higher-level Ledger Account Category."
			)
		),
		HttpApiEndpoint.delete("unlinkCategory", `${prefix}/:categoryId/categories/:parentCategoryId`, {
			params: LinkCategoryToCategoryParams,
			success: HttpApiSchema.Empty(200),
			error: throttledConflictErrors,
		}).annotateMerge(
			operation(
				"unlinkLedgerAccountCategoryToCategory",
				"Unlink Ledger Account Category to Category",
				"Remove a Ledger Account Category from a higher-level Ledger Account Category"
			)
		)
	)
	.annotateMerge(
		OpenApi.annotations({
			title: "Ledger Account Categories",
			description:
				"A ledger account category groups Ledger Accounts and can nest within other categories.",
		})
	);

export { CategoriesApi };
