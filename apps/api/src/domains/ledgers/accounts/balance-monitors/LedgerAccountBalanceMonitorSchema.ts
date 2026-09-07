import { type Static, Type } from "@sinclair/typebox";
import { MetadataSchema } from "@/lib/schema";
import { PaginationQuery } from "@/routes/schema";
import { AccountItemParameters, AccountIdSchema } from "../AccountSchema";

const LedgerAccountBalanceMonitorId = Type.String({ pattern: "^lbm_[0-7][0-9a-hjkmnp-tv-z]{25}$" });
const LedgerAccountBalanceMonitorIdParameters = Type.Intersect([
	AccountItemParameters,
	Type.Object({ balanceMonitorId: LedgerAccountBalanceMonitorId }),
]);
const BalanceType = Type.Union([
	Type.Literal("posted"),
	Type.Literal("pending"),
	Type.Literal("availableBalance"),
]);
const AlertCondition = Type.Object(
	{
		mode: Type.Union([Type.Literal("all"), Type.Literal("any")]),
		conditions: Type.Array(
			Type.Object(
				{
					balanceType: BalanceType,
					operator: Type.Union([
						Type.Literal("="),
						Type.Literal("!="),
						Type.Literal("<"),
						Type.Literal("<="),
						Type.Literal(">"),
						Type.Literal(">="),
					]),
					value: Type.Integer({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
				},
				{ additionalProperties: false }
			),
			{ minItems: 1 }
		),
	},
	{ additionalProperties: false }
);
const BalanceSnapshot = Type.Object({
	posted: Type.Integer(),
	pending: Type.Integer(),
	availableBalance: Type.Integer(),
});
const LedgerAccountBalanceMonitorRequest = Type.Object(
	{
		description: Type.Optional(Type.String()),
		alertCondition: AlertCondition,
		webhook: Type.Object(
			{
				url: Type.String({ format: "uri" }),
				bearerToken: Type.String({ minLength: 1, writeOnly: true }),
			},
			{ additionalProperties: false }
		),
		metadata: Type.Optional(MetadataSchema),
	},
	{ additionalProperties: false }
);
const LedgerAccountBalanceMonitorUpdateRequest = Type.Object(
	{
		...LedgerAccountBalanceMonitorRequest.properties,
		webhook: Type.Object(
			{
				url: Type.String({ format: "uri" }),
				bearerToken: Type.Optional(Type.String({ minLength: 1, writeOnly: true })),
			},
			{ additionalProperties: false }
		),
	},
	{ additionalProperties: false }
);
const LedgerAccountBalanceMonitorResponse = Type.Object({
	id: LedgerAccountBalanceMonitorId,
	accountId: AccountIdSchema,
	ledgerId: AccountItemParameters.properties.ledgerId,
	description: Type.Optional(Type.String()),
	alertCondition: AlertCondition,
	webhook: Type.Object({ url: Type.String() }),
	metadata: Type.Optional(MetadataSchema),
	lockVersion: Type.Integer({ minimum: 1 }),
	created: Type.String({ format: "date-time" }),
	updated: Type.String({ format: "date-time" }),
});
const LedgerAccountBalanceMonitorListQuerySchema = PaginationQuery;
type AlertCondition = Static<typeof AlertCondition>;
type BalanceSnapshot = Static<typeof BalanceSnapshot>;
type LedgerAccountBalanceMonitorRequest = Static<typeof LedgerAccountBalanceMonitorRequest>;
type LedgerAccountBalanceMonitorUpdateRequest = Static<
	typeof LedgerAccountBalanceMonitorUpdateRequest
>;
type LedgerAccountBalanceMonitorResponse = Static<typeof LedgerAccountBalanceMonitorResponse>;
type LedgerAccountBalanceMonitorIdParameters = Static<
	typeof LedgerAccountBalanceMonitorIdParameters
>;
type LedgerAccountBalanceMonitorListQuery = Static<
	typeof LedgerAccountBalanceMonitorListQuerySchema
>;
export {
	AlertCondition,
	BalanceSnapshot,
	LedgerAccountBalanceMonitorId,
	LedgerAccountBalanceMonitorIdParameters,
	LedgerAccountBalanceMonitorListQuerySchema,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorUpdateRequest,
	LedgerAccountBalanceMonitorResponse,
};
export type { LedgerAccountBalanceMonitorListQuery };
