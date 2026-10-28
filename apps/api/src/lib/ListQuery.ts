import { Option, Schema, SchemaGetter } from "effect";

/**
 * A query number whose absence decodes to `fallback`. `withDecodingDefaultKey` keeps the decoded key
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

/** Shared bounded offset pagination with defaults of zero offset and 20 results. */
const ListQuery = Schema.Struct({
	offset: defaultedQueryInt(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 })), 0),
	limit: defaultedQueryInt(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })), 20),
});

/** Validated values derived from the ListQuery transport schema. */
type ListQuery = typeof ListQuery.Type;

export { ListQuery, defaultedQueryInt };
