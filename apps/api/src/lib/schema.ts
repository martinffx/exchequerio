import { Option, Schema, SchemaGetter } from "effect";
import { defaultedQueryNumber } from "./ListQuery";

const PaginationQuery = Schema.Struct({
	offset: defaultedQueryNumber(Schema.Finite, 0),
	limit: defaultedQueryNumber(Schema.Finite, 20),
});
type PaginationQuery = typeof PaginationQuery.Type;

const MetadataSchema = Schema.Record(Schema.String, Schema.String).annotate({
	description:
		"Additional data represented as key-value pairs. Both the key and value must be strings.",
});
type Metadata = Readonly<typeof MetadataSchema.Type>;

// `toResponse()` emits `undefined` for an absent field; the key must be omitted from the body.
const OmittedWhenUndefined = <S extends Schema.Top>(schema: S) =>
	Schema.optionalKey(schema).pipe(
		Schema.decodeTo(Schema.optional(schema), {
			decode: SchemaGetter.passthrough(),
			encode: SchemaGetter.transformOptional(Option.filter(value => value !== undefined)),
		})
	);

const dateTimePattern =
	/^(\d{4})-(\d{2})-(\d{2})[Tt]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3])(?::?[0-5]\d)?)$/;

const isCalendarDate = (value: string): boolean => {
	const match = dateTimePattern.exec(value);
	if (match === null) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	date.setUTCFullYear(year);
	return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/**
 * RFC 3339 `date-time` matching the ajv-formats `date-time` check: a timezone is required,
 * a space separator and leap seconds are not accepted. `format` is annotated before `.check` so the
 * OpenAPI schema keeps it.
 */
const DateTimeString = Schema.String.annotate({ format: "date-time" }).check(
	Schema.makeFilter(value => isCalendarDate(value) || "Expected a valid RFC 3339 date-time")
);

export { DateTimeString, MetadataSchema, OmittedWhenUndefined, PaginationQuery };
export type { Metadata };
