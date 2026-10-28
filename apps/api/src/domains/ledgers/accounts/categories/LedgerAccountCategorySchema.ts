import { Schema } from "effect";
import { AssetSummarySchema } from "@/lib/AssetSchema";
import { MetadataSchema, OmittedWhenUndefined } from "@/lib/schema";
import { LedgerIdSchema } from "@/domains/ledgers/LedgerSchema";
import {
	AccountBalanceResponse,
	AccountIdSchema,
	NormalBalanceSchema as NormalBalance,
} from "@/domains/ledgers/accounts/AccountSchema";

const LedgerId = LedgerIdSchema.annotate({ description: "The ledger's ID" });
const LedgerIdParameters = Schema.Struct({ ledgerId: LedgerId });
type LedgerIdParameters = typeof LedgerIdParameters.Type;
const LedgerAccountId = AccountIdSchema.annotate({ description: "The ledger account's ID" });

const LedgerAccountCategoryId = Schema.String.annotate({
	description: "Unique identifier for the ledger account category.",
}).check(Schema.isPattern(/^lac_[0-7][0-9a-hjkmnp-tv-z]{25}$/));
type LedgerAccountCategoryId = typeof LedgerAccountCategoryId.Type;
/** Ledger and Category identifiers in an item route. */
const LedgerAccountCategoryIdParameters = Schema.Struct({
	...LedgerIdParameters.fields,
	categoryId: LedgerAccountCategoryId,
});
type LedgerAccountCategoryIdParameters = typeof LedgerAccountCategoryIdParameters.Type;

const LinkAccountToCategoryParameters = Schema.Struct({
	...LedgerIdParameters.fields,
	categoryId: LedgerAccountCategoryId,
	accountId: LedgerAccountId,
});
type LinkAccountToCategoryParameters = typeof LinkAccountToCategoryParameters.Type;

const LinkCategoryToCategoryParameters = Schema.Struct({
	...LedgerIdParameters.fields,
	categoryId: LedgerAccountCategoryId,
	parentCategoryId: LedgerAccountCategoryId,
});
type LinkCategoryToCategoryParameters = typeof LinkCategoryToCategoryParameters.Type;

const LedgerAccountCategoryResponse = Schema.Struct({
	id: LedgerAccountCategoryId,
	ledgerId: LedgerId,
	name: Schema.String.annotate({ description: "The name of the ledger account category." }),
	description: OmittedWhenUndefined(
		Schema.String.annotate({ description: "An optional free-form description for internal use." })
	),
	normalBalance: NormalBalance,
	metadata: OmittedWhenUndefined(MetadataSchema),
	created: Schema.String.annotate({
		description: "Timestamp of when the ledger account category was created.",
	}),
	updated: Schema.String.annotate({
		description: "Timestamp of when the ledger account category was last updated.",
	}),
}).annotate({
	identifier: "LedgerAccountCategoryResponse",
	description:
		"A ledger account category is a grouping of Ledger Accounts. Current balances are available from the Category balances endpoint. Ledger Account Categories can also contain other categories, which enables the creation of nested hierarchies.",
});
type LedgerAccountCategoryResponse = typeof LedgerAccountCategoryResponse.Type;

const LedgerAccountCategoryBalancesResponse = Schema.Struct({
	categoryId: LedgerAccountCategoryId,
	normalBalance: NormalBalance,
	assets: Schema.Array(
		Schema.Struct({
			...AssetSummarySchema.fields,
			balances: Schema.Array(AccountBalanceResponse),
		})
	),
}).annotate({ identifier: "LedgerAccountCategoryBalancesResponse" });
type LedgerAccountCategoryBalancesResponse = typeof LedgerAccountCategoryBalancesResponse.Type;

const LedgerAccountCategoryRequest = Schema.Struct({
	name: Schema.String.annotate({ description: "The name of the ledger account category." }),
	description: Schema.optionalKey(
		Schema.String.annotate({ description: "An optional free-form description for internal use." })
	),
	normalBalance: NormalBalance,
	// Non-string metadata values are rejected here, which replaces the legacy validateMetadata hook.
	metadata: Schema.optionalKey(MetadataSchema),
}).annotate({ identifier: "LedgerAccountCategoryRequest" });
type LedgerAccountCategoryRequest = typeof LedgerAccountCategoryRequest.Type;

export {
	LedgerAccountCategoryBalancesResponse,
	LedgerIdParameters,
	LinkAccountToCategoryParameters as LinkAccountToCategoryParams,
	LinkCategoryToCategoryParameters as LinkCategoryToCategoryParams,
	LedgerAccountCategoryIdParameters as LedgerAccountCategoryIdParams,
	LedgerAccountCategoryResponse,
	LedgerAccountCategoryRequest,
	type LedgerAccountCategoryId,
};
