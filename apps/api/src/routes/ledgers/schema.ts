import { type Static, Type } from "@sinclair/typebox";
import type { FastifyRequest } from "fastify";
import { MetadataSchema } from "@/lib/schema";
import type { PaginationQuery } from "../schema";

/**
 * Common Types
 */
const NormalBalance = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
type NormalBalance = Static<typeof NormalBalance>;

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
type PendingBalance = Static<typeof PendingBalance>;

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
type PostedBalance = Static<typeof PostedBalance>;

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
type AvailableBalance = Static<typeof AvailableBalance>;

const Balance = Type.Union([PendingBalance, PostedBalance, AvailableBalance]);
type Balance = Static<typeof Balance>;
const Balances = Type.Array(Balance, {
	description: "The pending, posted, and available balances.",
});
type Balances = Static<typeof Balances>;

/**
 * Ledger
 */
const LedgerId = Type.String({
	description: "The ledger's ID",
	pattern: "^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
type LedgerId = Static<typeof LedgerId>;
const LedgerIdParameters = Type.Object({
	ledgerId: LedgerId,
});
type LedgerIdParameters = Static<typeof LedgerIdParameters>;
const LedgerResponse = Type.Object(
	{
		id: LedgerId,
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
		created: Type.String(),
		updated: Type.String(),
	},
	{ $id: "LedgerResponse" }
);
type LedgerResponse = Static<typeof LedgerResponse>;
const LedgerRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		currency: Type.Optional(
			Type.String({
				description: "Currency code (default: USD). Immutable after creation.",
				default: "USD",
			})
		),
		currencyExponent: Type.Optional(
			Type.Number({
				description: "Currency exponent (default: 2). Immutable after creation.",
				default: 2,
			})
		),
		metadata: Type.Optional(MetadataSchema),
	},
	{ $id: "LedgerRequest" }
);
type LedgerRequest = Static<typeof LedgerRequest>;

type ListLedgersRequest = FastifyRequest<{
	Querystring: PaginationQuery;
}>;
type GetLedgerRequest = FastifyRequest<{ Params: LedgerIdParameters }>;
type CreateLedgerRequest = FastifyRequest<{ Body: LedgerRequest }>;
type UpdateLedgerRequest = FastifyRequest<{
	Params: LedgerIdParameters;
	Body: LedgerRequest;
}>;
type DeleteLedgerRequest = FastifyRequest<{ Params: LedgerIdParameters }>;

/**
 * Ledger Accounts
 */
const LedgerAccountId = Type.String({
	description: "The ledger account's ID",
	pattern: "^lat_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
type LedgerAccountId = Static<typeof LedgerAccountId>;
const LedgerAccountIdParameters = Type.Object({
	accountId: LedgerAccountId,
});
type LedgerAccountIdParameters = Static<typeof LedgerAccountIdParameters>;
const LedgerIdWithAccountIdParams = Type.Object({
	ledgerId: LedgerId,
	accountId: LedgerAccountId,
});
type LedgerIdWithAccountIdParams = Static<typeof LedgerIdWithAccountIdParams>;
const LedgerAccountResponse = Type.Object(
	{
		id: LedgerAccountId,
		name: Type.String(),
		description: Type.Optional(Type.String()),
		normalBalance: NormalBalance,
		balances: Balances,
		ledgerId: Type.String(),
		metadata: Type.Optional(MetadataSchema),
		lockVersion: Type.Number(),
		created: Type.String(),
		updated: Type.String(),
	},
	{
		$id: "LedgerAccountResponse",
		description:
			"A ledger account is an account in a double-entry accounting system. Common examples include asset, liability, expense, and revenue accounts. Each ledger account belongs to a ledger and can only have entries with other accounts belonging to the same ledger.",
	}
);
type LedgerAccountResponse = Static<typeof LedgerAccountResponse>;
const LedgerAccountRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(MetadataSchema),
	},
	{
		$id: "LedgerAccountRequest",
	}
);
type LedgerAccountRequest = Static<typeof LedgerAccountRequest>;

type ListLedgerAccountsRequest = FastifyRequest<{
	Params: LedgerIdParameters;
	Querystring: PaginationQuery;
}>;
type GetLedgerAccountRequest = FastifyRequest<{
	Params: LedgerIdWithAccountIdParams;
}>;
type CreateLedgerAccountRequest = FastifyRequest<{
	Params: LedgerIdParameters;
	Body: LedgerAccountRequest;
}>;
type UpdateLedgerAccountRequest = FastifyRequest<{
	Params: LedgerIdWithAccountIdParams;
	Body: LedgerAccountRequest;
}>;
type DeleteLedgerAccountRequest = FastifyRequest<{
	Params: LedgerIdWithAccountIdParams;
}>;

/**
 * Ledger Account Categories
 */
