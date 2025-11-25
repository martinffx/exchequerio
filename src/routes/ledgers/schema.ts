import { type Static, Type } from "@sinclair/typebox"
import type { PaginationQuery } from "../schema"
import type { FastifyRequest } from "fastify"

/**
 * Common Types
 */
const Metadata = Type.Mapped(Type.KeyOf(Type.String()), K => Type.String(), {
	description:
		"Additional data represented as key-value pairs. Both the key and value must be strings.",
})
type Metadata = Static<typeof Metadata>

const NormalBalance = Type.Union([Type.Literal("debit"), Type.Literal("credit")])
type NormalBalance = Static<typeof NormalBalance>

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
})
type PendingBalance = Static<typeof PendingBalance>

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
})
type PostedBalance = Static<typeof PostedBalance>

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
})
type AvailableBalance = Static<typeof AvailableBalance>

const Balance = Type.Union([PendingBalance, PostedBalance, AvailableBalance])
type Balance = Static<typeof Balance>
const Balances = Type.Array(Balance, {
	description: "The pending, posted, and available balances.",
})
type Balances = Static<typeof Balances>

const Direction = Type.Union([
	Type.Literal("credit", {
		description: "The entry is a credit.",
	}),
	Type.Literal("debit", {
		description: "The entry is a debit.",
	}),
])
type Direction = Static<typeof Direction>

const BalanceStatus = Type.Union([
	Type.Literal("pending", {
		description: "The transaction is pending and has not been posted.",
	}),
	Type.Literal("posted", {
		description: "The transaction has been posted.",
	}),
	Type.Literal("archived", {
		description: "The transaction has been archived.",
	}),
])
type BalanceStatus = Static<typeof BalanceStatus>

const SettlementStatus = Type.Union([
	Type.Literal("drafting"),
	Type.Literal("processing"),
	Type.Literal("pending"),
	Type.Literal("posted"),
	Type.Literal("archiving"),
	Type.Literal("archived"),
])
type SettlementStatus = Static<typeof SettlementStatus>

const AlertOperator = Type.Union([
	Type.Literal("="),
	Type.Literal("<"),
	Type.Literal(">"),
	Type.Literal("<="),
	Type.Literal(">="),
	Type.Literal("!="),
])
type AlertOperator = Static<typeof AlertOperator>
const AlertField = Type.Union([
	Type.Literal("balance"),
	Type.Literal("created"),
	Type.Literal("updated"),
])
type AlertField = Static<typeof AlertField>
const AlertCondition = Type.Object({
	field: AlertField,
	operator: AlertOperator,
	value: Type.Number(),
})
type AlertCondition = Static<typeof AlertCondition>

/**
 * Ledger
 */
const LedgerId = Type.String({
	description: "The ledger's ID",
	pattern: "^lgr_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
})
type LedgerId = Static<typeof LedgerId>
const LedgerIdParams = Type.Object({
	ledgerId: LedgerId,
})
type LedgerIdParams = Static<typeof LedgerIdParams>
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
)
type LedgerResponse = Static<typeof LedgerResponse>
const LedgerRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(Metadata),
	},
	{ $id: "LedgerRequest" }
)
type LedgerRequest = Static<typeof LedgerRequest>

type ListLedgersRequest = FastifyRequest<{
	Querystring: PaginationQuery
}>
type GetLedgerRequest = FastifyRequest<{ Params: LedgerIdParams }>
type CreateLedgerRequest = FastifyRequest<{ Body: LedgerRequest }>
type UpdateLedgerRequest = FastifyRequest<{
	Params: LedgerIdParams
	Body: LedgerRequest
}>
type DeleteLedgerRequest = FastifyRequest<{ Params: LedgerIdParams }>

/**
 * Ledger Accounts
 */
const LedgerAccountId = Type.String({
	description: "The ledger account's ID",
	pattern: "^lat_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
})
type LedgerAccountId = Static<typeof LedgerAccountId>
const LedgerAccountIdParams = Type.Object({
	ledgerAccountId: LedgerAccountId,
})
type LedgerAccountIdParams = Static<typeof LedgerAccountIdParams>
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
)
type LedgerAccountResponse = Static<typeof LedgerAccountResponse>
const LedgerAccountRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(Metadata),
	},
	{
		$id: "LedgerAccountRequest",
	}
)
type LedgerAccountRequest = Static<typeof LedgerAccountRequest>

