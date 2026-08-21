import { type Static, Type } from "@sinclair/typebox";
import { Option } from "effect";
import type { DateTime } from "luxon";
import type { Transaction } from "./domain/Transaction";

const LedgerIdSchema = Type.String({ pattern: "^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
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
const TransactionListQuery = Type.Object(
	{
		offset: Type.Integer({ default: 0, minimum: 0, maximum: 10_000 }),
		limit: Type.Integer({ default: 20, minimum: 1, maximum: 100 }),
	},
	{ additionalProperties: false }
);
const TransactionCreateHeaders = Type.Object({
	"idempotency-key": Type.String({ minLength: 1, maxLength: 255 }),
});

const TransactionMetadataSchema = Type.Record(Type.String(), Type.String());
const EntryDirectionSchema = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
const AmountSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const CurrencyCodeSchema = Type.String({ minLength: 1, pattern: "\\S" });
const TransactionRequestEntry = Type.Object(
	{
		accountId: AccountIdSchema,
		direction: EntryDirectionSchema,
		amount: AmountSchema,
		currencyCode: CurrencyCodeSchema,
		metadata: Type.Optional(TransactionMetadataSchema),
	},
	{ additionalProperties: false }
);
const TransactionCreateRequest = Type.Object(
	{
		status: Type.Union([Type.Literal("pending"), Type.Literal("posted")]),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(TransactionMetadataSchema),
		ledgerEntries: Type.Array(TransactionRequestEntry, { minItems: 2 }),
	},
	{ additionalProperties: false }
);
const TransactionUpdateRequest = Type.Object(
	{
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(TransactionMetadataSchema),
		ledgerEntries: Type.Array(TransactionRequestEntry, { minItems: 2 }),
	},
	{ additionalProperties: false }
);

const MinorUnitExponentSchema = Type.Integer({ minimum: 0, maximum: 2_147_483_647 });
const TransactionResponseEntry = Type.Object(
	{
		id: EntryIdSchema,
		accountId: AccountIdSchema,
		direction: EntryDirectionSchema,
		amount: AmountSchema,
		currencyCode: CurrencyCodeSchema,
		minorUnitExponent: MinorUnitExponentSchema,
		metadata: Type.Optional(TransactionMetadataSchema),
	},
	{ additionalProperties: false }
);
const TransactionResponse = Type.Object(
	{
		id: TransactionIdSchema,
		ledgerId: LedgerIdSchema,
		description: Type.Optional(Type.String()),
		status: Type.Union([Type.Literal("pending"), Type.Literal("posted"), Type.Literal("voided")]),
		metadata: Type.Optional(TransactionMetadataSchema),
		ledgerEntries: Type.Array(TransactionResponseEntry, { minItems: 2 }),
		postedAt: Type.Optional(Type.String({ format: "date-time" })),
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

const toIso = (value: DateTime): string => {
	const encoded = value.toISO();
	if (encoded === null) throw new Error("Transaction contains an invalid timestamp");
	return encoded;
};

const toTransactionListItemResponse = (transaction: Transaction): TransactionListItemResponse => ({
	id: transaction.id.toString(),
	ledgerId: transaction.ledgerId.toString(),
	...(transaction.description === undefined ? {} : { description: transaction.description }),
	status: transaction.status,
	...(transaction.metadata === undefined ? {} : { metadata: transaction.metadata }),
	...(transaction.postedAt === undefined ? {} : { postedAt: toIso(transaction.postedAt) }),
	created: toIso(transaction.created),
	updated: toIso(transaction.updated),
});

const toTransactionResponse = (transaction: Transaction): TransactionResponse => ({
	...toTransactionListItemResponse(transaction),
	ledgerEntries: Option.getOrThrow(transaction.entries).map(entry => ({
		id: entry.id.toString(),
		accountId: entry.accountId.toString(),
		direction: entry.direction,
		amount: entry.amount,
		currencyCode: entry.currency.code,
		minorUnitExponent: entry.currency.minorUnitExponent,
		...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
	})),
});

export {
	AccountIdSchema,
	AmountSchema,
	EntryIdSchema,
	LedgerIdSchema,
	TransactionCollectionParameters,
	TransactionCreateHeaders,
	TransactionCreateRequest,
	TransactionDeleteResponse,
	TransactionIdSchema,
	TransactionItemParameters,
	TransactionListQuery,
	TransactionListItemResponse,
	TransactionListResponse,
	TransactionMetadataSchema,
	TransactionUpdateRequest,
	TransactionRequestEntry,
	TransactionResponse,
	TransactionResponseEntry,
	toTransactionListItemResponse,
	toTransactionResponse,
};
