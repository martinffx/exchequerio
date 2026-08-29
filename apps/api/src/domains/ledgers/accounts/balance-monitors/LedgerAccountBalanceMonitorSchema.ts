import { type Static, Type } from "@sinclair/typebox";

import { PaginationQuery } from "@/routes/schema";
import { Balances, LedgerAccountIdParams, LedgerRequest } from "@/routes/ledgers/schema";

const LedgerAccountBalanceMonitorId = Type.String({
	description: "Unique identifier for the ledger account balance monitor.",
	pattern: "^lbm_[0-7][0-9a-hjkmnp-tv-z]{25}$",
});
const LedgerAccountBalanceMonitorIdParameters = Type.Object({
	balanceMonitorId: LedgerAccountBalanceMonitorId,
});

const AlertOperator = Type.Union([
	Type.Literal("="),
	Type.Literal("<"),
	Type.Literal(">"),
	Type.Literal("<="),
	Type.Literal(">="),
	Type.Literal("!="),
]);
const AlertField = Type.Union([
	Type.Literal("balance"),
	Type.Literal("created"),
	Type.Literal("updated"),
]);
const AlertCondition = Type.Object({
	field: AlertField,
	operator: AlertOperator,
	value: Type.Number(),
});

const LedgerAccountBalanceMonitorResponse = Type.Object(
	{
		id: LedgerAccountBalanceMonitorId,
		accountId: LedgerAccountIdParams.properties.accountId,
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		alertCondition: Type.Array(AlertCondition),
		balances: Balances,
		metadata: LedgerRequest.properties.metadata,
		lockVersion: Type.Number(),
		created: Type.String(),
		updated: Type.String(),
	},
	{
		$id: "LedgerAccountBalanceMonitorResponse",
		description:
			"A ledger account balance monitor is an object that stores an alert_condition for which, when the account's values cross the alert condition, a webhook is sent. Each ledger account balance monitor belongs to a ledger account.",
	}
);

const LedgerAccountBalanceMonitorRequest = Type.Object(
	{
		accountId: Type.String({
			description: "The ledger account associated with this balance monitor.",
		}),
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		alertCondition: Type.Array(AlertCondition),
		metadata: LedgerRequest.properties.metadata,
	},
	{
		$id: "LedgerAccountBalanceMonitorRequest",
	}
);

const LedgerAccountBalanceMonitorListQuerySchema = PaginationQuery;

type LedgerAccountBalanceMonitorIdParameters = Static<
	typeof LedgerAccountBalanceMonitorIdParameters
>;
type LedgerAccountBalanceMonitorRequest = Static<typeof LedgerAccountBalanceMonitorRequest>;
type LedgerAccountBalanceMonitorResponse = Static<typeof LedgerAccountBalanceMonitorResponse>;
type LedgerAccountBalanceMonitorListQuery = Static<typeof PaginationQuery>;

export {
	LedgerAccountBalanceMonitorId,
	LedgerAccountBalanceMonitorIdParameters,
	LedgerAccountBalanceMonitorListQuerySchema,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
};
export type { LedgerAccountBalanceMonitorListQuery };