type ListLedgerAccountsRequest = FastifyRequest<{
	Querystring: PaginationQuery & {
		orgId: string
		ledgerId: string
	}
}>
type GetLedgerAccountRequest = FastifyRequest<{
	Params: LedgerAccountIdParams
}>
type CreateLedgerAccountRequest = FastifyRequest<{
	Body: LedgerAccountRequest
}>
type UpdateLedgerAccountRequest = FastifyRequest<{
	Params: LedgerAccountIdParams
	Body: LedgerAccountRequest
}>
type DeleteLedgerAccountRequest = FastifyRequest<{
	Params: LedgerAccountIdParams
}>

/**
 * Ledger Account Categories
 */
const LedgerAccountCategoryId = Type.String({
	description: "Unique identifier for the ledger account category.",
	pattern: "^lac_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
})
type LedgerAccountCategoryId = Static<typeof LedgerAccountCategoryId>
const LedgerAccountCategoryIdParams = Type.Object({
	ledgerAccountCategoryId: LedgerAccountCategoryId,
})
type LedgerAccountCategoryIdParams = Static<typeof LedgerAccountCategoryIdParams>

const LinkAccountToCategoryParams = Type.Object({
	ledgerAccountCategoryId: LedgerAccountCategoryId,
	accountId: LedgerAccountId,
})
type LinkAccountToCategoryParams = Static<typeof LinkAccountToCategoryParams>

const LinkCategoryToCategoryParams = Type.Object({
	ledgerAccountCategoryId: LedgerAccountCategoryId,
	categoryId: LedgerAccountCategoryId,
})
type LinkCategoryToCategoryParams = Static<typeof LinkCategoryToCategoryParams>

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
		metadata: Type.Optional(Metadata),
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
)
type LedgerAccountCategoryResponse = Static<typeof LedgerAccountCategoryResponse>
const LedgerAccountCategoryRequest = Type.Object(
	{
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
		metadata: Type.Optional(Metadata),
		parentAccountCategoryIds: Type.Optional(
			Type.Array(Type.String({ description: "The ID of the parent category." }))
		),
	},
	{
		$id: "LedgerAccountCategoryRequest",
	}
)
type LedgerAccountCategoryRequest = Static<typeof LedgerAccountCategoryRequest>

type ListLedgerAccountCategoriesRequest = FastifyRequest<{
	Querystring: PaginationQuery
}>
type GetLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerAccountCategoryIdParams
}>
type CreateLedgerAccountCategoryRequest = FastifyRequest<{
	Body: LedgerAccountCategoryRequest
}>
type UpdateLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerAccountCategoryIdParams
	Body: LedgerAccountCategoryRequest
}>
type DeleteLedgerAccountCategoryRequest = FastifyRequest<{
	Params: LedgerAccountCategoryIdParams
}>
type LinkLedgerAccountToCategoryRequest = FastifyRequest<{
	Params: LinkAccountToCategoryParams
}>
type UnlinkLedgerAccountToCategoryRequest = FastifyRequest<{
	Params: LinkAccountToCategoryParams
}>
type LinkLedgerAccountCategoryToCategoryRequest = FastifyRequest<{
	Params: LinkCategoryToCategoryParams
}>
type UnlinkLedgerAccountCategoryToCategoryRequest = FastifyRequest<{
	Params: LinkCategoryToCategoryParams
}>

/**
 * Ledger Transaction Entry
 */
