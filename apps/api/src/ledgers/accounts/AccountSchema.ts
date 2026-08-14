import { type Static, Type } from "@sinclair/typebox";
import type { Account } from "./domain/Account";

const LedgerIdSchema = Type.String({ pattern: "^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const AccountIdSchema = Type.String({ pattern: "^lat_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const AccountCollectionParameters = Type.Object({ ledgerId: LedgerIdSchema });
const AccountItemParameters = Type.Object({ ledgerId: LedgerIdSchema, accountId: AccountIdSchema });
const AccountListQuery = Type.Object({
	offset: Type.Integer({ default: 0, minimum: 0, maximum: 10_000 }),
	limit: Type.Integer({ default: 20, minimum: 1, maximum: 100 }),
});
const AccountMetadataSchema = Type.Record(Type.String(), Type.String());
const NormalBalanceSchema = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
const CurrencyCodeSchema = Type.String({ minLength: 1, pattern: "\\S" });
const MinorUnitExponentSchema = Type.Integer({ minimum: 0, maximum: 2_147_483_647 });
const AccountCreateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		normalBalance: NormalBalanceSchema,
		currencyCode: CurrencyCodeSchema,
		minorUnitExponent: MinorUnitExponentSchema,
		metadata: Type.Optional(AccountMetadataSchema),
	},
	{ additionalProperties: false }
);
const AccountUpdateRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(AccountMetadataSchema),
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
	minorUnitExponent: MinorUnitExponentSchema,
	balances: Type.Array(AccountBalanceResponse),
	metadata: Type.Optional(AccountMetadataSchema),
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

const toAccountResponse = (account: Account): AccountResponse => ({
	id: account.id.toString(),
	ledgerId: account.ledgerId.toString(),
	name: account.name,
	...(account.description === undefined ? {} : { description: account.description }),
	normalBalance: account.normalBalance,
	currencyCode: account.currency.code,
	minorUnitExponent: account.currency.minorUnitExponent,
	balances: account.balances.map(balance => ({ ...balance })),
	...(account.metadata === undefined ? {} : { metadata: account.metadata }),
	lockVersion: account.lockVersion,
	created: account.created.toISOString(),
	updated: account.updated.toISOString(),
});

export {
	AccountCollectionParameters,
	AccountCreateRequest,
	AccountIdSchema,
	AccountItemParameters,
	AccountListQuery,
	AccountResponse,
	AccountUpdateRequest,
	toAccountResponse,
};
