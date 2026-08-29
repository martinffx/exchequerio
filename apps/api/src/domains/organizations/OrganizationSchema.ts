import { type Static, Type } from "@sinclair/typebox";

const OrganizationIdSchema = Type.String({ pattern: "^org_[0-9a-z]{26}$" });
const OrganizationIdParameters = Type.Object({ orgId: OrganizationIdSchema });
const OrganizationListQuery = Type.Object({
	offset: Type.Integer({ default: 0, minimum: 0 }),
	limit: Type.Integer({ default: 20, minimum: 1, maximum: 100 }),
});
const OrganizationCreateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
	},
	{ additionalProperties: false }
);
const OrganizationUpdateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
	},
	{ additionalProperties: false }
);
const OrganizationResponse = Type.Object({
	id: OrganizationIdSchema,
	name: Type.String(),
	description: Type.Optional(Type.String()),
	created: Type.String({ format: "date-time" }),
	updated: Type.String({ format: "date-time" }),
});

type OrganizationIdParameters = Static<typeof OrganizationIdParameters>;
type OrganizationListQuery = Static<typeof OrganizationListQuery>;
type OrganizationCreateRequest = Static<typeof OrganizationCreateRequest>;
type OrganizationUpdateRequest = Static<typeof OrganizationUpdateRequest>;
type OrganizationResponse = Static<typeof OrganizationResponse>;

export {
	OrganizationCreateRequest,
	OrganizationIdParameters,
	OrganizationIdSchema,
	OrganizationListQuery,
	OrganizationResponse,
	OrganizationUpdateRequest,
};
