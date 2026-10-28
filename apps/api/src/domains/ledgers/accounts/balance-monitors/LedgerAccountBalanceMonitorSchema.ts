import { Schema } from "effect";

import { AmountSchema } from "@/lib/amounts";
import { MetadataSchema, OmittedWhenUndefined, PaginationQuery } from "@/lib/schema";
import { AccountIdSchema, AccountItemParameters } from "../AccountSchema";

const LedgerAccountBalanceMonitorId = Schema.String.check(
	Schema.isPattern(/^lbm_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
);
const LedgerAccountBalanceMonitorIdParameters = Schema.Struct({
	...AccountItemParameters.fields,
	balanceMonitorId: LedgerAccountBalanceMonitorId,
});
const BalanceType = Schema.Literals(["posted", "pending", "availableBalance"]);
const AlertCondition = Schema.Struct({
	mode: Schema.Literals(["all", "any"]),
	// Mutable because the stored row and accounting mutation types are.
	conditions: Schema.mutable(
		Schema.Array(
			Schema.Struct({
				balanceType: BalanceType,
				operator: Schema.Literals(["=", "!=", "<", "<=", ">", ">="]),
				value: AmountSchema,
			})
		)
	).check(Schema.isMinLength(1)),
});
const BalanceSnapshot = Schema.Struct({
	posted: AmountSchema,
	pending: AmountSchema,
	availableBalance: AmountSchema,
});

// The `uri` format check Fastify's Ajv applied (ajv-formats 3.0.1, "full" mode), copied verbatim from
// ajv-formats/src/formats.ts: `NOT_URI_FRAGMENT` and `URI`. `format` is annotated before `.check` so the
// OpenAPI schema keeps it.
const NOT_URI_FRAGMENT = /\/|:/;
const URI =
	/^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
const UriString = Schema.String.annotate({ format: "uri" }).check(
	Schema.makeFilter(
		value => (NOT_URI_FRAGMENT.test(value) && URI.test(value)) || "Expected a valid URI"
	)
);
const signingSecretPattern = /^whsec_[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const SigningSecret = Schema.String.annotate({ writeOnly: true }).check(
	Schema.isPattern(signingSecretPattern)
);

const LedgerAccountBalanceMonitorRequest = Schema.Struct({
	description: Schema.optionalKey(Schema.String),
	alertCondition: AlertCondition,
	webhook: Schema.Struct({ url: UriString, signingSecret: SigningSecret }),
	metadata: Schema.optionalKey(MetadataSchema),
});
const LedgerAccountBalanceMonitorUpdateRequest = Schema.Struct({
	...LedgerAccountBalanceMonitorRequest.fields,
	webhook: Schema.Struct({ url: UriString, signingSecret: Schema.optionalKey(SigningSecret) }),
});
const LedgerAccountBalanceMonitorResponse = Schema.Struct({
	id: LedgerAccountBalanceMonitorId,
	accountId: AccountIdSchema,
	ledgerId: AccountItemParameters.fields.ledgerId,
	description: OmittedWhenUndefined(Schema.String),
	alertCondition: AlertCondition,
	webhook: Schema.Struct({ url: Schema.String }),
	metadata: OmittedWhenUndefined(MetadataSchema),
	lockVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	created: Schema.String.annotate({ format: "date-time" }),
	updated: Schema.String.annotate({ format: "date-time" }),
});
const LedgerAccountBalanceMonitorListQuerySchema = PaginationQuery;

type AlertCondition = typeof AlertCondition.Type;
type BalanceSnapshot = typeof BalanceSnapshot.Type;
type LedgerAccountBalanceMonitorRequest = typeof LedgerAccountBalanceMonitorRequest.Type;
type LedgerAccountBalanceMonitorUpdateRequest =
	typeof LedgerAccountBalanceMonitorUpdateRequest.Type;
type LedgerAccountBalanceMonitorResponse = typeof LedgerAccountBalanceMonitorResponse.Type;
type LedgerAccountBalanceMonitorIdParameters = typeof LedgerAccountBalanceMonitorIdParameters.Type;
type LedgerAccountBalanceMonitorListQuery = typeof LedgerAccountBalanceMonitorListQuerySchema.Type;
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
