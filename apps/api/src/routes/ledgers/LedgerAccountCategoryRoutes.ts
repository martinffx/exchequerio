import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { TypeID } from "typeid-js";

import {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	PaginationQuery,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
} from "@/routes/schema";
import {
	type CreateLedgerAccountCategoryRequest,
	type DeleteLedgerAccountCategoryRequest,
	type GetLedgerAccountCategoryRequest,
	LedgerAccountCategoryIdParams as LedgerAccountCategoryIdParameters,
	LedgerAccountCategoryRequest,
	LedgerAccountCategoryResponse,
	LedgerIdParams as LedgerIdParameters,
	LinkAccountToCategoryParams as LinkAccountToCategoryParameters,
	LinkCategoryToCategoryParams as LinkCategoryToCategoryParameters,
	type LinkLedgerAccountCategoryToCategoryRequest,
	type LinkLedgerAccountToCategoryRequest,
	type ListLedgerAccountCategoriesRequest,
	type UnlinkLedgerAccountCategoryToCategoryRequest,
	type UnlinkLedgerAccountToCategoryRequest,
	type UpdateLedgerAccountCategoryRequest,
} from "./schema";

const TAGS = ["Ledger Account Categories"];
const LedgerAccountCategoryRoutes: FastifyPluginAsync = async server => {
	const { ledgerAccountCategoryService } = server.services;
	server.get<{ Params: LedgerIdParameters; Querystring: PaginationQuery }>(
		"/",
		{
			schema: {
				operationId: "listLedgerAccountCategories",
				tags: TAGS,
				summary: "List Ledger Account Categories",
				description: "List Ledger Account Categories",
				params: LedgerIdParameters,
				querystring: PaginationQuery,
				response: {
					200: Type.Array(LedgerAccountCategoryResponse),
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:category:read"]),
		},
		async (rq: ListLedgerAccountCategoriesRequest): Promise<LedgerAccountCategoryResponse[]> => {
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const categories = await ledgerAccountCategoryService.listLedgerAccountCategories(
				ledgerId,
				rq.query.offset,
				rq.query.limit
			);
			return categories.map(category => category.toResponse());
		}
	);

	server.get<{
		Params: LedgerIdParameters & LedgerAccountCategoryIdParameters;
	}>(
		"/:categoryId",
		{
			schema: {
				operationId: "getLedgerAccountCategory",
				tags: TAGS,
				summary: "Get Ledger Account Category",
				description: "Get Ledger Account Category",
				params: Type.Composite([LedgerIdParameters, LedgerAccountCategoryIdParameters]),
				response: {
					200: LedgerAccountCategoryResponse,
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:category:read"]),
		},
		async (rq: GetLedgerAccountCategoryRequest): Promise<LedgerAccountCategoryResponse> => {
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const categoryId = TypeID.fromString<"lac">(rq.params.categoryId);
			const category = await ledgerAccountCategoryService.getLedgerAccountCategory(
				ledgerId,
				categoryId
			);
			return category.toResponse();
		}
	);

	server.post<{ Params: LedgerIdParameters; Body: LedgerAccountCategoryRequest }>(
		"/",
		{
			schema: {
				operationId: "createLedgerAccountCategory",
				tags: TAGS,
				summary: "Create Ledger Account Category",
				description: "Create Ledger Account Category",
				params: LedgerIdParameters,
				body: LedgerAccountCategoryRequest,
				response: {
					200: LedgerAccountCategoryResponse,
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: CreateLedgerAccountCategoryRequest): Promise<LedgerAccountCategoryResponse> => {
			const category = await ledgerAccountCategoryService.createLedgerAccountCategory(
				rq.params.ledgerId,
				rq.body
			);
			return category.toResponse();
		}
	);

	server.put<{
		Params: LedgerIdParameters & LedgerAccountCategoryIdParameters;
		Body: LedgerAccountCategoryRequest;
	}>(
		"/:categoryId",
		{
			schema: {
				operationId: "updateLedgerAccountCategory",
				tags: TAGS,
				summary: "Update Ledger Account Category",
				description: "Update Ledger Account Category",
				params: Type.Composite([LedgerIdParameters, LedgerAccountCategoryIdParameters]),
				body: LedgerAccountCategoryRequest,
				response: {
					200: LedgerAccountCategoryResponse,
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: UpdateLedgerAccountCategoryRequest): Promise<LedgerAccountCategoryResponse> => {
			const category = await ledgerAccountCategoryService.updateLedgerAccountCategory(
				rq.params.ledgerId,
				rq.params.categoryId,
				rq.body
			);
			return category.toResponse();
		}
	);

	server.delete<{
		Params: LedgerIdParameters & LedgerAccountCategoryIdParameters;
	}>(
		"/:categoryId",
		{
			schema: {
				operationId: "deleteLedgerAccountCategory",
				tags: TAGS,
				summary: "Delete Ledger Account Category",
				description: "Delete Ledger Account Category",
				params: Type.Composite([LedgerIdParameters, LedgerAccountCategoryIdParameters]),
				response: {
					200: {},
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:category:delete"]),
		},
		async (rq: DeleteLedgerAccountCategoryRequest): Promise<void> => {
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const categoryId = TypeID.fromString<"lac">(rq.params.categoryId);
			await ledgerAccountCategoryService.deleteLedgerAccountCategory(ledgerId, categoryId);
		}
	);

	server.patch<{
		Params: LedgerIdParameters & LinkAccountToCategoryParameters;
	}>(
		"/:categoryId/accounts/:accountId",
		{
			schema: {
				operationId: "linkLedgerAccountToCategory",
				tags: TAGS,
				summary: "Link Ledger Account to Category",
				description: "Add a Ledger Account to a Ledger Account Category.",
				params: Type.Composite([LedgerIdParameters, LinkAccountToCategoryParameters]),
				response: {
					200: {},
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: LinkLedgerAccountToCategoryRequest): Promise<void> => {
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const categoryId = TypeID.fromString<"lac">(rq.params.categoryId);
			const accountId = TypeID.fromString<"lat">(rq.params.accountId);
			await ledgerAccountCategoryService.linkLedgerAccountToCategory(ledgerId, categoryId, accountId);
		}
	);

	server.delete<{
		Params: LedgerIdParameters & LinkAccountToCategoryParameters;
	}>(
		"/:categoryId/accounts/:accountId",
		{
			schema: {
				operationId: "unlinkLedgerAccountToCategory",
				tags: TAGS,
				summary: "Unlink Ledger Account to Category",
				description: "Remove a Ledger Account from a Ledger Account Category",
				params: Type.Composite([LedgerIdParameters, LinkAccountToCategoryParameters]),
				response: {
					200: {},
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: UnlinkLedgerAccountToCategoryRequest): Promise<void> => {
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const categoryId = TypeID.fromString<"lac">(rq.params.categoryId);
			const accountId = TypeID.fromString<"lat">(rq.params.accountId);
			await ledgerAccountCategoryService.unlinkLedgerAccountToCategory(
				ledgerId,
				categoryId,
				accountId
			);
		}
	);

	server.patch<{
		Params: LedgerIdParameters & LinkCategoryToCategoryParameters;
	}>(
		"/:categoryId/categories/:parentCategoryId",
		{
			schema: {
				operationId: "linkLedgerAccountCategoryToCategory",
				tags: TAGS,
				summary: "Link Ledger Account Category to Category",
				description: "Nest a Ledger Account Category within a higher-level Ledger Account Category.",
				params: Type.Composite([LedgerIdParameters, LinkCategoryToCategoryParameters]),
				response: {
					200: {},
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: LinkLedgerAccountCategoryToCategoryRequest): Promise<void> => {
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const categoryId = TypeID.fromString<"lac">(rq.params.categoryId);
			const parentCategoryId = TypeID.fromString<"lac">(rq.params.parentCategoryId);
			await ledgerAccountCategoryService.linkLedgerAccountCategoryToCategory(
				ledgerId,
				categoryId,
				parentCategoryId
			);
		}
	);

	server.delete<{
		Params: LedgerIdParameters & LinkCategoryToCategoryParameters;
	}>(
		"/:categoryId/categories/:parentCategoryId",
		{
			schema: {
				operationId: "unlinkLedgerAccountCategoryToCategory",
				tags: TAGS,
				summary: "Unlink Ledger Account Category to Category",
				description: "Remove a Ledger Account Category from a higher-level Ledger Account Category",
				params: Type.Composite([LedgerIdParameters, LinkCategoryToCategoryParameters]),
				response: {
					200: {},
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: UnlinkLedgerAccountCategoryToCategoryRequest): Promise<void> => {
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const categoryId = TypeID.fromString<"lac">(rq.params.categoryId);
			const parentCategoryId = TypeID.fromString<"lac">(rq.params.parentCategoryId);
			await ledgerAccountCategoryService.unlinkLedgerAccountCategoryToCategory(
				ledgerId,
				categoryId,
				parentCategoryId
			);
		}
	);
};

export { LedgerAccountCategoryRoutes };
