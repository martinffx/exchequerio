import { type Static, Type } from "@sinclair/typebox";
import type { FastifyRequest } from "fastify";

const Metadata = Type.Mapped(Type.KeyOf(Type.String()), () => Type.String(), {
	description:
		"Additional data represented as key-value pairs. Both the key and value must be strings.",
});
const NormalBalance = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
const Balance = Type.Union([
	Type.Object({
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
		currency: Type.String({ description: "Currency of the ledger" }),
		currencyExponent: Type.Number({ description: "Currency exponent of the ledger" }),
	}),
	Type.Object({
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
		currency: Type.String({ description: "Currency of the ledger" }),
		currencyExponent: Type.Number({ description: "Currency exponent of the ledger" }),
	}),
	Type.Object({
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
		currency: Type.String({ description: "Currency of the ledger" }),
		currencyExponent: Type.Number({ description: "Currency exponent of the ledger" }),
	}),
]);
const Balances = Type.Array(Balance, {
	description: "The pending, posted, and available balances.",
});
const LedgerId = Type.String({
	description: "The ledger's ID",
	pattern: "^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
const LedgerAccountId = Type.String({
	description: "The ledger account ID",
	pattern: "^lat_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
const LedgerAccountStatementId = Type.String({
	description: "The ledger account statement ID",
	pattern: "^lst_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
const LedgerAccountStatementIdParameters = Type.Object({
	statementId: LedgerAccountStatementId,
});
const LedgerAccountStatementResponse = Type.Object(
	{
		id: LedgerAccountStatementId,
		ledgerId: LedgerId,
		accountId: LedgerAccountId,
		description: Type.Optional(
			Type.String({ description: "An optional free-form description for internal use." })
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
		currency: Type.String({ description: "The currency of the ledger account settlement." }),
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
const LedgerAccountStatementRequest = Type.Object(
	{
		ledgerId: LedgerId,
		accountId: LedgerAccountId,
		description: Type.Optional(
			Type.String({ description: "An optional free-form description for internal use." })
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
	{ $id: "LedgerAccountStatementRequest" }
);

type LedgerAccountStatementIdParameters = Static<typeof LedgerAccountStatementIdParameters>;
type LedgerAccountStatementRequest = Static<typeof LedgerAccountStatementRequest>;
type LedgerAccountStatementResponse = Static<typeof LedgerAccountStatementResponse>;
type GetLedgerAccountStatementRequest = FastifyRequest<{
	Params: LedgerAccountStatementIdParameters;
}>;
type CreateLedgerAccountStatementRequest = FastifyRequest<{
	Body: LedgerAccountStatementRequest;
}>;

export {
	LedgerAccountStatementIdParameters,
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
};
export type { CreateLedgerAccountStatementRequest, GetLedgerAccountStatementRequest };
