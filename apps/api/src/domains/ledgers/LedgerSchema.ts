import { Schema } from "effect";
import { ListQuery } from "@/lib/ListQuery";
import { MetadataSchema, OmittedWhenUndefined } from "@/lib/schema";

/** Canonical Ledger TypeID used by Ledger-scoped routes. */
const LedgerIdSchema = Schema.String.check(Schema.isPattern(/^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$/));
const LedgerIdParameters = Schema.Struct({ ledgerId: LedgerIdSchema });
/** Shared pagination for Ledger collections. */
const LedgerListQuery = ListQuery;
const LedgerCreateRequest = Schema.Struct({
	name: Schema.String,
	description: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(MetadataSchema),
});
const LedgerUpdateRequest = Schema.Struct({
	name: Schema.String,
	description: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(MetadataSchema),
});
const LedgerResponse = Schema.Struct({
	id: LedgerIdSchema,
	name: Schema.String,
	description: OmittedWhenUndefined(Schema.String),
	metadata: OmittedWhenUndefined(MetadataSchema),
	created: Schema.String.annotate({ format: "date-time" }),
	updated: Schema.String.annotate({ format: "date-time" }),
});

type LedgerIdParameters = typeof LedgerIdParameters.Type;
type LedgerListQuery = typeof LedgerListQuery.Type;
type LedgerCreateRequest = typeof LedgerCreateRequest.Type;
type LedgerUpdateRequest = typeof LedgerUpdateRequest.Type;
type LedgerResponse = typeof LedgerResponse.Type;

export {
	LedgerCreateRequest,
	LedgerIdParameters,
	LedgerIdSchema,
	LedgerListQuery,
	LedgerResponse,
	LedgerUpdateRequest,
};