const LedgerTransactionEntryId = Type.String({
	description: "Unique identifier for the ledger transaction entry.",
	pattern: "^lte_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
})
type LedgerTransactionEntryId = Static<typeof LedgerTransactionEntryId>
const LedgerTransactionEntryIdParams = Type.Object({
	ledgerTransactionEntryId: LedgerTransactionEntryId,
})
type LedgerTransactionEntryIdParams = Static<typeof LedgerTransactionEntryIdParams>
const LedgerTransactionEntry = Type.Object(
	{
		id: LedgerTransactionEntryId,
		ledgerAccountId: LedgerAccountId,
		direction: Direction,
		amount: Type.Number({
			description:
				"Value in specified currency's smallest unit. e.g. $10 would be represented as 1000. Can be any integer up to 10³⁶.",
		}),
		currency: Type.String({
			description: "The currency of the ledger account",
		}),
		currencyExponent: Type.Number({
			description: "The currency exponent of the ledger account",
		}),
		resultingBalance: Type.Object(
			{
				pendingBalance: PendingBalance,
				postedBalance: PostedBalance,
				availableBalance: AvailableBalance,
			},
			{
				description:
					"The resulting pending, posted, and available balances for this ledger account. The posted balance is the sum of all posted entries on the account. The pending balance is the sum of all pending and posted entries on the account. The available balance is the posted incoming entries minus the sum of the pending and posted outgoing amounts.",
			}
		),
		status: BalanceStatus,
		metadata: Type.Optional(Metadata),
	},
	{
		$id: "LedgerEntryResponse",
		description:
			"A ledger entry is a record of a transaction that affects one or more ledger accounts. Each ledger entry belongs to a ledger transaction and belongs to a ledger account.",
	}
)

const LedgerTransactionEntryResponse = Type.Composite([
	LedgerTransactionEntry,
	Type.Object({
		created: Type.String({
			description: "Timestamp of when the ledger entry was created.",
		}),
		updated: Type.String({
			description: "Timestamp of when the ledger entry was last updated.",
		}),
	}),
])
type LedgerTransactionEntryResponse = Static<typeof LedgerTransactionEntryResponse>
const LedgerTransactionEntryRequest = Type.Object(
	{
		name: Type.String(),
		description: Type.Optional(Type.String()),
		metadata: Type.Optional(Metadata),
	},
	{ $id: "LedgerTransactionEntryRequest" }
)
type LedgerTransactionEntryRequest = Static<typeof LedgerTransactionEntryRequest>

type ListLedgerTransactionEntriesRequest = FastifyRequest<{
	Querystring: PaginationQuery
}>
type GetLedgerTransactionEntryRequest = FastifyRequest<{
	Params: LedgerTransactionEntryIdParams
}>
type UpdateLedgerTransactionEntryRequest = FastifyRequest<{
	Params: LedgerTransactionEntryIdParams
	Body: LedgerTransactionEntryRequest
}>

/**
 * Ledger Transactions
 */
const LedgerTransactionId = Type.String({
	description: "Unique identifier for the ledger transaction.",
	pattern: "^ltr_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
})
type LedgerTransactionId = Static<typeof LedgerTransactionId>
const LedgerTransactionIdParams = Type.Object({
	ledgerTransactionId: LedgerTransactionId,
})
type LedgerTransactionIdParams = Static<typeof LedgerTransactionIdParams>
const LedgerTransactionResponse = Type.Object(
	{
		id: LedgerTransactionId,
		ledgerId: LedgerId,
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		status: BalanceStatus,
		metadata: Type.Optional(Metadata),
		ledgerEntries: Type.Array(LedgerTransactionEntry),
		postedAt: Type.Optional(
			Type.String({
				description:
					"The time on which the ledger transaction posted. This is null if the ledger transaction is pending.",
			})
		),
		effectiveAt: Type.Optional(
			Type.String({
				description: "The time at which the ledger transaction happened for reporting purposes.",
			})
		),
		reversedByLedgerTransactionId: Type.Optional(
			Type.String({
				description:
					"If the ledger transaction is reversed by another ledger transaction, the reversed_by_ledger_transaction_id will be populated here, and it is the ID of the reversal ledger transactions.",
			})
		),
		reversesLedgerTransactionId: Type.Optional(
			Type.String({
				description:
					"If the ledger transaction reverses another ledger transaction, the reverses_ledger_transaction_id will be populated here, and it is the ID of the original ledger transaction.",
			})
		),
		created: Type.String({
			description: "The time the ledger transaction was created.",
		}),
		updated: Type.String({
			description: "The time the ledger transaction was last updated.",
		}),
	},
	{
		$id: "LedgerTransactionResponse",
		description:
			"A ledger transaction is a transaction between two or more ledger accounts. To create a ledger transaction, there must be at least one credit ledger entry and one debit ledger entry. Additionally, the sum of all credit entry amounts must equal the sum of all debit entry amounts. The ledger transaction is immutable once it has posted.",
	}
)
type LedgerTransactionResponse = Static<typeof LedgerTransactionResponse>
const LedgerTransactionRequest = Type.Object(
	{
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		status: BalanceStatus,
		metadata: Type.Optional(Metadata),
		effectiveAt: Type.Optional(
			Type.String({
				description: "The time at which the ledger transaction happened for reporting purposes.",
			})
		),
		ledgerEntries: Type.Array(LedgerTransactionEntry),
		created: Type.String({
			description: "The time the ledger transaction was created.",
		}),
		updated: Type.String({
			description: "The time the ledger transaction was last updated.",
		}),
	},
	{ $id: "LedgerTransactionRequest" }
)
type LedgerTransactionRequest = Static<typeof LedgerTransactionRequest>

