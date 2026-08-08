import { Effect, Result } from "effect";
import type { FastifyPluginAsync } from "fastify";
import type { OrgID } from "../repo/entities/types";
import {
	OrganizationCreateRequest,
	OrganizationIdParameters,
	OrganizationListQuery,
	OrganizationResponse,
	OrganizationUpdateRequest,
	toOrganizationResponse,
} from "./OrganizationSchema";
import { OrganizationServiceTag } from "./OrganizationService";
import {
	BadRequestProblem,
	ConflictProblem,
	ForbiddenProblem,
	InternalServerProblem,
	NotFoundProblem,
	ServiceUnavailableProblem,
	UnauthorizedProblem,
} from "@/lib/errors";
import { parseId } from "@/lib/utils";

const commonErrors = {
	400: BadRequestProblem,
	401: UnauthorizedProblem,
	403: ForbiddenProblem,
	500: InternalServerProblem,
	503: ServiceUnavailableProblem,
};

const OrganizationRoutes: FastifyPluginAsync = async server => {
	server.get<{ Querystring: OrganizationListQuery }>(
		"/",
		{
			preHandler: [server.hasPermissions(["organization:read"])],
			schema: {
				operationId: "listOrganizations",
				tags: ["Organizations"],
				summary: "List Organizations",
				querystring: OrganizationListQuery,
				response: { 200: { type: "array", items: OrganizationResponse }, ...commonErrors },
			},
		},
		async rq => {
			const effect = OrganizationServiceTag.use(service =>
				service.listOrganizations({
					offset: rq.query.offset,
					limit: rq.query.limit,
				})
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: value => value.map(organization => toOrganizationResponse(organization)),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.get<{ Params: OrganizationIdParameters }>(
		"/:orgId",
		{
			preHandler: [server.hasPermissions(["organization:read"])],
			schema: {
				operationId: "getOrganization",
				tags: ["Organizations"],
				summary: "Get an Organization",
				params: OrganizationIdParameters,
				response: { 200: OrganizationResponse, 404: NotFoundProblem, ...commonErrors },
			},
		},
		async rq => {
			const effect = parseId<"org", OrgID>("org", rq.params.orgId).pipe(
				Effect.flatMap(orgId => OrganizationServiceTag.use(service => service.getOrganization(orgId)))
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: toOrganizationResponse,
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.post<{ Body: OrganizationCreateRequest }>(
		"/",
		{
			preHandler: [server.hasPermissions(["organization:write"])],
			schema: {
				operationId: "createOrganization",
				tags: ["Organizations"],
				summary: "Create an Organization",
				body: OrganizationCreateRequest,
				response: { 201: OrganizationResponse, ...commonErrors },
			},
		},
		async (rq, reply) => {
			const effect = OrganizationServiceTag.use(service => service.createOrganization(rq.body));
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: value =>
					reply
						.status(201)
						.header("location", `/api/organizations/${value.id.toString()}`)
						.send(toOrganizationResponse(value)),
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.put<{ Params: OrganizationIdParameters; Body: OrganizationUpdateRequest }>(
		"/:orgId",
		{
			preHandler: [server.hasPermissions(["organization:write"])],
			schema: {
				operationId: "updateOrganization",
				tags: ["Organizations"],
				summary: "Update an Organization",
				params: OrganizationIdParameters,
				body: OrganizationUpdateRequest,
				response: { 200: OrganizationResponse, 404: NotFoundProblem, ...commonErrors },
			},
		},
		async rq => {
			const effect = parseId<"org", OrgID>("org", rq.params.orgId).pipe(
				Effect.flatMap(orgId =>
					OrganizationServiceTag.use(service => service.updateOrganization(orgId, rq.body))
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: toOrganizationResponse,
				onFailure: error => {
					throw error;
				},
			});
		}
	);

	server.delete<{ Params: OrganizationIdParameters }>(
		"/:orgId",
		{
			preHandler: [server.hasPermissions(["organization:delete"])],
			schema: {
				operationId: "deleteOrganization",
				tags: ["Organizations"],
				summary: "Delete an Organization",
				params: OrganizationIdParameters,
				response: {
					204: { type: "null" },
					404: NotFoundProblem,
					409: ConflictProblem,
					...commonErrors,
				},
			},
		},
		async (rq, reply) => {
			const effect = parseId<"org", OrgID>("org", rq.params.orgId).pipe(
				Effect.flatMap(orgId =>
					OrganizationServiceTag.use(service => service.deleteOrganization(orgId))
				)
			);
			const result = await rq.server.runtime.runPromise(Effect.result(effect));
			return Result.match(result, {
				onSuccess: () => reply.status(204).send(),
				onFailure: error => {
					throw error;
				},
			});
		}
	);
};

export { OrganizationRoutes };
