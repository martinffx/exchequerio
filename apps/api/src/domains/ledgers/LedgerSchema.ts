import { type Static, Type } from "@sinclair/typebox";
import { ListQuery } from "@/lib/ListQuery";

const LedgerIdSchema = Type.String({ pattern: "^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const LedgerIdParameters = Type.Object({ ledgerId: LedgerIdSchema });
const LedgerListQuery = ListQuery;
const LedgerMetadataSchema = Type.Record(Type.String(), Type.String());
const LedgerCreateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(LedgerMetadataSchema),
	},
	{ additionalProperties: false }
);
const LedgerUpdateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(LedgerMetadataSchema),
	},
	{ additionalProperties: false }
);
const LedgerResponse = Type.Object({
	id: LedgerIdSchema,
	name: Type.String(),
	description: Type.Optional(Type.String()),
	metadata: Type.Optional(LedgerMetadataSchema),
	created: Type.String({ format: "date-time" }),
	updated: Type.String({ format: "date-time" }),
});

type LedgerIdParameters = Static<typeof LedgerIdParameters>;
type LedgerListQuery = Static<typeof LedgerListQuery>;
type LedgerCreateRequest = Static<typeof LedgerCreateRequest>;
type LedgerUpdateRequest = Static<typeof LedgerUpdateRequest>;
type LedgerResponse = Static<typeof LedgerResponse>;

export {
	LedgerCreateRequest,
	LedgerIdParameters,
	LedgerIdSchema,
	LedgerListQuery,
	LedgerMetadataSchema,
	LedgerResponse,
	LedgerUpdateRequest,
};
