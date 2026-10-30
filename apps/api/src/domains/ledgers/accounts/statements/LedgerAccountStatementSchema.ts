import { Schema } from "effect";

import { LedgerIdSchema } from "@/domains/ledgers/LedgerSchema";
import { AccountIdSchema, NormalBalanceSchema } from "@/domains/ledgers/accounts/AccountSchema";
import { AssetSummarySchema } from "@/lib/AssetSchema";
import { MetadataSchema, OmittedWhenUndefined } from "@/lib/schema";

const LedgerId = LedgerIdSchema.annotate({ description: "The ledger's ID" });
const LedgerAccountId = AccountIdSchema.annotate({ description: "The ledger account's ID" });
const LedgerAccountStatementId = Schema.String.annotate({
	description: "The ledger account statement ID",
}).check(Schema.isPattern(/^lst_[0-7][0-9a-hjkmnp-tv-z]{25}$/));

/** The statement route validates the statement identifier only; the enclosing path IDs are ignored. */
const LedgerAccountStatementIdParameters = Schema.Struct({
	statementId: LedgerAccountStatementId,
});

/** Collection path IDs are declared as plain strings and ignored; the body carries the real ones. */
const LedgerAccountStatementCollectionParameters = Schema.Struct({
	ledgerId: Schema.String,
	accountId: Schema.String,
});

const description = Schema.String.annotate({
	description: "An optional free-form description for internal use.",
});
const startDatetime = Schema.String.annotate({
	description:
		"The inclusive lower bound of the ledger entries to be included in the ledger account statement.",
});
const endDatetime = Schema.String.annotate({
	description:
		"The exclusive upper bound of the ledger entries to be included in the ledger account statement.",
});

const LedgerAccountStatementResponse = Schema.Struct({
	id: LedgerAccountStatementId,
	ledgerId: LedgerId,
	accountId: LedgerAccountId,
	description: OmittedWhenUndefined(description),
	startDatetime,
	endDatetime,
	ledgerAccountVersion: Schema.Finite.annotate({
		description: "Version of the ledger account at the time of statement generation.",
	}),
	normalBalance: NormalBalanceSchema,
	...AssetSummarySchema.fields,
	metadata: OmittedWhenUndefined(MetadataSchema),
	created: Schema.String.annotate({
		description: "Timestamp of when the ledger account category was created.",
	}),
	updated: Schema.String.annotate({
		description: "Timestamp of when the ledger account category was last updated.",
	}),
}).annotate({
	identifier: "LedgerAccountStatementResponse",
	description:
		"A ledger account statement is an object that provides the starting and ending balances for a specific time period. Once created, it can be used to retrieve the ledger entries and ledger transaction versions that correspond to that time period and lock version of the ledger account.",
});

const LedgerAccountStatementRequest = Schema.Struct({
	ledgerId: LedgerId,
	accountId: LedgerAccountId,
	description: Schema.optionalKey(description),
	startDatetime,
	endDatetime,
}).annotate({ identifier: "LedgerAccountStatementRequest" });

type LedgerAccountStatementIdParameters = typeof LedgerAccountStatementIdParameters.Type;
type LedgerAccountStatementRequest = typeof LedgerAccountStatementRequest.Type;
type LedgerAccountStatementResponse = typeof LedgerAccountStatementResponse.Type;

export {
	LedgerAccountStatementCollectionParameters,
	LedgerAccountStatementIdParameters,
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
};
