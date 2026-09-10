import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Effect, Result } from "effect";
import type { FastifyPluginAsync } from "fastify";
import {
	BadRequestError,
	BadRequestProblem,
	ConflictProblem,
	ForbiddenProblem,
	InternalServerProblem,
	NotFoundProblem,
	ServiceUnavailableProblem,
	UnauthorizedProblem,
} from "@/lib/errors";
import { parseId } from "@/lib/utils";
import type { AssetID } from "@/lib/ids";
import {
	AssetCreateRequest,
	AssetIdParameters,
	AssetListQuery,
	AssetResponse,
	AssetUpdateRequest,
} from "./AssetSchema";
import { AssetServiceTag } from "./AssetService";

const commonErrors = {
	400: BadRequestProblem,
	401: UnauthorizedProblem,
	403: ForbiddenProblem,
	500: InternalServerProblem,
	503: ServiceUnavailableProblem,
};

const AssetRoutes: FastifyPluginAsync = async server => {
	server.get<{ Querystring: AssetListQuery }>(
		"/",
		{
			preHandler: [server.hasPermissions(["asset:read"])],
			schema: {
				operationId: "listAssets",
				tags: ["Assets"],
				summary: "List Assets",
				querystring: AssetListQuery,
				response: { 200: Type.Array(AssetResponse), ...commonErrors },
			},
		},
		async request => {
			const effect = AssetServiceTag.use(service =>
				service.listAssets(request.token.orgId, request.query)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: assets => assets.map(asset => asset.toResponse()),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.get<{ Params: AssetIdParameters }>(
		"/:assetId",
		{
			preHandler: [server.hasPermissions(["asset:read"])],
			schema: {
				operationId: "getAsset",
				tags: ["Assets"],
				summary: "Get an Asset",
				params: AssetIdParameters,
				response: { 200: AssetResponse, 404: NotFoundProblem, 409: ConflictProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = parseId<"ast", AssetID>("ast", request.params.assetId).pipe(
				Effect.flatMap(assetId =>
					AssetServiceTag.use(service => service.getAsset(request.token.orgId, assetId))
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: asset => asset.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{ Body: AssetCreateRequest }>(
		"/",
		{
			preHandler: [server.hasPermissions(["asset:write"])],
			preValidation: async request => {
				if (!Value.Check(AssetCreateRequest, request.body))
					throw new BadRequestError("Invalid Asset creation request");
			},
			schema: {
				operationId: "createAsset",
				tags: ["Assets"],
				summary: "Create an Asset",
				body: AssetCreateRequest,
				response: {
					201: AssetResponse,
					409: ConflictProblem,
					404: NotFoundProblem,
					...commonErrors,
				},
			},
		},
		async (request, reply) => {
			const effect = AssetServiceTag.use(service =>
				service.createAsset(request.token.orgId, request.body)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: asset =>
					reply
						.status(201)
						.header("location", `/api/assets/${asset.id.toString()}`)
						.send(asset.toResponse()),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.put<{ Params: AssetIdParameters; Body: AssetUpdateRequest }>(
		"/:assetId",
		{
			preHandler: [server.hasPermissions(["asset:write"])],
			preValidation: async request => {
				if (!Value.Check(AssetUpdateRequest, request.body))
					throw new BadRequestError("Invalid Asset replacement request");
			},
			schema: {
				operationId: "updateAsset",
				tags: ["Assets"],
				summary: "Replace an Asset",
				params: AssetIdParameters,
				body: AssetUpdateRequest,
				response: { 200: AssetResponse, 404: NotFoundProblem, 409: ConflictProblem, ...commonErrors },
			},
		},
		async request => {
			const effect = parseId<"ast", AssetID>("ast", request.params.assetId).pipe(
				Effect.flatMap(assetId =>
					AssetServiceTag.use(service => service.updateAsset(request.token.orgId, assetId, request.body))
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: asset => asset.toResponse(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.delete<{ Params: AssetIdParameters }>(
		"/:assetId",
		{
			preHandler: [server.hasPermissions(["asset:delete"])],
			schema: {
				operationId: "deleteAsset",
				tags: ["Assets"],
				summary: "Delete an Asset",
				params: AssetIdParameters,
				response: {
					204: { type: "null" },
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async (request, reply) => {
			const effect = parseId<"ast", AssetID>("ast", request.params.assetId).pipe(
				Effect.flatMap(assetId =>
					AssetServiceTag.use(service => service.deleteAsset(request.token.orgId, assetId))
				)
			);
			const result = await request.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: () => reply.status(204).send(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);
};

export { AssetRoutes };