type ListLedgerTransactionsRequest = FastifyRequest<{
	Querystring: PaginationQuery
}>
type GetLedgerTransactionRequest = FastifyRequest<{
	Params: LedgerTransactionIdParams
}>
type CreateLedgerTransactionRequest = FastifyRequest<{
	Body: LedgerTransactionRequest
}>
type UpdateLedgerTransactionRequest = FastifyRequest<{
	Params: LedgerTransactionIdParams
	Body: LedgerTransactionRequest
}>
type DeleteLedgerTransactionRequest = FastifyRequest<{
	Params: LedgerTransactionIdParams
}>

/**
 * Ledger Account Settlement
 */
const LedgerAccountSettlementId = Type.String({
	description: "Unique identifier for the ledger account settlement.",
	pattern: "^las_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
})
type LedgerAccountSettlementId = Static<typeof LedgerAccountSettlementId>
const LedgerAccountSettlementIdParams = Type.Object({
	ledgerAccountSettlementId: LedgerAccountSettlementId,
})
type LedgerAccountSettlementIdParams = Static<typeof LedgerAccountSettlementIdParams>
const LedgerAccountSettlementResponse = Type.Object(
	{
		id: LedgerAccountSettlementId,
		ledgerTransactionId: LedgerTransactionId,
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		status: SettlementStatus,
		normalBalance: NormalBalance,
		settledLedgerAccountId: Type.String({
			description:
				"The Ledger Account that we will query the Entries against, and its balance is reduced as a result. The settled ledger account and the contra ledger account must belong to the same ledger.",
		}),
		contraLedgerAccountId: Type.String({
			description:
				"The Ledger Account that sends to or receives funds from the settled ledger account. The settled ledger account and the contra ledger account must belong to the same ledger.",
		}),
		amount: Type.Number({
			description: "The amount of the settlement.",
		}),
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
		$id: "LedgerAccountSettlementResponse",
		description:
			"A ledger account settlement is an object that creates a ledger transaction to safely offset the posted balance of a ledger account. ",
	}
)
type LedgerAccountSettlementResponse = Static<typeof LedgerAccountSettlementResponse>
const LedgerAccountSettlementRequest = Type.Object(
	{
		ledgerTransactionId: LedgerTransactionId,
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		status: SettlementStatus,
		settledLedgerAccountId: Type.String({
			description:
				"The Ledger Account that we will query the Entries against, and its balance is reduced as a result. The settled ledger account and the contra ledger account must belong to the same ledger.",
		}),
		contraLedgerAccountId: Type.String({
			description:
				"The Ledger Account that sends to or receives funds from the settled ledger account. The settled ledger account and the contra ledger account must belong to the same ledger.",
		}),
		metadata: Type.Optional(Metadata),
	},
	{
		$id: "LedgerAccountSettlementRequest",
	}
)
type LedgerAccountSettlementRequest = Static<typeof LedgerAccountSettlementRequest>
const LedgerAccountSettlementEntriesRequest = Type.Object({
	entries: Type.Array(Type.String({ description: "The ID of the Ledger Transaction Entry." })),
})
type LedgerAccountSettlementEntriesRequest = Static<typeof LedgerAccountSettlementEntriesRequest>
type ListLedgerAccountSettlementsRequest = FastifyRequest<{
	Querystring: PaginationQuery
}>
type GetLedgerAccountSettlementRequest = FastifyRequest<{
	Params: LedgerAccountSettlementIdParams
}>
type CreateLedgerAccountSettlementRequest = FastifyRequest<{
	Body: LedgerAccountSettlementRequest
}>
type UpdateLedgerAccountSettlementRequest = FastifyRequest<{
	Params: LedgerAccountSettlementIdParams
	Body: LedgerAccountSettlementRequest
}>
type DeleteLedgerAccountSettlementRequest = FastifyRequest<{
	Params: LedgerAccountSettlementIdParams
}>
type AddLedgerAccountSettlementEntryRequest = FastifyRequest<{
	Params: LedgerAccountSettlementIdParams
	Body: LedgerAccountSettlementEntriesRequest
}>
type RemoveLedgerAccountSettlementEntryRequest = FastifyRequest<{
	Params: LedgerAccountSettlementIdParams
	Body: LedgerAccountSettlementEntriesRequest
}>

