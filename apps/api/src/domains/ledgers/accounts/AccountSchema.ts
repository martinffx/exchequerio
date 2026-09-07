import { type Static, Type } from "@sinclair/typebox";
import { ListQuery } from "@/lib/ListQuery";
import { MetadataSchema } from "@/lib/schema";
import { LedgerIdSchema } from "../LedgerSchema";

/** Canonical Account TypeID used by Account and Settlement routes. */
const AccountIdSchema = Type.String({ pattern: "^lat_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const AccountCollectionParameters = Type.Object({ ledgerId: LedgerIdSchema });
const AccountItemParameters = Type.Object({ ledgerId: LedgerIdSchema, accountId: AccountIdSchema });
/** Shared pagination for Account collections. */
const AccountListQuery = ListQuery;
const NormalBalanceSchema = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
const CurrencyCodeSchema = Type.String({ minLength: 1, pattern: "\\S" });
const AccountCreateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		normalBalance: NormalBalanceSchema,
		currencyCode: CurrencyCodeSchema,
		metadata: Type.Optional(MetadataSchema),
	},
	{ additionalProperties: false }
);
const AccountUpdateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
	},
	{ additionalProperties: false }
);
const AccountBalanceResponse = Type.Object({
	balanceType: Type.Union([
		Type.Literal("pending"),
		Type.Literal("posted"),
		Type.Literal("availableBalance"),
	]),
	credits: Type.Integer(),
	debits: Type.Integer(),
	amount: Type.Integer(),
});
const AccountResponse = Type.Object({
	id: AccountIdSchema,
	ledgerId: LedgerIdSchema,
	name: Type.String(),
	description: Type.Optional(Type.String()),
	normalBalance: NormalBalanceSchema,
	currencyCode: CurrencyCodeSchema,
	balances: Type.Array(AccountBalanceResponse),
	metadata: Type.Optional(MetadataSchema),
	lockVersion: Type.Integer({ minimum: 0 }),
	created: Type.String({ format: "date-time" }),
	updated: Type.String({ format: "date-time" }),
});

type AccountCollectionParameters = Static<typeof AccountCollectionParameters>;
type AccountItemParameters = Static<typeof AccountItemParameters>;
type AccountListQuery = Static<typeof AccountListQuery>;
type AccountCreateRequest = Static<typeof AccountCreateRequest>;
type AccountUpdateRequest = Static<typeof AccountUpdateRequest>;
type AccountResponse = Static<typeof AccountResponse>;

export {
	AccountCollectionParameters,
	AccountCreateRequest,
	AccountIdSchema,
	AccountItemParameters,
	AccountListQuery,
	AccountResponse,
	AccountUpdateRequest,
};
