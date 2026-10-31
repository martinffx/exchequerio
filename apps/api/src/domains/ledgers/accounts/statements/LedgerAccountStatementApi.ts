import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { ConflictApiError, NotFoundApiError, operation, throttledErrors } from "@/lib/ApiContract";
import { IdempotencyHeaders } from "@/lib/IdempotencySchema";
import {
	LedgerAccountStatementIdParameters,
	LedgerAccountStatementRequest,
	LedgerAccountStatementResponse,
	StatementCollectionParameters,
	StatementEntriesResponse,
	StatementListQuery,
	StatementListResponse,
	StatementUpdateRequest,
} from "./LedgerAccountStatementSchema";

// Every route declares 429. Create and update add 409. Permissions are enforced by the handlers:
// ledger:account:statement:read for GET, ledger:account:statement:write for POST and PUT.

const prefix = "/ledgers/:ledgerId/accounts/:accountId/statements";

const StatementsApi = HttpApiGroup.make("statements")
	.add(
		HttpApiEndpoint.get("list", `${prefix}/`, {
			params: StatementCollectionParameters,
			query: StatementListQuery,
			success: StatementListResponse,
			error: [NotFoundApiError, ...throttledErrors],
		}).annotateMerge(
			operation(
				"listLedgerAccountStatements",
				"List Ledger Account Statements",
				"Lists saved Statement summaries newest first. Entry data is retrieved separately."
			)
		),
		HttpApiEndpoint.get("get", `${prefix}/:statementId`, {
			params: LedgerAccountStatementIdParameters,
			success: LedgerAccountStatementResponse,
			error: [NotFoundApiError, ...throttledErrors],
		}).annotateMerge(
			operation(
				"getLedgerAccountStatement",
				"Get Ledger Account Statement",
				"Returns captured Account context and balances with current Statement annotations. Accounting data never changes after creation."
			)
		),
		HttpApiEndpoint.get("entries", `${prefix}/:statementId/entries`, {
			params: LedgerAccountStatementIdParameters,
			query: StatementListQuery,
			success: StatementEntriesResponse,
			error: [NotFoundApiError, ...throttledErrors],
		}).annotateMerge(
			operation(
				"getLedgerAccountStatementEntries",
				"Get Statement Entries",
				"Pages copied Account Entries and their Transaction context, ordered by Effective Time then Entry ID. Later Transaction changes do not affect this data."
			)
		),
		// Create answers 200 without a Location header, as before.
		HttpApiEndpoint.post("create", `${prefix}/`, {
			params: StatementCollectionParameters,
			headers: IdempotencyHeaders,
			payload: LedgerAccountStatementRequest,
			success: LedgerAccountStatementResponse,
			error: [NotFoundApiError, ConflictApiError, ...throttledErrors],
		}).annotateMerge(
			operation(
				"createLedgerAccountStatement",
				"Create Ledger Account Statement",
				"Captures current Posted and Pending Entry data for a start-inclusive, end-exclusive Effective Time period, with all three opening and closing balances. Empty and future periods are allowed. Limited to 10,000 period Entries and 16 MiB of serialized snapshot data. Reuse the action key only for retries within the existing 15-minute idempotency window."
			)
		),
		HttpApiEndpoint.put("update", `${prefix}/:statementId`, {
			params: LedgerAccountStatementIdParameters,
			payload: StatementUpdateRequest,
			success: LedgerAccountStatementResponse,
			error: [NotFoundApiError, ConflictApiError, ...throttledErrors],
		}).annotateMerge(
			operation(
				"updateLedgerAccountStatement",
				"Replace Statement Annotations",
				"Replaces description and metadata; omitted annotations are cleared. The expected lockVersion must match and is incremented on success. Stale versions return 409. Accounting snapshot data and ledgerAccountVersion remain unchanged."
			)
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
