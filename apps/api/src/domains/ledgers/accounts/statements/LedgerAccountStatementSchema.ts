import { Schema } from "effect";
import { AssetSummarySchema } from "@/lib/AssetSchema";
import { AmountSchema, PositiveAmountSchema } from "@/lib/amounts";
import { ListQuery } from "@/lib/ListQuery";
import { DateTimeString, MetadataSchema, OmittedWhenUndefined } from "@/lib/schema";
import { LedgerIdSchema } from "../../LedgerSchema";
import { EntryIdSchema, TransactionIdSchema } from "../../transactions/LedgerTransactionSchema";
import { AccountIdSchema, NormalBalanceSchema } from "../AccountSchema";

const MAX_STATEMENT_ENTRIES = 10_000;
const MAX_STATEMENT_BYTES = 16 * 1024 * 1024;

const Balances = Schema.Array(
	Schema.Struct({
		balanceType: Schema.Literals(["pending", "posted", "availableBalance"]),
		credits: AmountSchema,
		debits: AmountSchema,
		amount: AmountSchema,
	})
).check(Schema.isLengthBetween(3, 3));
const Timestamp = DateTimeString;
const StatementId = Schema.String.check(Schema.isPattern(/^lst_[0-7][0-9a-hjkmnp-tv-z]{25}$/));
const Version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const annotations = {
	description: OmittedWhenUndefined(Schema.String),
	metadata: OmittedWhenUndefined(MetadataSchema),
};
const requestAnnotations = {
	description: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(MetadataSchema),
};
const period = { startDatetime: Timestamp, endDatetime: Timestamp };

const StatementCollectionParameters = Schema.Struct({
	ledgerId: LedgerIdSchema,
	accountId: AccountIdSchema,
});
const LedgerAccountStatementIdParameters = Schema.Struct({
	...StatementCollectionParameters.fields,
	statementId: StatementId,
});
const StatementListQuery = ListQuery;
const LedgerAccountStatementRequest = Schema.Struct({ ...period, ...requestAnnotations });
const StatementUpdateRequest = Schema.Struct({ lockVersion: Version, ...requestAnnotations });
const StatementEntry = Schema.Struct({
	id: EntryIdSchema,
	accountId: AccountIdSchema,
	direction: NormalBalanceSchema,
	amount: PositiveAmountSchema,
	...AssetSummarySchema.fields,
	metadata: OmittedWhenUndefined(MetadataSchema),
	created: Timestamp,
	transaction: Schema.Struct({
		id: TransactionIdSchema,
		lockVersion: Version,
		status: Schema.Literals(["pending", "posted"]),
		effectiveAt: Timestamp,
		...annotations,
	}),
});
const StatementSnapshot = Schema.Struct({
	normalBalance: NormalBalanceSchema,
	...AssetSummarySchema.fields,
	startingBalances: Balances,
	endingBalances: Balances,
	entries: Schema.Array(StatementEntry).check(Schema.isMaxLength(MAX_STATEMENT_ENTRIES)),
});
const LedgerAccountStatementResponse = Schema.Struct({
	id: StatementId,
	ledgerId: LedgerIdSchema,
	accountId: AccountIdSchema,
	...period,
	ledgerAccountVersion: Version,
	normalBalance: NormalBalanceSchema,
	...AssetSummarySchema.fields,
	startingBalances: Balances,
	endingBalances: Balances,
	...annotations,
	lockVersion: Version,
	created: Timestamp,
	updated: Timestamp,
}).annotate({ identifier: "LedgerAccountStatementResponse" });
const StatementEntriesResponse = Schema.Array(StatementEntry);
const StatementListResponse = Schema.Array(LedgerAccountStatementResponse);

type StatementCollectionParameters = typeof StatementCollectionParameters.Type;
type LedgerAccountStatementIdParameters = typeof LedgerAccountStatementIdParameters.Type;
type StatementListQuery = typeof StatementListQuery.Type;
type LedgerAccountStatementRequest = typeof LedgerAccountStatementRequest.Type;
type StatementUpdateRequest = typeof StatementUpdateRequest.Type;
type StatementEntry = typeof StatementEntry.Type;
type StatementSnapshot = typeof StatementSnapshot.Type;
type LedgerAccountStatementResponse = typeof LedgerAccountStatementResponse.Type;

export {
	MAX_STATEMENT_ENTRIES,
	MAX_STATEMENT_BYTES,
	StatementCollectionParameters,
	LedgerAccountStatementIdParameters,
	StatementListQuery,
	LedgerAccountStatementRequest,
	StatementUpdateRequest,
	StatementEntry,
	StatementEntriesResponse,
	StatementSnapshot,
	LedgerAccountStatementResponse,
	StatementListResponse,
};
