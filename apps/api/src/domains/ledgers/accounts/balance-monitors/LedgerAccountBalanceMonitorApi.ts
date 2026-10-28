import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { ConflictApiError, NotFoundApiError } from "@/lib/errors";
import { describedOperation, throttledErrors } from "@/lib/ApiContract";
import { AccountItemParameters } from "../AccountSchema";
import {
	LedgerAccountBalanceMonitorIdParameters,
	LedgerAccountBalanceMonitorListQuerySchema,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
	LedgerAccountBalanceMonitorUpdateRequest,
} from "./LedgerAccountBalanceMonitorSchema";

// Every route declares 429. Permissions are enforced by the handlers: balance_monitor:read for the
// GETs, :write for create and update, :delete for delete.
const itemErrors = [NotFoundApiError, ...throttledErrors] as const;
const writeErrors = [NotFoundApiError, ConflictApiError, ...throttledErrors] as const;

const prefix = "/ledgers/:ledgerId/accounts/:accountId/balance-monitors";

const BalanceMonitorsApi = HttpApiGroup.make("balanceMonitors")
	.add(
		HttpApiEndpoint.get("list", `${prefix}/`, {
			params: AccountItemParameters,
			query: LedgerAccountBalanceMonitorListQuerySchema,
			success: Schema.Array(LedgerAccountBalanceMonitorResponse),
			error: itemErrors,
		}).annotateMerge(
			describedOperation("listLedgerAccountBalanceMonitors", "List Ledger Account Balance Monitors")
		),
		HttpApiEndpoint.get("get", `${prefix}/:balanceMonitorId`, {
			params: LedgerAccountBalanceMonitorIdParameters,
			success: LedgerAccountBalanceMonitorResponse,
			error: itemErrors,
		}).annotateMerge(
			describedOperation("getLedgerAccountBalanceMonitor", "Get Ledger Account Balance Monitor")
		),
		HttpApiEndpoint.post("create", `${prefix}/`, {
			params: AccountItemParameters,
			payload: LedgerAccountBalanceMonitorRequest,
			success: LedgerAccountBalanceMonitorResponse,
			error: writeErrors,
		}).annotateMerge(
			describedOperation("createLedgerAccountBalanceMonitor", "Create Ledger Account Balance Monitor")
		),
		HttpApiEndpoint.put("update", `${prefix}/:balanceMonitorId`, {
			params: LedgerAccountBalanceMonitorIdParameters,
			payload: LedgerAccountBalanceMonitorUpdateRequest,
			success: LedgerAccountBalanceMonitorResponse,
			error: writeErrors,
		}).annotateMerge(
			describedOperation("updateLedgerAccountBalanceMonitor", "Update Ledger Account Balance Monitor")
		),
		HttpApiEndpoint.delete("delete", `${prefix}/:balanceMonitorId`, {
			params: LedgerAccountBalanceMonitorIdParameters,
			success: HttpApiSchema.Empty(200),
			error: writeErrors,
		}).annotateMerge(
			describedOperation("deleteLedgerAccountBalanceMonitor", "Delete Ledger Account Balance Monitor")
		)
	)
	.annotateMerge(OpenApi.annotations({ title: "Ledger Account Balance Monitors" }));

export { BalanceMonitorsApi };
