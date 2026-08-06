import { Effect } from "effect";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { OrganizationId } from "./domain/OrganizationId";
import { parseOrganizationId } from "./domain/OrganizationId";
import type { InvalidOrganizationId } from "./domain/OrganizationErrors";
import type { Organization } from "./domain/Organization";
import { parseOrganizationUpdateInput } from "./domain/Organization";
import { resolveOrganizationAccess, type OrganizationOperation } from "./OrganizationAuthorization";
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
import type { OrganizationService } from "./OrganizationService";
import { OrganizationServiceTag } from "./OrganizationService";
import { runEffect } from "../http/RunEffect";

const targetId = (value: string): Effect.Effect<OrganizationId, InvalidOrganizationId> => {
	const parsed = parseOrganizationId(value);
	return parsed._tag === "Success" ? Effect.succeed(parsed.value) : Effect.fail(parsed.error);
};

const execute = async <A, E extends OrganizationHttpError>(
	request: FastifyRequest,
	reply: FastifyReply,
	operation: OrganizationOperation,
	use: (
		service: OrganizationService,
		actor: OrganizationId,
		access: ReturnType<typeof resolveOrganizationAccess>
	) => Effect.Effect<A, E>
): Promise<A | undefined> => {
	const effect = Effect.gen(function* () {
		const service = yield* OrganizationServiceTag;
		return yield* use(
			service,
			request.token.organizationId,
			resolveOrganizationAccess(request.token.permissions, operation)
		);
	});
	const result = await runEffect(request.server.runtime, request, effect, {
		mapError: organizationHttpFailure,
		operation: "Organization Effect",
		defectDetail: "The Organization operation could not be completed",
	});
	if (result._tag === "Failure") {
		await reply.status(result.status).send(result.problem);
		return undefined;
	}
	return result.value;
};

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
			const organizations = await execute(request, reply, "read", (service, actor, access) =>
				service.list({
					actorId: actor,
					access,
					offset: request.query.offset,
					limit: request.query.limit,
				})
			);
			if (organizations !== undefined)
				return organizations.map(value => toOrganizationResponse(value));
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
			const organization = await execute(request, reply, "read", (service, actor, access) =>
				targetId(request.params.orgId).pipe(
					Effect.flatMap(target => service.get({ actorId: actor, access, targetId: target }))
				)
			);
			if (organization !== undefined) return toOrganizationResponse(organization);
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
			const organization = await execute(request, reply, "create", (service, actor, access) =>
				service.create({ actorId: actor, access, input: request.body })
			);
			if (organization !== undefined) {
				return reply
					.status(201)
					.header("location", `/api/organizations/${organization.id}`)
					.send(toOrganizationResponse(organization));
			}
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
			const organization = await execute<Organization, OrganizationHttpError>(
				request,
				reply,
				"update",
				(service, actor, access) => {
					const input = parseOrganizationUpdateInput(request.body);
					if (input._tag === "Failure") return Effect.fail(input.error);
					return targetId(request.params.orgId).pipe(
						Effect.flatMap(target =>
							service.update({ actorId: actor, access, targetId: target, input: input.value })
						)
					);
				}
			);
			if (organization !== undefined) return toOrganizationResponse(organization);
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
			const organization = await execute(request, reply, "delete", (service, actor, access) =>
				targetId(request.params.orgId).pipe(
					Effect.flatMap(target => service.delete({ actorId: actor, access, targetId: target }))
				)
			);
			if (organization !== undefined) return reply.status(204).send();
		}
	);
};

export { OrganizationRoutes };
