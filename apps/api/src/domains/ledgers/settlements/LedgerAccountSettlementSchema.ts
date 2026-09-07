import { type Static, Type } from "@sinclair/typebox";
import { ListQuery } from "@/lib/ListQuery";
import { MetadataSchema } from "@/lib/schema";
import { LedgerIdSchema } from "../LedgerSchema";
import { AccountIdSchema } from "../accounts/AccountSchema";

/** Debit or credit direction used by Accounts and Entries. */
const NormalBalance = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
/** Persisted Settlement lifecycle states, including resumable processing. */
const SettlementStatus = Type.Union([
	Type.Literal("drafting"),
	Type.Literal("processing"),
	Type.Literal("pending"),
	Type.Literal("posted"),
	Type.Literal("voided"),
]);
/** Accounting statuses a Settlement transition may target. */
const SettlementTargetStatus = Type.Union([
	Type.Literal("pending"),
	Type.Literal("posted"),
	Type.Literal("voided"),
]);
/** Canonical Settlement TypeID wire format. */
const LedgerAccountSettlementId = Type.String({ pattern: "^las_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
/** Settlement identifier in an item route. */
const LedgerAccountSettlementIdParams = Type.Object({ settlementId: LedgerAccountSettlementId });
/** Ledger scope in Settlement routes. */
const LedgerAccountSettlementCollectionParameters = Type.Object({ ledgerId: LedgerIdSchema });
/** Shared offset and limit validation for Settlement pages. */
const LedgerAccountSettlementListQuery = ListQuery;
/** ISO date-time accepted by the entity parser, excluding leap seconds. */
const Timestamp = Type.String({ format: "date-time", pattern: "[Tt][0-9]{2}:[0-9]{2}:[0-5][0-9]" });
/** Creation payload; defaults to pending with automatic source selection. */
const LedgerAccountSettlementRequest = Type.Object(
	{
		settledAccountId: AccountIdSchema,
		contraAccountId: AccountIdSchema,
		status: Type.Optional(
			Type.Union([Type.Literal("drafting"), Type.Literal("pending"), Type.Literal("posted")], {
				default: "pending",
			})
		),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
		externalReference: Type.Optional(Type.String()),
		effectiveAtUpperBound: Type.Optional(Timestamp),
		allowEitherDirection: Type.Optional(Type.Boolean({ default: false })),
	},
	{ additionalProperties: false, $id: "LedgerAccountSettlementRequest" }
);
/** Editable Settlement fields and optional lifecycle target. */
const LedgerAccountSettlementPatchRequest = Type.Object(
	{
		status: Type.Optional(SettlementTargetStatus),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
	},
	{ additionalProperties: false }
);
/** Settlement response with nullable accounting fields derived from its Transaction. */
const LedgerAccountSettlementResponse = Type.Object(
	{
		id: LedgerAccountSettlementId,
		ledgerId: LedgerIdSchema,
		transactionId: Type.Union([
			Type.String({ pattern: "^ltr_[0-7][0-9a-hjkmnp-tv-z]{25}$" }),
			Type.Null(),
		]),
		status: SettlementStatus,
		settledAccountId: AccountIdSchema,
		contraAccountId: AccountIdSchema,
		amount: Type.Union([Type.Integer(), Type.Null()]),
		settlementEntryDirection: Type.Union([NormalBalance, Type.Null()]),
		currency: Type.String(),
		allowEitherDirection: Type.Boolean(),
		effectiveAtUpperBound: Type.Union([Timestamp, Type.Null()]),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
		externalReference: Type.Optional(Type.String()),
		created: Timestamp,
		updated: Timestamp,
	},
	{ $id: "LedgerAccountSettlementResponse" }
);
/** One to 500 distinct source Entry IDs for a draft membership edit. */
const LedgerAccountSettlementEntriesRequest = Type.Object(
	{
		entries: Type.Array(Type.String({ pattern: "^lte_[0-7][0-9a-hjkmnp-tv-z]{25}$" }), {
			minItems: 1,
			maxItems: 500,
			uniqueItems: true,
		}),
	},
	{ additionalProperties: false }
);
/** Posted source Entry representation with its Transaction effective time. */
const LedgerAccountSettlementEntryResponse = Type.Object({
	id: Type.String(),
	transactionId: Type.String(),
	effectiveAt: Timestamp,
	accountId: AccountIdSchema,
	direction: NormalBalance,
	amount: Type.Integer(),
	currencyCode: Type.String(),
	status: Type.Literal("posted"),
	metadata: Type.Optional(MetadataSchema),
	created: Timestamp,
});
/** TypeScript values validated by the LedgerAccountSettlementId schema. */
type LedgerAccountSettlementId = Static<typeof LedgerAccountSettlementId>;
/** TypeScript values validated by the LedgerAccountSettlementIdParams schema. */
type LedgerAccountSettlementIdParams = Static<typeof LedgerAccountSettlementIdParams>;
/** TypeScript values validated by the LedgerAccountSettlementCollectionParameters schema. */
type LedgerAccountSettlementCollectionParameters = Static<
	typeof LedgerAccountSettlementCollectionParameters
>;
/** TypeScript values validated by the LedgerAccountSettlementListQuery schema. */
type LedgerAccountSettlementListQuery = Static<typeof LedgerAccountSettlementListQuery>;
/** TypeScript values validated by the LedgerAccountSettlementRequest schema. */
type LedgerAccountSettlementRequest = Static<typeof LedgerAccountSettlementRequest>;
/** TypeScript values validated by the LedgerAccountSettlementPatchRequest schema. */
type LedgerAccountSettlementPatchRequest = Static<typeof LedgerAccountSettlementPatchRequest>;
/** TypeScript values validated by the LedgerAccountSettlementResponse schema. */
type LedgerAccountSettlementResponse = Static<typeof LedgerAccountSettlementResponse>;
/** TypeScript values validated by the LedgerAccountSettlementEntriesRequest schema. */
type LedgerAccountSettlementEntriesRequest = Static<typeof LedgerAccountSettlementEntriesRequest>;
/** TypeScript values validated by the LedgerAccountSettlementEntryResponse schema. */
type LedgerAccountSettlementEntryResponse = Static<typeof LedgerAccountSettlementEntryResponse>;
/** TypeScript values validated by the NormalBalance schema. */
type NormalBalance = Static<typeof NormalBalance>;
/** TypeScript values validated by the SettlementStatus schema. */
type SettlementStatus = Static<typeof SettlementStatus>;
/** TypeScript values validated by the SettlementTargetStatus schema. */
type SettlementTargetStatus = Static<typeof SettlementTargetStatus>;
export {
	LedgerAccountSettlementEntriesRequest,
	LedgerAccountSettlementCollectionParameters,
	LedgerAccountSettlementId,
	LedgerAccountSettlementIdParams,
	LedgerAccountSettlementListQuery,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementPatchRequest,
	LedgerAccountSettlementResponse,
	LedgerAccountSettlementEntryResponse,
	NormalBalance,
	SettlementStatus,
	SettlementTargetStatus,
};
