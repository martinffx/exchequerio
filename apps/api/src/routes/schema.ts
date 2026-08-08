import { type Static, Type } from "@sinclair/typebox";
import type { FastifyRequest } from "fastify";

const PaginationQuery = Type.Object({
	offset: Type.Number({ default: 0 }),
	limit: Type.Number({ default: 20 }),
});
type PaginationQuery = Static<typeof PaginationQuery>;

const OrgId = Type.String({
	description: "The organization's ID",
	pattern: "^org_[0-9a-z]{26}$",
});
type OrgId = Static<typeof OrgId>;
const OrgIdParameters = Type.Object({
	orgId: OrgId,
});
type OrgIdParameters = Static<typeof OrgIdParameters>;
const OrganizationResponse = Type.Object({
	id: OrgId,
	name: Type.String({ description: "The organization's name" }),
	description: Type.Optional(Type.String({ description: "The organization's description" })),
	created: Type.String({ description: "The organization's creation date" }),
	updated: Type.String({ description: "The organization's last update date" }),
});
type OrganizationResponse = Static<typeof OrganizationResponse>;
const OrganizationRequest = Type.Object({
	name: Type.String(),
	description: Type.Optional(Type.String()),
});
type OrganizationRequest = Static<typeof OrganizationRequest>;

type ListOrganizationsRequest = FastifyRequest<{
	Querystring: PaginationQuery;
}>;
type GetOrganizationRequest = FastifyRequest<{ Params: OrgIdParameters }>;
type CreateOrganizationRequest = FastifyRequest<{
	Body: OrganizationRequest;
}>;
type UpdateOrganizationRequest = FastifyRequest<{
	Params: OrgIdParameters;
	Body: OrganizationRequest;
}>;
type DeleteOrganizationRequest = FastifyRequest<{ Params: OrgIdParameters }>;

export {
	PaginationQuery,
	OrgId,
	OrgIdParameters as OrgIdParams,
	OrganizationResponse,
	OrganizationRequest,
	type ListOrganizationsRequest,
	type GetOrganizationRequest,
	type CreateOrganizationRequest,
	type UpdateOrganizationRequest,
	type DeleteOrganizationRequest,
};
