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
const PendingBalance = Type.Object({
	balanceType: Type.Literal("pending", {
		description: "The sum of all pending AND posted entry amounts.",
	}),
	credits: Type.Number({
		description: "Summed amounts of all posted and pending ledger entries with `credit` direction.",
	}),
	debits: Type.Number({
		description: "Summed amounts of all posted and pending ledger entries with `debit` direction.",
	}),
	amount: Type.Number({
		description: "Credit Normal: Credits - Debits, Debit Normal: Debits - Credits",
	}),
	currency: Type.String({
		description: "Currency of the ledger",
	}),
	currencyExponent: Type.Number({
		description: "Currency exponent of the ledger",
	}),
});

const PostedBalance = Type.Object({
	balanceType: Type.Literal("posted", {
		description: "The sum of all posted entry amounts.",
	}),
	credits: Type.Number({
		description: "Summed amounts of all posted ledger entries with `credit` direction.",
	}),
	debits: Type.Number({
		description: "Summed amounts of all posted ledger entries with `debit` direction.",
	}),
	amount: Type.Number({
		description: "Credit Normal: Credits - Debits, Debit Normal: Debits - Credits",
	}),
	currency: Type.String({
		description: "Currency of the ledger",
	}),
	currencyExponent: Type.Number({
		description: "Currency exponent of the ledger",
	}),
});

const AvailableBalance = Type.Object({
	balanceType: Type.Literal("availableBalance", {
		description:
			"The sum of all posted inbound entries and pending outbound entries, where direction is determined by the normality of the object holding the balance. See below for more details.",
	}),
	credits: Type.Number({
		description: "Summed amounts of all posted ledger entries with `credit` direction.",
	}),
	debits: Type.Number({
		description: "Summed amounts of all posted ledger entries with `debit` direction.",
	}),
	amount: Type.Number({
		description: "Credit Normal: Credits - Debits, Debit Normal: Debits - Credits",
	}),
	currency: Type.String({
		description: "Currency of the ledger",
	}),
	currencyExponent: Type.Number({
		description: "Currency exponent of the ledger",
	}),
});

const Balance = Type.Union([PendingBalance, PostedBalance, AvailableBalance]);
const Balances = Type.Array(Balance, {
	description: "The pending, posted, and available balances.",
});
type Balances = Static<typeof Balances>;

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
	Balances,
	NormalBalanceSchema,
	AccountCollectionParameters,
	AccountCreateRequest,
	AccountIdSchema,
	AccountItemParameters,
	AccountListQuery,
	AccountResponse,
	AccountUpdateRequest,
};