const LedgerAccountCategoryId = Type.String({
	description: "Unique identifier for the ledger account category.",
	pattern: "^lac_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
type LedgerAccountCategoryId = Static<typeof LedgerAccountCategoryId>;
const LedgerAccountCategoryIdParameters = Type.Object({
	categoryId: LedgerAccountCategoryId,
});
type LedgerAccountCategoryIdParameters = Static<typeof LedgerAccountCategoryIdParameters>;

const LinkAccountToCategoryParameters = Type.Object({
	categoryId: LedgerAccountCategoryId,
	accountId: LedgerAccountId,
});
type LinkAccountToCategoryParameters = Static<typeof LinkAccountToCategoryParameters>;

const LinkCategoryToCategoryParameters = Type.Object({
	categoryId: LedgerAccountCategoryId,
	parentCategoryId: LedgerAccountCategoryId,
});
type LinkCategoryToCategoryParameters = Static<typeof LinkCategoryToCategoryParameters>;

const LedgerAccountCategoryResponse = Type.Object(
	{
		id: LedgerAccountCategoryId,
		ledgerId: LedgerId,
		name: Type.String({
			description: "The name of the ledger account category.",
		}),
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		normalBalance: NormalBalance,
		balances: Balances,
		metadata: Type.Optional(MetadataSchema),
		created: Type.String({
			description: "Timestamp of when the ledger account category was created.",
		}),
		updated: Type.String({
			description: "Timestamp of when the ledger account category was last updated.",
		}),
	},
	{
		$id: "LedgerAccountCategoryResponse",
		description:
			"A ledger account category is a grouping of Ledger Accounts. Its balance is equal to the sum of the balances of all contained accounts. Ledger Account Categories can also contain other categories, which enables the creation of nested hierarchies.",
	}
);
type LedgerAccountCategoryResponse = Static<typeof LedgerAccountCategoryResponse>;
const LedgerAccountCategoryRequest = Type.Object(
	{
		name: Type.String({
			description: "The name of the ledger account category.",
		}),
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		normalBalance: NormalBalance,
		metadata: Type.Optional(MetadataSchema),
	},
	{
		$id: "LedgerAccountCategoryRequest",
	}
);
type LedgerAccountCategoryRequest = Static<typeof LedgerAccountCategoryRequest>;

type ListLedgerAccountCategoriesRequest = FastifyRequest<{
	Params: LedgerIdParameters;
	Querystring: PaginationQuery;
}>;
type GetLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LedgerAccountCategoryIdParameters;
}>;
type CreateLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters;
	Body: LedgerAccountCategoryRequest;
}>;
type UpdateLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LedgerAccountCategoryIdParameters;
	Body: LedgerAccountCategoryRequest;
}>;
type DeleteLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LedgerAccountCategoryIdParameters;
}>;
type LinkLedgerAccountToCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LinkAccountToCategoryParameters;
}>;
type UnlinkLedgerAccountToCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LinkAccountToCategoryParameters;
}>;
type LinkLedgerAccountCategoryToCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LinkCategoryToCategoryParameters;
}>;
type UnlinkLedgerAccountCategoryToCategoryRequest = FastifyRequest<{
	Params: LedgerIdParameters & LinkCategoryToCategoryParameters;
}>;

export {
	LinkAccountToCategoryParameters as LinkAccountToCategoryParams,
	LinkCategoryToCategoryParameters as LinkCategoryToCategoryParams,
	LedgerId,
	LedgerIdParameters as LedgerIdParams,
	LedgerResponse,
	LedgerRequest,
	LedgerAccountIdParameters as LedgerAccountIdParams,
	LedgerIdWithAccountIdParams,
	LedgerAccountResponse,
	LedgerAccountRequest,
	LedgerAccountCategoryIdParameters as LedgerAccountCategoryIdParams,
	LedgerAccountCategoryResponse,
	LedgerAccountCategoryRequest,
	type ListLedgersRequest,
	type GetLedgerRequest,
	type CreateLedgerRequest,
	type UpdateLedgerRequest,
	type DeleteLedgerRequest,
	type ListLedgerAccountsRequest,
	type GetLedgerAccountRequest,
	type CreateLedgerAccountRequest,
	type UpdateLedgerAccountRequest,
	type DeleteLedgerAccountRequest,
	type ListLedgerAccountCategoriesRequest,
	type GetLedgerAccountCategoryRequest,
	type CreateLedgerAccountCategoryRequest,
	type UpdateLedgerAccountCategoryRequest,
	type DeleteLedgerAccountCategoryRequest,
	type LinkLedgerAccountToCategoryRequest,
	type UnlinkLedgerAccountToCategoryRequest,
	type LinkLedgerAccountCategoryToCategoryRequest,
	type UnlinkLedgerAccountCategoryToCategoryRequest,
	Balances,
	PendingBalance,
	PostedBalance,
	AvailableBalance,
	// Export unused types to make the schema's public surface explicit
	type NormalBalance,
	type Balance,
	type LedgerAccountId,
	type LedgerAccountCategoryId,
};

export type { Metadata } from "@/lib/schema";
