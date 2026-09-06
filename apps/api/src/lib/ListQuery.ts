import { type Static, Type } from "@sinclair/typebox";

/** Shared bounded offset pagination with defaults of zero offset and 20 results. */
const ListQuery = Type.Object({
	offset: Type.Integer({ default: 0, minimum: 0, maximum: 10_000 }),
	limit: Type.Integer({ default: 20, minimum: 1, maximum: 100 }),
});

/** Validated values derived from the ListQuery transport schema. */
type ListQuery = Static<typeof ListQuery>;

export { ListQuery };
