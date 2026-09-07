import { type Static, Type } from "@sinclair/typebox";

const PaginationQuery = Type.Object({
	offset: Type.Number({ default: 0 }),
	limit: Type.Number({ default: 20 }),
});
type PaginationQuery = Static<typeof PaginationQuery>;

const MetadataSchema = Type.Record(Type.String(), Type.String(), {
	description:
		"Additional data represented as key-value pairs. Both the key and value must be strings.",
});
type Metadata = Readonly<Static<typeof MetadataSchema>>;

export { MetadataSchema, PaginationQuery };
export type { Metadata };
