import { Type } from "@sinclair/typebox"
import type { FastifyPluginAsync } from "fastify"
import {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	type CreateOrganizationRequest,
	type DeleteOrganizationRequest,
	ForbiddenErrorResponse,
	type GetOrganizationRequest,
	InternalServerErrorResponse,
	type ListOrganizationsRequest,
	NotFoundErrorResponse,
	OrganizationRequest,
	OrganizationResponse,
	OrgIdParams,
	PaginationQuery,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
	type UpdateOrganizationRequest,
} from "./schema"
import { OrganizationEntity } from "@/services"

const OrganizationRoutes: FastifyPluginAsync = async server => {
	server.get<{ Querystring: PaginationQuery }>(
		"/",
		{
			schema: {
				operationId: "listOrganizations",
				tags: ["Organizations"],
				summary: "List organizations",
				description: "List organizations",
				querystring: PaginationQuery,
				response: {
					200: Type.Array(OrganizationResponse),
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			preHandler: server.hasPermissions(["my:organization:read", "organization:read"]),
		},
		async (rq: ListOrganizationsRequest): Promise<OrganizationResponse[]> => {
			const orgs = await rq.server.services.organizationService.listOrganizations(
				rq.query.offset,
				rq.query.limit
			)
			return orgs.map(org => org.toResponse())
		}
	)

	server.get<{ Params: OrgIdParams }>(
		"/:orgId",
		{
			schema: {
				operationId: "getOrganization",
				tags: ["Organizations"],
				summary: "Get organization",
				description: "Get organization",
				params: OrgIdParams,
				response: {
					200: OrganizationResponse,
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					404: NotFoundErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			preHandler: server.hasPermissions(["my:organization:read", "organization:read"]),
		},
		async (rq: GetOrganizationRequest): Promise<OrganizationResponse> => {
			const org = await rq.server.services.organizationService.getOrganization(rq.params.orgId)
			return org.toResponse()
		}
	)

	server.post<{ Body: OrganizationRequest }>(
		"/",
		{
			schema: {
				operationId: "createOrganization",
				tags: ["Organizations"],
				summary: "Create organization",
				description: "Create organization",
				body: OrganizationRequest,
				response: {
					200: OrganizationResponse,
					400: BadRequestErrorResponse,
					401: UnauthorizedErrorResponse,
					403: ForbiddenErrorResponse,
					409: ConflictErrorResponse,
					429: TooManyRequestsErrorResponse,
					500: InternalServerErrorResponse,
					503: ServiceUnavailableErrorResponse,
				},
			},
			preHandler: server.hasPermissions(["my:organization:write", "organization:write"]),
		},
		async (rq: CreateOrganizationRequest): Promise<OrganizationResponse> => {
			const org = await server.services.organizationService.createOrganization(
				OrganizationEntity.fromRequest(rq.body)
			)
			return org.toResponse()
		}
	)

	server.put<{ Body: OrganizationRequest; Params: OrgIdParams }>(
		"/:orgId",
		{
			schema: {
				operationId: "updateOrganization",
				tags: ["Organizations"],
				summary: "Update organization",
				description: "Update organization",
				params: OrgIdParams,
				body: OrganizationRequest,
				response: {
					200: OrganizationResponse,
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
			preHandler: server.hasPermissions(["my:organization:write", "organization:write"]),
		},
		async (rq: UpdateOrganizationRequest): Promise<OrganizationResponse> => {
			const org = await rq.server.services.organizationService.updateOrganization(
				rq.params.orgId,
				OrganizationEntity.fromRequest(rq.body, rq.params.orgId)
			)
			return org.toResponse()
		}
	)

	server.delete<{ Params: OrgIdParams }>(
		"/:orgId",
		{
			schema: {
				operationId: "deleteOrganization",
				tags: ["Organizations"],
				summary: "Delete organization",
				description: "Delete organization",
				params: OrgIdParams,
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
			preHandler: server.hasPermissions(["my:organization:delete", "organization:delete"]),
		},
		async (rq: DeleteOrganizationRequest): Promise<void> => {
			await rq.server.services.organizationService.deleteOrganization(rq.params.orgId)
		}
	)
}

export { OrganizationRoutes }
