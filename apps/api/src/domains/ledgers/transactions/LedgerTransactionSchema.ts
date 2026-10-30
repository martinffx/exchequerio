import { Schema } from "effect";
import { AssetSelectorSchema, AssetSummarySchema, type AssetSummary } from "@/lib/AssetSchema";
import { PositiveAmountSchema as AmountSchema } from "@/lib/amounts";
import { IdempotencyHeaders } from "@/lib/IdempotencySchema";
import { ListQuery } from "@/lib/ListQuery";
import { DateTimeString, MetadataSchema, OmittedWhenUndefined } from "@/lib/schema";
import { LedgerIdSchema } from "../LedgerSchema";

const TransactionIdSchema = Schema.String.check(
	Schema.isPattern(/^ltr_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
);
const AccountIdSchema = Schema.String.check(Schema.isPattern(/^lat_[0-7][0-9a-hjkmnp-tv-z]{25}$/));
const EntryIdSchema = Schema.String.check(Schema.isPattern(/^lte_[0-7][0-9a-hjkmnp-tv-z]{25}$/));

const TransactionCollectionParameters = Schema.Struct({ ledgerId: LedgerIdSchema });
const TransactionItemParameters = Schema.Struct({
	ledgerId: LedgerIdSchema,
	transactionId: TransactionIdSchema,
});
const TransactionListQuery = ListQuery;
const TransactionCreateHeaders = IdempotencyHeaders;

const EntryDirectionSchema = Schema.Literals(["debit", "credit"]);
const EffectiveAtSchema = DateTimeString;
const requestEntryFields = {
	accountId: AccountIdSchema,
	direction: EntryDirectionSchema,
	amount: AmountSchema,
	metadata: Schema.optionalKey(MetadataSchema),
};
// Exactly one Asset selector: each member of the shared selector union gets the entry fields.
const [assetIdSelector, assetCodeSelector] = AssetSelectorSchema.members;
const TransactionRequestEntry = Schema.Union([
	Schema.Struct({ ...assetIdSelector.fields, ...requestEntryFields }),
	Schema.Struct({ ...assetCodeSelector.fields, ...requestEntryFields }),
]);
const requestEntries = Schema.Array(TransactionRequestEntry).check(
	Schema.isMinLength(2),
	Schema.isMaxLength(200)
);
const TransactionCreateRequest = Schema.Struct({
	status: Schema.Literals(["pending", "posted"]),
	effectiveAt: Schema.optionalKey(EffectiveAtSchema),
	description: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(MetadataSchema),
	ledgerEntries: requestEntries,
});
const TransactionUpdateRequest = Schema.Struct({
	effectiveAt: Schema.optionalKey(EffectiveAtSchema),
	description: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(MetadataSchema),
	ledgerEntries: requestEntries,
});

const TransactionResponseEntry = Schema.Struct({
	id: EntryIdSchema,
	accountId: AccountIdSchema,
	direction: EntryDirectionSchema,
	amount: AmountSchema,
	...AssetSummarySchema.fields,
	metadata: OmittedWhenUndefined(MetadataSchema),
});
const transactionResponseFields = {
	id: TransactionIdSchema,
	ledgerId: LedgerIdSchema,
	description: OmittedWhenUndefined(Schema.String),
	status: Schema.Literals(["pending", "posted", "voided"]),
	metadata: OmittedWhenUndefined(MetadataSchema),
	postedAt: OmittedWhenUndefined(Schema.String.annotate({ format: "date-time" })),
	effectiveAt: Schema.String.annotate({ format: "date-time" }),
	created: Schema.String.annotate({ format: "date-time" }),
	updated: Schema.String.annotate({ format: "date-time" }),
};
const TransactionResponse = Schema.Struct({
	...transactionResponseFields,
	ledgerEntries: Schema.Array(TransactionResponseEntry).check(Schema.isMinLength(2)),
});
const TransactionListItemResponse = Schema.Struct(transactionResponseFields);
const TransactionListResponse = Schema.Array(TransactionListItemResponse);

type TransactionCollectionParameters = typeof TransactionCollectionParameters.Type;
type TransactionItemParameters = typeof TransactionItemParameters.Type;
type TransactionListQuery = typeof TransactionListQuery.Type;
type TransactionCreateHeaders = typeof TransactionCreateHeaders.Type;
type TransactionRequestEntry = typeof TransactionRequestEntry.Type;
type TransactionCreateRequest = typeof TransactionCreateRequest.Type;
type TransactionUpdateRequest = typeof TransactionUpdateRequest.Type;
type TransactionResponseEntry = typeof TransactionResponseEntry.Type;
type TransactionResponse = typeof TransactionResponse.Type;
type TransactionListItemResponse = typeof TransactionListItemResponse.Type;
type TransactionListResponse = typeof TransactionListResponse.Type;

export {
	AccountIdSchema,
	EntryIdSchema,
	TransactionCollectionParameters,
	TransactionCreateHeaders,
	TransactionCreateRequest,
	TransactionIdSchema,
	TransactionItemParameters,
	TransactionListQuery,
	TransactionListItemResponse,
	TransactionListResponse,
	TransactionUpdateRequest,
	TransactionRequestEntry,
	TransactionResponse,
	TransactionResponseEntry,
};

export { PositiveAmountSchema as AmountSchema } from "@/lib/amounts";

export type ResolvedTransactionRequestEntry = Omit<
	TransactionRequestEntry,
	"assetId" | "assetCode"
> &
	AssetSummary;
export type ResolvedTransactionCreateRequest = Omit<TransactionCreateRequest, "ledgerEntries"> & {
	ledgerEntries: ResolvedTransactionRequestEntry[];
};
export type ResolvedTransactionUpdateRequest = Omit<TransactionUpdateRequest, "ledgerEntries"> & {
	ledgerEntries: ResolvedTransactionRequestEntry[];
};
