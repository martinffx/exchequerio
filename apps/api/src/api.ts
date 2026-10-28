import { Effect } from "effect";
import { HttpApi, HttpApiMiddleware, OpenApi, type HttpApiError } from "effect/unstable/httpapi";
import { Authentication } from "@/auth";
import { CategoriesApi } from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryApi";
import { AccountsApi } from "@/domains/ledgers/accounts/AccountApi";
import { BalanceMonitorsApi } from "@/domains/ledgers/accounts/balance-monitors/LedgerAccountBalanceMonitorApi";
import { StatementsApi } from "@/domains/ledgers/accounts/statements/LedgerAccountStatementApi";
import { AssetsApi } from "@/domains/assets/AssetApi";
import { SettlementsApi } from "@/domains/ledgers/settlements/LedgerAccountSettlementApi";
import { TransactionsApi } from "@/domains/ledgers/transactions/LedgerTransactionApi";
import { LedgersApi } from "@/domains/ledgers/LedgerApi";
import { OrganizationApi } from "@/domains/organizations/OrganizationApi";
import { BadRequestApiError, BadRequestError } from "@/lib/errors";

/** Turns request decode failures into the BAD_REQUEST problem; see `SchemaErrorTransformLayer`. */
class SchemaErrorTransform extends HttpApiMiddleware.Service<SchemaErrorTransform>()(
	"SchemaErrorTransform",
	{ error: BadRequestApiError }
) {}

const requestKinds: ReadonlySet<HttpApiError.HttpApiSchemaError["kind"]> = new Set([
	"Params",
	"Headers",
	"Query",
	"Payload",
]);

// Fixed Payload 400 details, keyed by group then endpoint name (`context.group.identifier`, `context.endpoint.identifier`).
const payloadDetails: Readonly<
	Record<string, Readonly<Record<string, string | undefined>> | undefined>
> = {
	assets: {
		create: "Invalid Asset creation request",
		update: "Invalid Asset replacement request",
	},
};

/**
 * Request kinds (including malformed JSON, which arrives as a Payload error) become a 400 problem
 * with the Effect Schema message as detail. Response kinds (Body, ResponseHeaders) are re-thrown
 * unchanged; HttpApi turns them into a defect that the global router middleware renders as a 500.
 */
const SchemaErrorTransformLayer = HttpApiMiddleware.layerSchemaErrorTransform(
	SchemaErrorTransform,
	(schemaError, { endpoint, group }) =>
		requestKinds.has(schemaError.kind)
			? Effect.fail(
					new BadRequestError(
						// One fixed detail is reported for any invalid Asset write body.
						(schemaError.kind === "Payload"
							? payloadDetails[group.identifier]?.[endpoint.identifier]
							: undefined) ?? schemaError.cause.message,
						{ cause: schemaError }
					)
				)
			: Effect.fail(schemaError)
);

// Groups are only added inside `.add(...)`: `.prefix` and `.middleware` apply to the groups already added.
// SchemaErrorTransform is added last so it wraps Authentication and every handler: auth runs first,
// then request decoding.
class LedgerApi extends HttpApi.make("ledger")
	.add(
		OrganizationApi,
		AssetsApi,
		LedgersApi,
		AccountsApi,
		CategoriesApi,
		TransactionsApi,
		SettlementsApi,
		StatementsApi,
		BalanceMonitorsApi
	)
	.prefix("/api")
	.middleware(Authentication)
	.middleware(SchemaErrorTransform)
	.annotateMerge(
		OpenApi.annotations({
			title: "Ledger API",
			description: "An API for ledger accounts",
			version: "0.1.0",
			servers: [{ url: "http://localhost:3000", description: "Development server" }],
		})
	) {}

export { LedgerApi, SchemaErrorTransformLayer };
