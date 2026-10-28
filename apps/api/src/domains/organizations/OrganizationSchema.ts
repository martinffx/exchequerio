import { Schema } from "effect";
import { defaultedQueryNumber } from "@/lib/ListQuery";
import { OmittedWhenUndefined } from "@/lib/schema";

const OrganizationIdSchema = Schema.String.check(Schema.isPattern(/^org_[0-9a-z]{26}$/));
const OrganizationIdParameters = Schema.Struct({ orgId: OrganizationIdSchema });
const OrganizationListQuery = Schema.Struct({
	offset: defaultedQueryNumber(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), 0),
	limit: defaultedQueryNumber(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })), 20),
});
const OrganizationCreateRequest = Schema.Struct({
	name: Schema.String,
	description: Schema.optionalKey(Schema.String),
});
const OrganizationUpdateRequest = Schema.Struct({
	name: Schema.String,
	description: Schema.optionalKey(Schema.String),
});
const OrganizationResponse = Schema.Struct({
	id: OrganizationIdSchema,
	name: Schema.String,
	description: OmittedWhenUndefined(Schema.String),
	created: Schema.String.annotate({ format: "date-time" }),
	updated: Schema.String.annotate({ format: "date-time" }),
});

type OrganizationIdParameters = typeof OrganizationIdParameters.Type;
type OrganizationListQuery = typeof OrganizationListQuery.Type;
type OrganizationCreateRequest = typeof OrganizationCreateRequest.Type;
type OrganizationUpdateRequest = typeof OrganizationUpdateRequest.Type;
type OrganizationResponse = typeof OrganizationResponse.Type;

export {
	OrganizationCreateRequest,
	OrganizationIdParameters,
	OrganizationIdSchema,
	OrganizationListQuery,
	OrganizationResponse,
	OrganizationUpdateRequest,
};
