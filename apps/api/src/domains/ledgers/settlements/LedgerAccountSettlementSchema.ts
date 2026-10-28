import { Effect, Schema } from "effect";
import { AssetSummarySchema } from "@/lib/AssetSchema";
import { PositiveAmountSchema } from "@/lib/amounts";
import { IdempotencyHeaders } from "@/lib/IdempotencySchema";
import { ListQuery } from "@/lib/ListQuery";
import { DateTimeString, MetadataSchema, OmittedWhenUndefined } from "@/lib/schema";
import { LedgerIdSchema } from "../LedgerSchema";
import { AccountIdSchema } from "../accounts/AccountSchema";

/** Debit or credit direction used by Accounts and Entries. */
const NormalBalance = Schema.Literals(["debit", "credit"]);
/** Persisted Settlement lifecycle states, including resumable processing. */
const SettlementStatus = Schema.Literals(["drafting", "processing", "pending", "posted", "voided"]);
/** Accounting statuses a Settlement transition may target. */
const SettlementTargetStatus = Schema.Literals(["pending", "posted", "voided"]);
/** Canonical Settlement TypeID wire format. */
const LedgerAccountSettlementId = Schema.String.check(
	Schema.isPattern(/^las_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
);
/** Ledger scope in Settlement routes. */
const LedgerAccountSettlementCollectionParameters = Schema.Struct({ ledgerId: LedgerIdSchema });
/** Ledger and Settlement identifiers in an item route. */
const LedgerAccountSettlementIdParams = Schema.Struct({
	ledgerId: LedgerIdSchema,
	settlementId: LedgerAccountSettlementId,
});
/** Shared offset and limit validation for Settlement pages. */
const LedgerAccountSettlementListQuery = ListQuery;
/** Client action key required on every Settlement write. */
const LedgerAccountSettlementWriteHeaders = IdempotencyHeaders;
/** Creation payload; defaults to pending with automatic source selection. */
const LedgerAccountSettlementRequest = Schema.Struct({
	settledAccountId: AccountIdSchema,
	contraAccountId: AccountIdSchema,
	status: Schema.Literals(["drafting", "pending", "posted"])
		.annotate({ default: "pending" })
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed("pending" as const))),
	description: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(MetadataSchema),
	externalReference: Schema.optionalKey(Schema.String),
	effectiveAtUpperBound: Schema.optionalKey(DateTimeString),
	allowEitherDirection: Schema.Boolean.annotate({ default: false }).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(false))
	),
}).annotate({ identifier: "LedgerAccountSettlementRequest" });
/** Editable Settlement fields and optional lifecycle target. */
const LedgerAccountSettlementPatchRequest = Schema.Struct({
	status: Schema.optionalKey(SettlementTargetStatus),
	description: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(MetadataSchema),
});
const responseTimestamp = Schema.String.annotate({ format: "date-time" });
/** Settlement response with nullable accounting fields derived from its Transaction. */
const LedgerAccountSettlementResponse = Schema.Struct({
	id: LedgerAccountSettlementId,
	ledgerId: LedgerIdSchema,
	transactionId: Schema.NullOr(
		Schema.String.check(Schema.isPattern(/^ltr_[0-7][0-9a-hjkmnp-tv-z]{25}$/))
	),
	status: SettlementStatus,
	settledAccountId: AccountIdSchema,
	contraAccountId: AccountIdSchema,
	amount: Schema.NullOr(PositiveAmountSchema),
	settlementEntryDirection: Schema.NullOr(NormalBalance),
	...AssetSummarySchema.fields,
	allowEitherDirection: Schema.Boolean,
	effectiveAtUpperBound: Schema.NullOr(responseTimestamp),
	description: OmittedWhenUndefined(Schema.String),
	metadata: OmittedWhenUndefined(MetadataSchema),
	externalReference: OmittedWhenUndefined(Schema.String),
	created: responseTimestamp,
	updated: responseTimestamp,
}).annotate({ identifier: "LedgerAccountSettlementResponse" });
const LedgerAccountSettlementListResponse = Schema.Array(LedgerAccountSettlementResponse);
/** One to 500 distinct source Entry IDs for a draft membership edit. */
const LedgerAccountSettlementEntriesRequest = Schema.Struct({
	entries: Schema.Array(
		Schema.String.check(Schema.isPattern(/^lte_[0-7][0-9a-hjkmnp-tv-z]{25}$/))
	).check(Schema.isMinLength(1), Schema.isMaxLength(500), Schema.isUnique()),
});
/** Posted source Entry representation with its Transaction effective time. */
const LedgerAccountSettlementEntryResponse = Schema.Struct({
	id: Schema.String,
	transactionId: Schema.String,
	effectiveAt: responseTimestamp,
	accountId: AccountIdSchema,
	direction: NormalBalance,
	amount: PositiveAmountSchema,
	...AssetSummarySchema.fields,
	status: Schema.Literal("posted"),
	metadata: OmittedWhenUndefined(MetadataSchema),
	created: responseTimestamp,
});
const LedgerAccountSettlementEntryListResponse = Schema.Array(LedgerAccountSettlementEntryResponse);

type LedgerAccountSettlementId = typeof LedgerAccountSettlementId.Type;
type LedgerAccountSettlementIdParams = typeof LedgerAccountSettlementIdParams.Type;
type LedgerAccountSettlementCollectionParameters =
	typeof LedgerAccountSettlementCollectionParameters.Type;
type LedgerAccountSettlementListQuery = typeof LedgerAccountSettlementListQuery.Type;
type LedgerAccountSettlementRequest = typeof LedgerAccountSettlementRequest.Type;
type LedgerAccountSettlementPatchRequest = typeof LedgerAccountSettlementPatchRequest.Type;
type LedgerAccountSettlementResponse = typeof LedgerAccountSettlementResponse.Type;
type LedgerAccountSettlementEntriesRequest = typeof LedgerAccountSettlementEntriesRequest.Type;
type LedgerAccountSettlementEntryResponse = typeof LedgerAccountSettlementEntryResponse.Type;
type NormalBalance = typeof NormalBalance.Type;
type SettlementStatus = typeof SettlementStatus.Type;
type SettlementTargetStatus = typeof SettlementTargetStatus.Type;

export {
	LedgerAccountSettlementEntriesRequest,
	LedgerAccountSettlementCollectionParameters,
	LedgerAccountSettlementEntryListResponse,
	LedgerAccountSettlementId,
	LedgerAccountSettlementIdParams,
	LedgerAccountSettlementListQuery,
	LedgerAccountSettlementListResponse,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementPatchRequest,
	LedgerAccountSettlementResponse,
	LedgerAccountSettlementEntryResponse,
	LedgerAccountSettlementWriteHeaders,
	NormalBalance,
	SettlementStatus,
	SettlementTargetStatus,
};
