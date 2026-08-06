import { type Static, Type } from "@sinclair/typebox";
import type { DateTime } from "luxon";
import { problemDetailSchema } from "../http/ProblemDetails";
import type { Organization } from "./domain/Organization";

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

const BadRequestProblem = problemDetailSchema("BAD_REQUEST", 400);
const UnauthorizedProblem = problemDetailSchema("UNAUTHORIZED", 401);
const ForbiddenProblem = problemDetailSchema("FORBIDDEN", 403);
const NotFoundProblem = problemDetailSchema("NOT_FOUND", 404);
const ConflictProblem = problemDetailSchema("CONFLICT", 409);
const TooManyRequestsProblem = problemDetailSchema("TOO_MANY_REQUESTS", 429);
const InternalServerProblem = problemDetailSchema("INTERNAL_SERVER_ERROR", 500);
const ServiceUnavailableProblem = problemDetailSchema("SERVICE_UNAVAILABLE", 503);

type OrganizationIdParameters = Static<typeof OrganizationIdParameters>;
type OrganizationListQuery = Static<typeof OrganizationListQuery>;
type OrganizationCreateRequest = Static<typeof OrganizationCreateRequest>;
type OrganizationUpdateRequest = Static<typeof OrganizationUpdateRequest>;
type OrganizationResponse = Static<typeof OrganizationResponse>;

const toIso = (value: DateTime): string => {
	const encoded = value.toISO();
	if (encoded === null) throw new Error("Organization contains an invalid timestamp");
	return encoded;
};

const toOrganizationResponse = (organization: Organization): OrganizationResponse => ({
	id: organization.id,
	name: organization.name,
	...(organization.description === undefined ? {} : { description: organization.description }),
	created: toIso(organization.created),
	updated: toIso(organization.updated),
});

export {
	BadRequestProblem,
	ConflictProblem,
	ForbiddenProblem,
	InternalServerProblem,
	NotFoundProblem,
	OrganizationCreateRequest,
	OrganizationIdParameters,
	OrganizationIdSchema,
	OrganizationListQuery,
	OrganizationResponse,
	OrganizationUpdateRequest,
	ServiceUnavailableProblem,
	TooManyRequestsProblem,
	UnauthorizedProblem,
	toOrganizationResponse,
};
