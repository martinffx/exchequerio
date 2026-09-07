import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { MetadataSchema } from "@/lib/schema";
import type { FastifyPluginAsync, preValidationAsyncHookHandler } from "fastify";
import { Effect, Result } from "effect";

import {
	BadRequestError,
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
} from "@/lib/errors";
import { parseId } from "@/lib/utils";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID } from "@/repo/entities/types";
import { LedgerAccountCategoryServiceTag } from "@/services/LedgerAccountCategoryService";
import { PaginationQuery } from "@/routes/schema";
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

// Check metadata before AJV can coerce non-string values into strings.
const validateMetadata: preValidationAsyncHookHandler = async request => {
	const body = request.body;
	if (
		body !== null &&
		typeof body === "object" &&
		"metadata" in body &&
		!Value.Check(MetadataSchema, body.metadata)
	) {
		throw new BadRequestError("Metadata must be an object with string values");
	}
};

const TAGS = ["Ledger Account Categories"];
const LedgerAccountCategoryRoutes: FastifyPluginAsync = async server => {
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
					404: NotFoundErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			preHandler: server.hasPermissions(["ledger:account:category:read"]),
		},
		async (rq: ListLedgerAccountCategoriesRequest): Promise<LedgerAccountCategoryResponse[]> => {
			const effect = parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					LedgerAccountCategoryServiceTag.use(service =>
						service.listLedgerAccountCategories(rq.token.orgId, ledgerId, rq.query.offset, rq.query.limit)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: categories => categories.map(category => category.toResponse()),
				onFailure: error => {
					throw error;
				},
			});
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
			preHandler: server.hasPermissions(["ledger:account:category:read"]),
		},
		async (rq: GetLedgerAccountCategoryRequest): Promise<LedgerAccountCategoryResponse> => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"lac", LedgerAccountCategoryID>("lac", rq.params.categoryId),
			]).pipe(
				Effect.flatMap(([ledgerId, categoryId]) =>
					LedgerAccountCategoryServiceTag.use(service =>
						service.getLedgerAccountCategory(rq.token.orgId, ledgerId, categoryId)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: category => category.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
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
					404: NotFoundErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			preValidation: validateMetadata,
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: CreateLedgerAccountCategoryRequest): Promise<LedgerAccountCategoryResponse> => {
			const effect = parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId).pipe(
				Effect.flatMap(ledgerId =>
					LedgerAccountCategoryServiceTag.use(service =>
						service.createLedgerAccountCategory(rq.token.orgId, ledgerId, rq.body)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: category => category.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
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
			preValidation: validateMetadata,
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: UpdateLedgerAccountCategoryRequest): Promise<LedgerAccountCategoryResponse> => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"lac", LedgerAccountCategoryID>("lac", rq.params.categoryId),
			]).pipe(
				Effect.flatMap(([ledgerId, categoryId]) =>
					LedgerAccountCategoryServiceTag.use(service =>
						service.updateLedgerAccountCategory(rq.token.orgId, ledgerId, categoryId, rq.body)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: category => category.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
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
			preHandler: server.hasPermissions(["ledger:account:category:delete"]),
		},
		async (rq: DeleteLedgerAccountCategoryRequest): Promise<void> => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"lac", LedgerAccountCategoryID>("lac", rq.params.categoryId),
			]).pipe(
				Effect.flatMap(([ledgerId, categoryId]) =>
					LedgerAccountCategoryServiceTag.use(service =>
						service.deleteLedgerAccountCategory(rq.token.orgId, ledgerId, categoryId)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: value => value,
				onFailure: error => {
					throw error;
				},
			});
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
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: LinkLedgerAccountToCategoryRequest): Promise<void> => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"lac", LedgerAccountCategoryID>("lac", rq.params.categoryId),
				parseId<"lat", LedgerAccountID>("lat", rq.params.accountId),
			]).pipe(
				Effect.flatMap(([ledgerId, categoryId, accountId]) =>
					LedgerAccountCategoryServiceTag.use(service =>
						service.linkLedgerAccountToCategory(rq.token.orgId, ledgerId, categoryId, accountId)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: value => value,
				onFailure: error => {
					throw error;
				},
			});
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
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: UnlinkLedgerAccountToCategoryRequest): Promise<void> => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"lac", LedgerAccountCategoryID>("lac", rq.params.categoryId),
				parseId<"lat", LedgerAccountID>("lat", rq.params.accountId),
			]).pipe(
				Effect.flatMap(([ledgerId, categoryId, accountId]) =>
					LedgerAccountCategoryServiceTag.use(service =>
						service.unlinkLedgerAccountToCategory(rq.token.orgId, ledgerId, categoryId, accountId)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: value => value,
				onFailure: error => {
					throw error;
				},
			});
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
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: LinkLedgerAccountCategoryToCategoryRequest): Promise<void> => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"lac", LedgerAccountCategoryID>("lac", rq.params.categoryId),
				parseId<"lac", LedgerAccountCategoryID>("lac", rq.params.parentCategoryId),
			]).pipe(
				Effect.flatMap(([ledgerId, categoryId, parentCategoryId]) =>
					LedgerAccountCategoryServiceTag.use(service =>
						service.linkLedgerAccountCategoryToCategory(
							rq.token.orgId,
							ledgerId,
							categoryId,
							parentCategoryId
						)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: value => value,
				onFailure: error => {
					throw error;
				},
			});
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
			preHandler: server.hasPermissions(["ledger:account:category:write"]),
		},
		async (rq: UnlinkLedgerAccountCategoryToCategoryRequest): Promise<void> => {
			const effect = Effect.all([
				parseId<"lgr", LedgerID>("lgr", rq.params.ledgerId),
				parseId<"lac", LedgerAccountCategoryID>("lac", rq.params.categoryId),
				parseId<"lac", LedgerAccountCategoryID>("lac", rq.params.parentCategoryId),
			]).pipe(
				Effect.flatMap(([ledgerId, categoryId, parentCategoryId]) =>
					LedgerAccountCategoryServiceTag.use(service =>
						service.unlinkLedgerAccountCategoryToCategory(
							rq.token.orgId,
							ledgerId,
							categoryId,
							parentCategoryId
						)
					)
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: value => value,
				onFailure: error => {
					throw error;
				},
			});
		}
	);
};

export { LedgerAccountCategoryRoutes };