/**
 * Ledger Account Statement
 */
const LedgerAccountStatementId = Type.String({
	description: "The ledger account statement ID",
	pattern: "^lst_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
})
type LedgerAccountStatementId = Static<typeof LedgerAccountStatementId>
const LedgerAccountStatementIdParams = Type.Object({
	ledgerAccountStatmentId: LedgerAccountStatementId,
})
type LedgerAccountStatementIdParams = Static<typeof LedgerAccountStatementIdParams>
const LedgerAccountStatementResponse = Type.Object(
	{
		id: LedgerAccountStatementId,
		ledgerId: LedgerId,
		ledgerAccountId: LedgerAccountId,
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
)
type LedgerAccountStatementResponse = Static<typeof LedgerAccountStatementResponse>
const LedgerAccountStatementRequest = Type.Object(
	{
		ledgerId: LedgerId,
		ledgerAccountId: LedgerAccountId,
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
)
type LedgerAccountStatementRequest = Static<typeof LedgerAccountStatementRequest>
type GetLedgerAccountStatementRequest = FastifyRequest<{
	Params: LedgerAccountStatementIdParams
}>
type CreateLedgerAccountStatementRequest = FastifyRequest<{
	Body: LedgerAccountStatementRequest
}>

/**
 * Ledger Account Balance Monitor
 */
const LedgerAccountBalanceMonitorId = Type.String({
	description: "Unique identifier for the ledger account balance monitor.",
	pattern: "^lbm_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
})
type LedgerAccountBalanceMonitorId = Static<typeof LedgerAccountBalanceMonitorId>
const LedgerAccountBalanceMonitorIdParams = Type.Object({
	ledgerAccountBalanceMonitorId: LedgerAccountBalanceMonitorId,
})
type LedgerAccountBalanceMonitorIdParams = Static<typeof LedgerAccountBalanceMonitorIdParams>
const LedgerAccountBalanceMonitorResponse = Type.Object(
	{
		id: LedgerAccountBalanceMonitorId,
		ledgerAccountId: LedgerAccountId,
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		alertCondition: Type.Array(AlertCondition),
		balances: Balances,
		metadata: Type.Optional(Metadata),
		lockVersion: Type.Number(),
		created: Type.String(),
		updated: Type.String(),
	},
	{
		$id: "LedgerAccountBalanceMonitorResponse",
		description:
			"A ledger account balance monitor is an object that stores an alert_condition for which, when the account's values cross the alert condition, a webhook is sent. Each ledger account balance monitor belongs to a ledger account.",
	}
)
type LedgerAccountBalanceMonitorResponse = Static<typeof LedgerAccountBalanceMonitorResponse>
const LedgerAccountBalanceMonitorRequest = Type.Object(
	{
		ledgerAccountId: Type.String({
			description: "The ledger account associated with this balance monitor.",
		}),
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		alertCondition: Type.Array(AlertCondition),
		metadata: Type.Optional(Metadata),
	},
	{
		$id: "LedgerAccountBalanceMonitorRequest",
	}
)
type LedgerAccountBalanceMonitorRequest = Static<typeof LedgerAccountBalanceMonitorRequest>

type ListLedgerAccountBalanceMonitorsRequest = FastifyRequest<{
	Querystring: PaginationQuery
}>
type GetLedgerAccountBalanceMonitorRequest = FastifyRequest<{
	Params: LedgerAccountBalanceMonitorIdParams
}>
type CreateLedgerAccountBalanceMonitorRequest = FastifyRequest<{
	Body: LedgerAccountBalanceMonitorRequest
}>
type UpdateLedgerAccountBalanceMonitorRequest = FastifyRequest<{
	Params: LedgerAccountBalanceMonitorIdParams
	Body: LedgerAccountBalanceMonitorRequest
}>
type DeleteLedgerAccountBalanceMonitorRequest = FastifyRequest<{
	Params: LedgerAccountBalanceMonitorIdParams
}>

// biome-ignore lint/style/useExportType: false positive
export {
	LinkAccountToCategoryParams,
	LinkCategoryToCategoryParams,
	LedgerId,
	LedgerIdParams,
	LedgerResponse,
	LedgerRequest,
	LedgerAccountIdParams,
	LedgerAccountResponse,
	LedgerAccountRequest,
	LedgerAccountCategoryIdParams,
	LedgerAccountCategoryResponse,
	LedgerAccountCategoryRequest,
	LedgerAccountSettlementIdParams,
	LedgerAccountSettlementResponse,
	LedgerAccountSettlementRequest,
	LedgerAccountSettlementEntriesRequest,
	LedgerAccountStatementIdParams,
	LedgerAccountStatementResponse,
	LedgerAccountStatementRequest,
	LedgerAccountBalanceMonitorIdParams,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
	LedgerTransactionIdParams,
	LedgerTransactionResponse,
	LedgerTransactionRequest,
	LedgerTransactionEntryIdParams,
	LedgerTransactionEntryResponse,
	LedgerTransactionEntryRequest,
	ListLedgersRequest,
	GetLedgerRequest,
	CreateLedgerRequest,
	UpdateLedgerRequest,
	DeleteLedgerRequest,
	ListLedgerAccountsRequest,
	GetLedgerAccountRequest,
	CreateLedgerAccountRequest,
	UpdateLedgerAccountRequest,
	DeleteLedgerAccountRequest,
	ListLedgerAccountCategoriesRequest,
	GetLedgerAccountCategoryRequest,
	CreateLedgerAccountCategoryRequest,
	UpdateLedgerAccountCategoryRequest,
	DeleteLedgerAccountCategoryRequest,
	LinkLedgerAccountToCategoryRequest,
	UnlinkLedgerAccountToCategoryRequest,
	LinkLedgerAccountCategoryToCategoryRequest,
	UnlinkLedgerAccountCategoryToCategoryRequest,
	ListLedgerAccountSettlementsRequest,
	GetLedgerAccountSettlementRequest,
	CreateLedgerAccountSettlementRequest,
	UpdateLedgerAccountSettlementRequest,
	DeleteLedgerAccountSettlementRequest,
	AddLedgerAccountSettlementEntryRequest,
	RemoveLedgerAccountSettlementEntryRequest,
	CreateLedgerAccountStatementRequest,
	GetLedgerAccountStatementRequest,
	ListLedgerAccountBalanceMonitorsRequest,
	GetLedgerAccountBalanceMonitorRequest,
	CreateLedgerAccountBalanceMonitorRequest,
	UpdateLedgerAccountBalanceMonitorRequest,
	DeleteLedgerAccountBalanceMonitorRequest,
	ListLedgerTransactionsRequest,
	GetLedgerTransactionRequest,
	CreateLedgerTransactionRequest,
	UpdateLedgerTransactionRequest,
	DeleteLedgerTransactionRequest,
	ListLedgerTransactionEntriesRequest,
	GetLedgerTransactionEntryRequest,
	UpdateLedgerTransactionEntryRequest,
	// Type exports for entities
	Direction,
	BalanceStatus,
	Balances,
	PendingBalance,
	PostedBalance,
	AvailableBalance,
}
