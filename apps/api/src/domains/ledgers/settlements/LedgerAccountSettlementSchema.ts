import { type Static, Type } from "@sinclair/typebox";
import { ListQuery } from "@/lib/ListQuery";
import { LedgerIdSchema } from "../LedgerSchema";
import { AccountIdSchema } from "../accounts/AccountSchema";

const NormalBalance = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
const SettlementStatus = Type.Union([
	Type.Literal("drafting"),
	Type.Literal("processing"),
	Type.Literal("pending"),
	Type.Literal("posted"),
	Type.Literal("voided"),
]);
const SettlementTargetStatus = Type.Union([
	Type.Literal("pending"),
	Type.Literal("posted"),
	Type.Literal("voided"),
]);
const LedgerAccountSettlementId = Type.String({ pattern: "^las_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const LedgerAccountSettlementIdParams = Type.Object({ settlementId: LedgerAccountSettlementId });
const LedgerAccountSettlementCollectionParameters = Type.Object({ ledgerId: LedgerIdSchema });
const LedgerAccountSettlementListQuery = ListQuery;
const Metadata = Type.Record(Type.String(), Type.String());
const Timestamp = Type.String({ format: "date-time", pattern: "[Tt][0-9]{2}:[0-9]{2}:[0-5][0-9]" });
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
		metadata: Type.Optional(Metadata),
		externalReference: Type.Optional(Type.String()),
		effectiveAtUpperBound: Type.Optional(Timestamp),
		allowEitherDirection: Type.Optional(Type.Boolean({ default: false })),
	},
	{ additionalProperties: false, $id: "LedgerAccountSettlementRequest" }
);
const LedgerAccountSettlementPatchRequest = Type.Object(
	{
		status: Type.Optional(SettlementTargetStatus),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(Metadata),
	},
	{ additionalProperties: false }
);
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
		metadata: Type.Optional(Metadata),
		externalReference: Type.Optional(Type.String()),
		created: Timestamp,
		updated: Timestamp,
	},
	{ $id: "LedgerAccountSettlementResponse" }
);
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
const LedgerAccountSettlementEntryResponse = Type.Object({
	id: Type.String(),
	transactionId: Type.String(),
	effectiveAt: Timestamp,
	accountId: AccountIdSchema,
	direction: NormalBalance,
	amount: Type.Integer(),
	currencyCode: Type.String(),
	status: Type.Literal("posted"),
	metadata: Type.Optional(Metadata),
	created: Timestamp,
});
type LedgerAccountSettlementId = Static<typeof LedgerAccountSettlementId>;
type LedgerAccountSettlementIdParams = Static<typeof LedgerAccountSettlementIdParams>;
type LedgerAccountSettlementCollectionParameters = Static<
	typeof LedgerAccountSettlementCollectionParameters
>;
type LedgerAccountSettlementListQuery = Static<typeof LedgerAccountSettlementListQuery>;
type LedgerAccountSettlementRequest = Static<typeof LedgerAccountSettlementRequest>;
type LedgerAccountSettlementPatchRequest = Static<typeof LedgerAccountSettlementPatchRequest>;
type LedgerAccountSettlementResponse = Static<typeof LedgerAccountSettlementResponse>;
type LedgerAccountSettlementEntriesRequest = Static<typeof LedgerAccountSettlementEntriesRequest>;
type LedgerAccountSettlementEntryResponse = Static<typeof LedgerAccountSettlementEntryResponse>;
type NormalBalance = Static<typeof NormalBalance>;
type SettlementStatus = Static<typeof SettlementStatus>;
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
