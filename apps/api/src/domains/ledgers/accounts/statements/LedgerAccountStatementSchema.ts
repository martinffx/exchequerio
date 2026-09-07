import { type Static, Type } from "@sinclair/typebox";
import type { FastifyRequest } from "fastify";

import { AssetSummarySchema } from "@/lib/AssetSchema";
import { MetadataSchema } from "@/lib/schema";
const NormalBalance = Type.Union([Type.Literal("debit"), Type.Literal("credit")]);
const LedgerId = Type.String({
	description: "The ledger's ID",
	pattern: "^lgr_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
const LedgerAccountId = Type.String({
	description: "The ledger account's ID",
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
		...AssetSummarySchema.properties,
		metadata: Type.Optional(MetadataSchema),
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
