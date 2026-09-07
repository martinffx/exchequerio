import { type Static, Type } from "@sinclair/typebox";
import { IdempotencyHeaders } from "@/lib/IdempotencySchema";
import { ListQuery } from "@/lib/ListQuery";
import { MetadataSchema } from "@/lib/schema";
import { LedgerIdSchema } from "../LedgerSchema";

const TransactionIdSchema = Type.String({ pattern: "^ltr_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const AccountIdSchema = Type.String({ pattern: "^lat_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const EntryIdSchema = Type.String({ pattern: "^lte_[0-7][0-9a-hjkmnp-tv-z]{25}$" });

const TransactionCollectionParameters = Type.Object(
	{ ledgerId: LedgerIdSchema },
	{ additionalProperties: false }
);
const TransactionItemParameters = Type.Object(
	{ ledgerId: LedgerIdSchema, transactionId: TransactionIdSchema },
	{ additionalProperties: false }
);
const TransactionListQuery = Type.Object(ListQuery.properties, {
	additionalProperties: false,
});
const TransactionCreateHeaders = IdempotencyHeaders;

const EntryDirectionSchema = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
const AmountSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const CurrencyCodeSchema = Type.String({ minLength: 1, pattern: "\\S" });
const EffectiveAtSchema = Type.String({
	format: "date-time",
	// RFC 3339 also permits space separators and leap seconds, which Luxon cannot parse.
	pattern: "[Tt][0-9]{2}:[0-9]{2}:[0-5][0-9]",
});
const TransactionRequestEntry = Type.Object(
	{
		accountId: AccountIdSchema,
		direction: EntryDirectionSchema,
		amount: AmountSchema,
		currencyCode: CurrencyCodeSchema,
		metadata: Type.Optional(MetadataSchema),
	},
	{ additionalProperties: false }
);
const TransactionCreateRequest = Type.Object(
	{
		status: Type.Union([Type.Literal("pending"), Type.Literal("posted")]),
		effectiveAt: Type.Optional(EffectiveAtSchema),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
		ledgerEntries: Type.Array(TransactionRequestEntry, { minItems: 2, maxItems: 200 }),
	},
	{ additionalProperties: false }
);
const TransactionUpdateRequest = Type.Object(
	{
		effectiveAt: Type.Optional(EffectiveAtSchema),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
		ledgerEntries: Type.Array(TransactionRequestEntry, { minItems: 2, maxItems: 200 }),
	},
	{ additionalProperties: false }
);

const TransactionResponseEntry = Type.Object(
	{
		id: EntryIdSchema,
		accountId: AccountIdSchema,
		direction: EntryDirectionSchema,
		amount: AmountSchema,
		currencyCode: CurrencyCodeSchema,
		metadata: Type.Optional(MetadataSchema),
	},
	{ additionalProperties: false }
);
const TransactionResponse = Type.Object(
	{
		id: TransactionIdSchema,
		ledgerId: LedgerIdSchema,
		description: Type.Optional(Type.String()),
		status: Type.Union([Type.Literal("pending"), Type.Literal("posted"), Type.Literal("voided")]),
		metadata: Type.Optional(MetadataSchema),
		ledgerEntries: Type.Array(TransactionResponseEntry, { minItems: 2 }),
		postedAt: Type.Optional(Type.String({ format: "date-time" })),
		effectiveAt: Type.String({ format: "date-time" }),
		created: Type.String({ format: "date-time" }),
		updated: Type.String({ format: "date-time" }),
	},
	{ additionalProperties: false }
);
const TransactionListItemResponse = Type.Omit(TransactionResponse, ["ledgerEntries"]);
const TransactionListResponse = Type.Array(TransactionListItemResponse);
const TransactionDeleteResponse = Type.Null();

type TransactionCollectionParameters = Static<typeof TransactionCollectionParameters>;
type TransactionItemParameters = Static<typeof TransactionItemParameters>;
type TransactionListQuery = Static<typeof TransactionListQuery>;
type TransactionCreateHeaders = Static<typeof TransactionCreateHeaders>;
type TransactionRequestEntry = Static<typeof TransactionRequestEntry>;
type TransactionCreateRequest = Static<typeof TransactionCreateRequest>;
type TransactionUpdateRequest = Static<typeof TransactionUpdateRequest>;
type TransactionResponseEntry = Static<typeof TransactionResponseEntry>;
type TransactionResponse = Static<typeof TransactionResponse>;
type TransactionListItemResponse = Static<typeof TransactionListItemResponse>;
type TransactionListResponse = Static<typeof TransactionListResponse>;
type TransactionDeleteResponse = Static<typeof TransactionDeleteResponse>;

export {
	AccountIdSchema,
	AmountSchema,
	EntryIdSchema,
	TransactionCollectionParameters,
	TransactionCreateHeaders,
	TransactionCreateRequest,
	TransactionDeleteResponse,
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
