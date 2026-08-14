import { type Static, Type } from "@sinclair/typebox";
import type { Ledger } from "./domain/Ledger";

const LedgerIdSchema = Type.String({ pattern: "^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const LedgerIdParameters = Type.Object({ ledgerId: LedgerIdSchema });
const LedgerListQuery = Type.Object({
	offset: Type.Integer({ default: 0, minimum: 0, maximum: 10_000 }),
	limit: Type.Integer({ default: 20, minimum: 1, maximum: 100 }),
});
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

const toLedgerResponse = (ledger: Ledger): LedgerResponse => ({
	id: ledger.id.toString(),
	name: ledger.name,
	...(ledger.description === undefined ? {} : { description: ledger.description }),
	...(ledger.metadata === undefined ? {} : { metadata: ledger.metadata }),
	created: ledger.created.toISOString(),
	updated: ledger.updated.toISOString(),
});

export {
	LedgerCreateRequest,
	LedgerIdParameters,
	LedgerIdSchema,
	LedgerListQuery,
	LedgerMetadataSchema,
	LedgerResponse,
	LedgerUpdateRequest,
	toLedgerResponse,
};
