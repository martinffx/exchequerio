import { type Static, Type } from "@sinclair/typebox";

const ListQuery = Type.Object({
	offset: Type.Integer({ default: 0, minimum: 0, maximum: 10_000 }),
	limit: Type.Integer({ default: 20, minimum: 1, maximum: 100 }),
});

type ListQuery = Static<typeof ListQuery>;

export { ListQuery };
