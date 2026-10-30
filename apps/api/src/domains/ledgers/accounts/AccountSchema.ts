import { Schema } from "effect";
import { AssetSelectorSchema, AssetSummarySchema } from "@/lib/AssetSchema";
import { AmountSchema } from "@/lib/amounts";
import { ListQuery } from "@/lib/ListQuery";
import { MetadataSchema, OmittedWhenUndefined } from "@/lib/schema";
import { LedgerIdSchema } from "../LedgerSchema";

/** Canonical Account TypeID used by Account and Settlement routes. */
const AccountIdSchema = Schema.String.check(Schema.isPattern(/^lat_[0-7][0-9a-hjkmnp-tv-z]{25}$/));
const AccountCollectionParameters = Schema.Struct({ ledgerId: LedgerIdSchema });
const AccountItemParameters = Schema.Struct({
	ledgerId: LedgerIdSchema,
	accountId: AccountIdSchema,
});
/** Shared pagination for Account collections. */
const AccountListQuery = ListQuery;
const NormalBalanceSchema = Schema.Literals(["debit", "credit"]);
const accountCreateFields = {
	name: Schema.String,
	description: Schema.optionalKey(Schema.String),
	normalBalance: NormalBalanceSchema,
	metadata: Schema.optionalKey(MetadataSchema),
};
// Exactly one Asset selector: each member of the shared selector union gets the create fields.
const [assetIdSelector, assetCodeSelector] = AssetSelectorSchema.members;
const AccountCreateRequest = Schema.Union([
	Schema.Struct({ ...accountCreateFields, ...assetIdSelector.fields }),
	Schema.Struct({ ...accountCreateFields, ...assetCodeSelector.fields }),
]);
const AccountUpdateRequest = Schema.Struct({
	name: Schema.String,
	description: Schema.optionalKey(Schema.String),
	metadata: Schema.optionalKey(MetadataSchema),
});
const AccountBalanceResponse = Schema.Struct({
	balanceType: Schema.Literals(["pending", "posted", "availableBalance"]),
	credits: AmountSchema,
	debits: AmountSchema,
	amount: AmountSchema,
});
const AccountResponse = Schema.Struct({
	id: AccountIdSchema,
	ledgerId: LedgerIdSchema,
	name: Schema.String,
	description: OmittedWhenUndefined(Schema.String),
	normalBalance: NormalBalanceSchema,
	...AssetSummarySchema.fields,
	balances: Schema.Array(AccountBalanceResponse),
	metadata: OmittedWhenUndefined(MetadataSchema),
	lockVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	created: Schema.String.annotate({ format: "date-time" }),
	updated: Schema.String.annotate({ format: "date-time" }),
});

type AccountCollectionParameters = typeof AccountCollectionParameters.Type;
type AccountItemParameters = typeof AccountItemParameters.Type;
type AccountListQuery = typeof AccountListQuery.Type;
type AccountCreateRequest = typeof AccountCreateRequest.Type;
type AccountUpdateRequest = typeof AccountUpdateRequest.Type;
type AccountResponse = typeof AccountResponse.Type;

export {
	AccountBalanceResponse,
	NormalBalanceSchema,
	AccountCollectionParameters,
	AccountCreateRequest,
	AccountIdSchema,
	AccountItemParameters,
	AccountListQuery,
	AccountResponse,
	AccountUpdateRequest,
};
