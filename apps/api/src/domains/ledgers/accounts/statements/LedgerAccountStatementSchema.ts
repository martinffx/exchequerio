import { type Static, Type } from "@sinclair/typebox";
import { AssetSummarySchema } from "@/lib/AssetSchema";
import { AmountSchema, PositiveAmountSchema } from "@/lib/amounts";
import { ListQuery } from "@/lib/ListQuery";
import { MetadataSchema } from "@/lib/schema";
import { LedgerIdSchema } from "../../LedgerSchema";
import { EntryIdSchema, TransactionIdSchema } from "../../transactions/LedgerTransactionSchema";
import { AccountIdSchema } from "../AccountSchema";

const MAX_STATEMENT_ENTRIES = 10_000;
const MAX_STATEMENT_BYTES = 16 * 1024 * 1024;
const NormalBalance = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
const Balances = Type.Array(
	Type.Object(
		{
			balanceType: Type.Union([
				Type.Literal("pending"),
				Type.Literal("posted"),
				Type.Literal("availableBalance"),
			]),
			credits: AmountSchema,
			debits: AmountSchema,
			amount: AmountSchema,
		},
		{ additionalProperties: false }
	),
	{ minItems: 3, maxItems: 3 }
);
const Timestamp = Type.String({ format: "date-time", pattern: "[Tt][0-9]{2}:[0-9]{2}:[0-5][0-9]" });
const StatementId = Type.String({ pattern: "^lst_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const Annotations = {
	description: Type.Optional(Type.String()),
	metadata: Type.Optional(MetadataSchema),
};
const Period = { startDatetime: Timestamp, endDatetime: Timestamp };
const StatementCollectionParameters = Type.Object(
	{ ledgerId: LedgerIdSchema, accountId: AccountIdSchema },
	{ additionalProperties: false }
);
const LedgerAccountStatementIdParameters = Type.Object(
	{ ...StatementCollectionParameters.properties, statementId: StatementId },
	{ additionalProperties: false }
);
const StatementListQuery = Type.Object(ListQuery.properties, { additionalProperties: false });
const LedgerAccountStatementRequest = Type.Object(
	{ ...Period, ...Annotations },
	{ additionalProperties: false }
);
const StatementUpdateRequest = Type.Object(
	{ lockVersion: Type.Integer({ minimum: 1 }), ...Annotations },
	{ additionalProperties: false }
);
const StatementEntry = Type.Object(
	{
		id: EntryIdSchema,
		accountId: AccountIdSchema,
		direction: NormalBalance,
		amount: PositiveAmountSchema,
		...AssetSummarySchema.properties,
		metadata: Type.Optional(MetadataSchema),
		created: Timestamp,
		transaction: Type.Object(
			{
				id: TransactionIdSchema,
				lockVersion: Type.Integer({ minimum: 1 }),
				status: Type.Union([Type.Literal("pending"), Type.Literal("posted")]),
				effectiveAt: Timestamp,
				...Annotations,
			},
			{ additionalProperties: false }
		),
	},
	{ additionalProperties: false }
);
const StatementSnapshot = Type.Object(
	{
		normalBalance: NormalBalance,
		...AssetSummarySchema.properties,
		startingBalances: Balances,
		endingBalances: Balances,
		entries: Type.Array(StatementEntry, { maxItems: MAX_STATEMENT_ENTRIES }),
	},
	{ additionalProperties: false }
);
const LedgerAccountStatementResponse = Type.Object(
	{
		id: StatementId,
		ledgerId: LedgerIdSchema,
		accountId: AccountIdSchema,
		...Period,
		ledgerAccountVersion: Type.Integer({ minimum: 1 }),
		normalBalance: NormalBalance,
		...AssetSummarySchema.properties,
		startingBalances: Balances,
		endingBalances: Balances,
		...Annotations,
		lockVersion: Type.Integer({ minimum: 1 }),
		created: Timestamp,
		updated: Timestamp,
	},
	{ additionalProperties: false }
);
type StatementCollectionParameters = Static<typeof StatementCollectionParameters>;
type LedgerAccountStatementIdParameters = Static<typeof LedgerAccountStatementIdParameters>;
type StatementListQuery = Static<typeof StatementListQuery>;
type LedgerAccountStatementRequest = Static<typeof LedgerAccountStatementRequest>;
type StatementUpdateRequest = Static<typeof StatementUpdateRequest>;
type StatementEntry = Static<typeof StatementEntry>;
type StatementSnapshot = Static<typeof StatementSnapshot>;
type LedgerAccountStatementResponse = Static<typeof LedgerAccountStatementResponse>;
export {
	MAX_STATEMENT_ENTRIES,
	MAX_STATEMENT_BYTES,
	StatementCollectionParameters,
	LedgerAccountStatementIdParameters,
	StatementListQuery,
	LedgerAccountStatementRequest,
	StatementUpdateRequest,
	StatementEntry,
	StatementSnapshot,
	LedgerAccountStatementResponse,
};
