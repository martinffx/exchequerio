import { CloneType, type Static, Type } from "@sinclair/typebox";

import { AmountSchema } from "@/lib/amounts";
import { MetadataSchema } from "@/lib/schema";
import { PaginationQuery } from "@/lib/schema";
import { AccountIdSchema } from "@/domains/ledgers/accounts/AccountSchema";

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
const AlertCondition = Type.Union([
	Type.Object({ field: Type.Literal("balance"), operator: AlertOperator, value: AmountSchema }),
	Type.Object({
		field: Type.Union([Type.Literal("created"), Type.Literal("updated")]),
		operator: AlertOperator,
		value: Type.Number(),
	}),
]);

const LedgerAccountBalanceMonitorResponse = Type.Object(
	{
		id: LedgerAccountBalanceMonitorId,
		accountId: CloneType(AccountIdSchema, { description: "The ledger account's ID" }),
		description: Type.Optional(
			Type.String({
				description: "An optional free-form description for internal use.",
			})
		),
		alertCondition: Type.Array(AlertCondition),
		metadata: Type.Optional(MetadataSchema),
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
		metadata: Type.Optional(MetadataSchema),
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
