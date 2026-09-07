import { type Static, Type } from "@sinclair/typebox";
import type { FastifyRequest } from "fastify";
import { MetadataSchema } from "@/lib/schema";
import type { PaginationQuery } from "../schema";

/**
 * Common Types
 */
const Metadata = Type.Mapped(Type.KeyOf(Type.String()), () => Type.String(), {
	description:
		"Additional data represented as key-value pairs. Both the key and value must be strings.",
});
type Metadata = Static<typeof Metadata>;

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
		metadata: Type.Optional(Metadata),
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
		metadata: Type.Optional(Metadata),
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
		metadata: Type.Optional(Metadata),
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
		metadata: Type.Optional(Metadata),
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

/**
 * Ledger Account Statement
 */
const LedgerAccountStatementId = Type.String({
	description: "The ledger account statement ID",
	pattern: "^lst_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
type LedgerAccountStatementId = Static<typeof LedgerAccountStatementId>;
const LedgerAccountStatementIdParameters = Type.Object({
	statementId: LedgerAccountStatementId,
});
type LedgerAccountStatementIdParameters = Static<typeof LedgerAccountStatementIdParameters>;
const LedgerAccountStatementResponse = Type.Object(
	{
		id: LedgerAccountStatementId,
		ledgerId: LedgerId,
		accountId: LedgerAccountId,
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		startDatetime: Type.String({
			description:
				"The inclusive lower bound of the ledger entries to be included in the ledger account statement.",
		}),
		endDatetime: Type.String({
			description:
				"The exclusive upper bound of the ledger entries to be included in the ledger account statement.",
		}),
		ledgerAccountVersion: Type.Number({
			description: "Version of the ledger account at the time of statement generation.",
		}),
		normalBalance: NormalBalance,
		startingBalances: Balances,
		endingBalances: Balances,
		currency: Type.String({
			description: "The currency of the ledger account settlement.",
		}),
		currencyExponent: Type.Number({
			description: "The currency exponent of the ledger account settlement.",
		}),
		metadata: Type.Optional(Metadata),
		created: Type.String({
			description: "Timestamp of when the ledger account category was created.",
		}),
		updated: Type.String({
			description: "Timestamp of when the ledger account category was last updated.",
		}),
	},
	{
		$id: "LedgerAccountStatementResponse",
		description:
			"A ledger account statement is an object that provides the starting and ending balances for a specific time period. Once created, it can be used to retrieve the ledger entries and ledger transaction versions that correspond to that time period and lock version of the ledger account.",
	}
);
type LedgerAccountStatementResponse = Static<typeof LedgerAccountStatementResponse>;
const LedgerAccountStatementRequest = Type.Object(
	{
		ledgerId: LedgerId,
		accountId: LedgerAccountId,
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		startDatetime: Type.String({
			description:
				"The inclusive lower bound of the ledger entries to be included in the ledger account statement.",
		}),
		endDatetime: Type.String({
			description:
				"The exclusive upper bound of the ledger entries to be included in the ledger account statement.",
		}),
	},
	{
		$id: "LedgerAccountStatementRequest",
	}
);
type LedgerAccountStatementRequest = Static<typeof LedgerAccountStatementRequest>;
type GetLedgerAccountStatementRequest = FastifyRequest<{
	Params: LedgerAccountStatementIdParameters;
}>;
type CreateLedgerAccountStatementRequest = FastifyRequest<{
	Body: LedgerAccountStatementRequest;
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
	LedgerAccountStatementIdParameters as LedgerAccountStatementIdParams,
	LedgerAccountStatementResponse,
	LedgerAccountStatementRequest,
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
	type CreateLedgerAccountStatementRequest,
	type GetLedgerAccountStatementRequest,
	Balances,
	PendingBalance,
	PostedBalance,
	AvailableBalance,
	// Export unused types to make the schema's public surface explicit
	type Metadata,
	type NormalBalance,
	type Balance,
	type LedgerAccountId,
	type LedgerAccountCategoryId,
	type LedgerAccountStatementId,
};
