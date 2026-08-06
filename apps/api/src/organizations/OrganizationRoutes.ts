import { Effect } from "effect";
import type { FastifyPluginAsync } from "fastify";
import type { OrganizationId } from "./domain/OrganizationId";
import { parseOrganizationId } from "./domain/OrganizationId";
import type { InvalidOrganizationId } from "./domain/OrganizationErrors";
import { parseOrganizationUpdateInput } from "./domain/Organization";
import { resolveOrganizationAccess } from "./OrganizationAuthorization";
import { organizationHttpFailure, type OrganizationHttpError } from "./OrganizationHttpErrors";
import {
	BadRequestProblem,
	ConflictProblem,
	ForbiddenProblem,
	InternalServerProblem,
	NotFoundProblem,
	OrganizationCreateRequest,
	OrganizationIdParameters,
	OrganizationListQuery,
	OrganizationResponse,
	OrganizationUpdateRequest,
	ServiceUnavailableProblem,
	TooManyRequestsProblem,
	UnauthorizedProblem,
	toOrganizationResponse,
} from "./OrganizationSchema";
import { OrganizationServiceTag } from "./OrganizationService";
import { runEffect, type RunEffectOptions } from "../http/RunEffect";

const targetId = (value: string): Effect.Effect<OrganizationId, InvalidOrganizationId> => {
	const parsed = parseOrganizationId(value);
	return parsed._tag === "Success" ? Effect.succeed(parsed.value) : Effect.fail(parsed.error);
};

const organizationEffectOptions = {
	mapError: organizationHttpFailure,
	operation: "Organization Effect",
	defectDetail: "The Organization operation could not be completed",
} satisfies RunEffectOptions<OrganizationHttpError>;

const commonErrors = {
	400: BadRequestProblem,
	401: UnauthorizedProblem,
	403: ForbiddenProblem,
	429: TooManyRequestsProblem,
	500: InternalServerProblem,
	503: ServiceUnavailableProblem,
};

const OrganizationRoutes: FastifyPluginAsync = async server => {
	server.get<{ Querystring: OrganizationListQuery }>(
		"/",
		{
			preHandler: server.organizationRateLimit,
			schema: {
				operationId: "listOrganizations",
				tags: ["Organizations"],
				summary: "List Organizations",
				querystring: OrganizationListQuery,
				response: { 200: { type: "array", items: OrganizationResponse }, ...commonErrors },
			},
		},
		async (request, reply) => {
			const actorId = request.token.organizationId;
			const access = resolveOrganizationAccess(request.token.permissions, "read");
			const effect = OrganizationServiceTag.use(service =>
				service.list({
					actorId,
					access,
					offset: request.query.offset,
					limit: request.query.limit,
				})
			);
			const result = await runEffect(
				request.server.runtime,
				request,
				effect,
				organizationEffectOptions
			);
			if (result._tag === "Failure") return reply.status(result.status).send(result.problem);
			return result.value.map(value => toOrganizationResponse(value));
		}
	);

	server.get<{ Params: OrganizationIdParameters }>(
		"/:orgId",
		{
			preHandler: server.organizationRateLimit,
			schema: {
				operationId: "getOrganization",
				tags: ["Organizations"],
				summary: "Get an Organization",
				params: OrganizationIdParameters,
				response: { 200: OrganizationResponse, 404: NotFoundProblem, ...commonErrors },
			},
		},
		async (request, reply) => {
			const actorId = request.token.organizationId;
			const access = resolveOrganizationAccess(request.token.permissions, "read");
			const effect = OrganizationServiceTag.use(service =>
				targetId(request.params.orgId).pipe(
					Effect.flatMap(target => service.get({ actorId, access, targetId: target }))
				)
			);
			const result = await runEffect(
				request.server.runtime,
				request,
				effect,
				organizationEffectOptions
			);
			if (result._tag === "Failure") return reply.status(result.status).send(result.problem);
			return toOrganizationResponse(result.value);
		}
	);

	server.post<{ Body: OrganizationCreateRequest }>(
		"/",
		{
			preHandler: server.organizationRateLimit,
			schema: {
				operationId: "createOrganization",
				tags: ["Organizations"],
				summary: "Create an Organization",
				body: OrganizationCreateRequest,
				response: { 201: OrganizationResponse, ...commonErrors },
			},
		},
		async (request, reply) => {
			const actorId = request.token.organizationId;
			const access = resolveOrganizationAccess(request.token.permissions, "create");
			const effect = OrganizationServiceTag.use(service =>
				service.create({ actorId, access, input: request.body })
			);
			const result = await runEffect(
				request.server.runtime,
				request,
				effect,
				organizationEffectOptions
			);
			if (result._tag === "Failure") return reply.status(result.status).send(result.problem);
			return reply
				.status(201)
				.header("location", `/api/organizations/${result.value.id}`)
				.send(toOrganizationResponse(result.value));
		}
	);

	server.put<{ Params: OrganizationIdParameters; Body: OrganizationUpdateRequest }>(
		"/:orgId",
		{
			preHandler: server.organizationRateLimit,
			schema: {
				operationId: "updateOrganization",
				tags: ["Organizations"],
				summary: "Update an Organization",
				params: OrganizationIdParameters,
				body: OrganizationUpdateRequest,
				response: { 200: OrganizationResponse, 404: NotFoundProblem, ...commonErrors },
			},
		},
		async (request, reply) => {
			const actorId = request.token.organizationId;
			const access = resolveOrganizationAccess(request.token.permissions, "update");
			const effect = OrganizationServiceTag.use(service =>
				Effect.gen(function* () {
					const input = parseOrganizationUpdateInput(request.body);
					if (input._tag === "Failure") return yield* Effect.fail(input.error);
					const target = yield* targetId(request.params.orgId);
					return yield* service.update({
						actorId,
						access,
						targetId: target,
						input: input.value,
					});
				})
			);
			const result = await runEffect(
				request.server.runtime,
				request,
				effect,
				organizationEffectOptions
			);
			if (result._tag === "Failure") return reply.status(result.status).send(result.problem);
			return toOrganizationResponse(result.value);
		}
	);

	server.delete<{ Params: OrganizationIdParameters }>(
		"/:orgId",
		{
			preHandler: server.organizationRateLimit,
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
		async (request, reply) => {
			const actorId = request.token.organizationId;
			const access = resolveOrganizationAccess(request.token.permissions, "delete");
			const effect = OrganizationServiceTag.use(service =>
				targetId(request.params.orgId).pipe(
					Effect.flatMap(target => service.delete({ actorId, access, targetId: target }))
				)
			);
			const result = await runEffect(
				request.server.runtime,
				request,
				effect,
				organizationEffectOptions
			);
			if (result._tag === "Failure") return reply.status(result.status).send(result.problem);
			return reply.status(204).send();
		}
	);
};

export { OrganizationRoutes };
