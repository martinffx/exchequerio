import { type Static, Type } from "@sinclair/typebox";
import { ListQuery } from "@/lib/ListQuery";
import { MetadataSchema } from "@/lib/schema";

/** Canonical Ledger TypeID used by Ledger-scoped routes. */
const LedgerIdSchema = Type.String({ pattern: "^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const LedgerIdParameters = Type.Object({ ledgerId: LedgerIdSchema });
/** Shared pagination for Ledger collections. */
const LedgerListQuery = ListQuery;
const LedgerCreateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
	},
	{ additionalProperties: false }
);
const LedgerUpdateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
	},
	{ additionalProperties: false }
);
const LedgerResponse = Type.Object({
	id: LedgerIdSchema,
	name: Type.String(),
	description: Type.Optional(Type.String()),
	metadata: Type.Optional(MetadataSchema),
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
	LedgerResponse,
	LedgerUpdateRequest,
};
