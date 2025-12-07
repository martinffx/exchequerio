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
import { LedgerAccountCategoryEntity } from "@/services";
import {
	type CreateLedgerAccountCategoryRequest,
	type DeleteLedgerAccountCategoryRequest,
	type GetLedgerAccountCategoryRequest,
	LedgerAccountCategoryIdParams as LedgerAccountCategoryIdParameters,
	LedgerAccountCategoryRequest,
	LedgerAccountCategoryResponse,
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
	server.get<{ Params: { ledgerId: string }; Querystring: PaginationQuery }>(
		"/",
		{
			schema: {
				operationId: "listLedgerAccountCategories",
				tags: TAGS,
				summary: "List Ledger Account Categories",
				description: "List Ledger Account Categories",
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

	server.get<{ Params: { ledgerId: string; ledgerAccountCategoryId: string } }>(
		"/:ledgerAccountCategoryId",
		{
			schema: {
				operationId: "getLedgerAccountCategory",
				tags: TAGS,
				summary: "Get Ledger Account Category",
				description: "Get Ledger Account Category",
				params: LedgerAccountCategoryIdParameters,
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
			const categoryId = TypeID.fromString<"lac">(rq.params.ledgerAccountCategoryId);
			const category = await ledgerAccountCategoryService.getLedgerAccountCategory(
				ledgerId,
				categoryId
			);
			return category.toResponse();
		}
	);

	server.post<{ Params: { ledgerId: string }; Body: LedgerAccountCategoryRequest }>(
		"/",
		{
			schema: {
				operationId: "createLedgerAccountCategory",
				tags: TAGS,
				summary: "Create Ledger Account Category",
				description: "Create Ledger Account Category",
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
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const category = await ledgerAccountCategoryService.createLedgerAccountCategory(
				LedgerAccountCategoryEntity.fromRequest(rq.body, ledgerId)
			);
			return category.toResponse();
		}
	);

	server.put<{
		Params: { ledgerId: string; ledgerAccountCategoryId: string };
		Body: LedgerAccountCategoryRequest;
	}>(
		"/:ledgerAccountCategoryId",
		{
			schema: {
				operationId: "updateLedgerAccountCategory",
				tags: TAGS,
				summary: "Update Ledger Account Category",
				description: "Update Ledger Account Category",
				params: LedgerAccountCategoryIdParameters,
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
			const ledgerId = TypeID.fromString<"lgr">(rq.params.ledgerId);
			const categoryId = TypeID.fromString<"lac">(rq.params.ledgerAccountCategoryId);
			const category = await ledgerAccountCategoryService.updateLedgerAccountCategory(
				ledgerId,
				categoryId,
				LedgerAccountCategoryEntity.fromRequest(rq.body, ledgerId, rq.params.ledgerAccountCategoryId)
			);
			return category.toResponse();
		}
	);

	server.delete<{ Params: { ledgerId: string; ledgerAccountCategoryId: string } }>(
		"/:ledgerAccountCategoryId",
		{
			schema: {
				operationId: "deleteLedgerAccountCategory",
				tags: TAGS,
				summary: "Delete Ledger Account Category",
				description: "Delete Ledger Account Category",
				params: LedgerAccountCategoryIdParameters,
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
			const categoryId = TypeID.fromString<"lac">(rq.params.ledgerAccountCategoryId);
			await ledgerAccountCategoryService.deleteLedgerAccountCategory(ledgerId, categoryId);
		}
	);

	server.patch<{ Params: { ledgerId: string; ledgerAccountCategoryId: string; accountId: string } }>(
		"/:ledgerAccountCategoryId/accounts/:accountId",
		{
			schema: {
				operationId: "linkLedgerAccountToCategory",
				tags: TAGS,
				summary: "Link Ledger Account to Category",
				description: "Add a Ledger Account to a Ledger Account Category.",
				params: LinkAccountToCategoryParameters,
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
			const categoryId = TypeID.fromString<"lac">(rq.params.ledgerAccountCategoryId);
			const accountId = TypeID.fromString<"lat">(rq.params.accountId);
			await ledgerAccountCategoryService.linkLedgerAccountToCategory(ledgerId, categoryId, accountId);
		}
	);

	server.delete<{
		Params: { ledgerId: string; ledgerAccountCategoryId: string; accountId: string };
	}>(
		"/:ledgerAccountCategoryId/accounts/:accountId",
		{
			schema: {
				operationId: "unlinkLedgerAccountToCategory",
				tags: TAGS,
				summary: "Unlink Ledger Account to Category",
				description: "Remove a Ledger Account from a Ledger Account Category",
				params: LinkAccountToCategoryParameters,
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
			const categoryId = TypeID.fromString<"lac">(rq.params.ledgerAccountCategoryId);
			const accountId = TypeID.fromString<"lat">(rq.params.accountId);
			await ledgerAccountCategoryService.unlinkLedgerAccountToCategory(
				ledgerId,
				categoryId,
				accountId
			);
		}
	);

	server.patch<{
		Params: { ledgerId: string; ledgerAccountCategoryId: string; categoryId: string };
	}>(
		"/:ledgerAccountCategoryId/categories/:categoryId",
		{
			schema: {
				operationId: "linkLedgerAccountCategoryToCategory",
				tags: TAGS,
				summary: "Link Ledger Account Category to Category",
				description: "Nest a Ledger Account Category within a higher-level Ledger Account Category.",
				params: LinkCategoryToCategoryParameters,
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
			const categoryId = TypeID.fromString<"lac">(rq.params.ledgerAccountCategoryId);
			const parentCategoryId = TypeID.fromString<"lac">(rq.params.categoryId);
			await ledgerAccountCategoryService.linkLedgerAccountCategoryToCategory(
				ledgerId,
				categoryId,
				parentCategoryId
			);
		}
	);

	server.delete<{
		Params: { ledgerId: string; ledgerAccountCategoryId: string; categoryId: string };
	}>(
		"/:ledgerAccountCategoryId/categories/:categoryId",
		{
			schema: {
				operationId: "unlinkLedgerAccountCategoryToCategory",
				tags: TAGS,
				summary: "Unlink Ledger Account Category to Category",
				description: "Remove a Ledger Account Category from a higher-level Ledger Account Category",
				params: LinkCategoryToCategoryParameters,
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
			const categoryId = TypeID.fromString<"lac">(rq.params.ledgerAccountCategoryId);
			const parentCategoryId = TypeID.fromString<"lac">(rq.params.categoryId);
			await ledgerAccountCategoryService.unlinkLedgerAccountCategoryToCategory(
				ledgerId,
				categoryId,
				parentCategoryId
			);
		}
	);
};

export { LedgerAccountCategoryRoutes };
