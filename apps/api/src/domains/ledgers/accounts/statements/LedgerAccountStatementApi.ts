import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { describedOperation, throttledErrors } from "@/lib/ApiContract";
import { ConflictApiError, NotFoundApiError } from "@/lib/errors";
import {
	LedgerAccountStatementCollectionParameters,
	LedgerAccountStatementIdParameters,
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
} from "./LedgerAccountStatementSchema";

// Both routes declare 429. Create adds 409. Permissions are
// enforced by the handlers: statement:read for GET, statement:write for POST.

const prefix = "/ledgers/:ledgerId/accounts/:accountId/statements";

const StatementsApi = HttpApiGroup.make("statements")
	.add(
		// ledgerId and accountId are in the path but deliberately not validated: only statementId is.
		HttpApiEndpoint.get("get", `${prefix}/:statementId`, {
			params: LedgerAccountStatementIdParameters,
			success: LedgerAccountStatementResponse,
			error: [NotFoundApiError, ...throttledErrors],
		}).annotateMerge(describedOperation("getLedgerAccountStatement", "Get Ledger Account Statement")),
		// Legacy create answers 200 without a Location header and reads ledgerId/accountId from the body.
		HttpApiEndpoint.post("create", `${prefix}/`, {
			params: LedgerAccountStatementCollectionParameters,
			payload: LedgerAccountStatementRequest,
			success: LedgerAccountStatementResponse,
			error: [NotFoundApiError, ConflictApiError, ...throttledErrors],
		}).annotateMerge(
			describedOperation("createLedgerAccountStatement", "Create Ledger Account Statement")
		)
	)
	.annotateMerge(
		OpenApi.annotations({
			title: "Ledger Account Statements",
			description:
				"A ledger account statement provides the starting and ending balances for a specific time period.",
		})
	);

export { StatementsApi };
