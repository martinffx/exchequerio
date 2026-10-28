import { Option, Schema, SchemaGetter } from "effect";

const OrganizationIdSchema = Schema.String.check(Schema.isPattern(/^org_[0-9a-z]{26}$/));
const OrganizationIdParameters = Schema.Struct({ orgId: OrganizationIdSchema });
/**
 * A query integer whose absence decodes to `fallback`. `withDecodingDefaultKey` keeps the decoded key
 * required, which OpenAPI documents as `required: true`; here the key stays optional in the schema AST
 * (so it is documented as optional) while decoding always supplies a value, hence the narrowed type.
 */
const defaultedQueryInt = (
	schema: Schema.Codec<number, number>,
	fallback: number
): Schema.Codec<number, number> =>
	Schema.optionalKey(schema).pipe(
		Schema.decodeTo(Schema.optionalKey(schema), {
			decode: SchemaGetter.transformOptional(option => Option.orElseSome(option, () => fallback)),
			encode: SchemaGetter.passthrough(),
		})
	) as unknown as Schema.Codec<number, number>;
const OrganizationListQuery = Schema.Struct({
	offset: defaultedQueryInt(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), 0),
	limit: defaultedQueryInt(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })), 20),
});
const OrganizationCreateRequest = Schema.Struct({
	name: Schema.String,
	description: Schema.optionalKey(Schema.String),
});
const OrganizationUpdateRequest = Schema.Struct({
	name: Schema.String,
	description: Schema.optionalKey(Schema.String),
});
// `toResponse()` emits `description: undefined` when absent; the key must be omitted from the body.
const OmittedWhenUndefined = Schema.optionalKey(Schema.String).pipe(
	Schema.decodeTo(Schema.optional(Schema.String), {
		decode: SchemaGetter.passthrough(),
		encode: SchemaGetter.transformOptional(Option.filter(value => value !== undefined)),
	})
);
const OrganizationResponse = Schema.Struct({
	id: OrganizationIdSchema,
	name: Schema.String,
	description: OmittedWhenUndefined,
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
