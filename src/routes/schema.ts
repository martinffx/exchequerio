import { type Static, Type } from "@sinclair/typebox"
import type { FastifyRequest } from "fastify"

const PaginationQuery = Type.Object({
	offset: Type.Number({ default: 0 }),
	limit: Type.Number({ default: 20 }),
})
type PaginationQuery = Static<typeof PaginationQuery>

const ProblemDetailError = Type.Object({
	message: Type.String(),
	stackTrace: Type.Optional(Type.Array(Type.String())),
})
type _ProblemDetailError = Static<typeof ProblemDetailError>
const ProblemDetail = Type.Object({
	title: Type.String(),
	detail: Type.String(),
	instance: Type.String(),
	traceId: Type.String(),
	errors: Type.Optional(Type.Array(ProblemDetailError)),
})
type _ProblemDetail = Static<typeof ProblemDetail>

const BadRequestErrorResponse = Type.Composite(
	[
		ProblemDetail,
		Type.Object({
			type: Type.Literal("BAD_REQUEST"),
			status: Type.Literal(400),
		}),
	],
	{ $id: "BadRequestErrorResponse" }
)
type BadRequestErrorResponse = Static<typeof BadRequestErrorResponse>
const UnauthorizedErrorResponse = Type.Composite(
	[
		ProblemDetail,
		Type.Object({
			type: Type.Literal("UNAUTHORIZED"),
			status: Type.Literal(401),
		}),
	],
	{ $id: "UnauthorizedErrorResponse" }
)
type UnauthorizedErrorResponse = Static<typeof UnauthorizedErrorResponse>
const ForbiddenErrorResponse = Type.Composite(
	[
		ProblemDetail,
		Type.Object({
			type: Type.Literal("FORBIDDEN"),
			status: Type.Literal(403),
		}),
	],
	{ $id: "ForbiddenErrorResponse" }
)
type ForbiddenErrorResponse = Static<typeof ForbiddenErrorResponse>
const NotFoundErrorResponse = Type.Composite(
	[
		ProblemDetail,
		Type.Object({
			type: Type.Literal("NOT_FOUND"),
			status: Type.Literal(404),
		}),
	],
	{ $id: "NotFoundErrorResponse" }
)
type NotFoundErrorResponse = Static<typeof NotFoundErrorResponse>
const ConflictErrorResponse = Type.Composite(
	[
		ProblemDetail,
		Type.Object({
			type: Type.Literal("CONFLICT"),
			status: Type.Literal(409),
		}),
	],
	{ $id: "ConflictErrorResponse" }
)
type ConflictErrorResponse = Static<typeof ConflictErrorResponse>
const TooManyRequestsErrorResponse = Type.Composite(
	[
		ProblemDetail,
		Type.Object({
			type: Type.Literal("TOO_MANY_REQUESTS"),
			status: Type.Literal(429),
		}),
	],
	{ $id: "TooManyRequestsErrorResponse" }
)
type TooManyRequestsErrorResponse = Static<typeof TooManyRequestsErrorResponse>
const InternalServerErrorResponse = Type.Composite(
	[
		ProblemDetail,
		Type.Object({
			type: Type.Literal("INTERNAL_SERVER_ERROR"),
			status: Type.Literal(500),
		}),
	],
	{ $id: "InternalServerErrorResponse" }
)
type InternalServerErrorResponse = Static<typeof InternalServerErrorResponse>
const ServiceUnavailableErrorResponse = Type.Composite(
	[
		ProblemDetail,
		Type.Object({
			type: Type.Literal("SERVICE_UNAVAILABLE"),
			status: Type.Literal(503),
		}),
	],
	{ $id: "ServiceUnavailableErrorResponse" }
)
type ServiceUnavailableErrorResponse = Static<typeof ServiceUnavailableErrorResponse>

const OrgId = Type.String({
	description: "The organization's ID",
	pattern: "^org_[0-9a-z]{26}$",
})
type OrgId = Static<typeof OrgId>
const OrgIdParameters = Type.Object({
	orgId: OrgId,
})
type OrgIdParameters = Static<typeof OrgIdParameters>
const OrganizationResponse = Type.Object({
	id: OrgId,
	name: Type.String({ description: "The organization's name" }),
	description: Type.Optional(Type.String({ description: "The organization's description" })),
	created: Type.String({ description: "The organization's creation date" }),
	updated: Type.String({ description: "The organization's last update date" }),
})
type OrganizationResponse = Static<typeof OrganizationResponse>
const OrganizationRequest = Type.Object({
	name: Type.String(),
	description: Type.Optional(Type.String()),
})
type OrganizationRequest = Static<typeof OrganizationRequest>

type ListOrganizationsRequest = FastifyRequest<{
	Querystring: PaginationQuery
}>
type GetOrganizationRequest = FastifyRequest<{ Params: OrgIdParameters }>
type CreateOrganizationRequest = FastifyRequest<{
	Body: OrganizationRequest
}>
type UpdateOrganizationRequest = FastifyRequest<{
	Params: OrgIdParameters
	Body: OrganizationRequest
}>
type DeleteOrganizationRequest = FastifyRequest<{ Params: OrgIdParameters }>

export {
	PaginationQuery,
	OrgId,
	OrgIdParameters as OrgIdParams,
	BadRequestErrorResponse,
	UnauthorizedErrorResponse,
	ForbiddenErrorResponse,
	NotFoundErrorResponse,
	ConflictErrorResponse,
	TooManyRequestsErrorResponse,
	InternalServerErrorResponse,
	ServiceUnavailableErrorResponse,
	OrganizationResponse,
	OrganizationRequest,
	type ListOrganizationsRequest,
	type GetOrganizationRequest,
	type CreateOrganizationRequest,
	type UpdateOrganizationRequest,
	type DeleteOrganizationRequest,
}
