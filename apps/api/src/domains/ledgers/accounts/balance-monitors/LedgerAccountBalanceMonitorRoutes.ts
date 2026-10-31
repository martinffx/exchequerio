import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { LedgerApi } from "@/api";
import { CurrentToken, requirePermissions } from "@/auth";
import { LedgerAccountBalanceMonitorServiceTag } from "./LedgerAccountBalanceMonitorService";
import { runToCompletion } from "@/lib/utils";

const scopeOf = (params: { ledgerId: string; accountId: string }) =>
	Effect.gen(function* () {
		const token = yield* CurrentToken;
		return {
			organizationId: token.orgId.toString(),
			ledgerId: params.ledgerId,
			accountId: params.accountId,
		};
	});

/** The service parses the raw path IDs, so they are forwarded as strings inside the scope. */
const LedgerAccountBalanceMonitorRoutes = HttpApiBuilder.group(
	LedgerApi,
	"balanceMonitors",
	handlers =>
		Effect.gen(function* () {
			const service = yield* LedgerAccountBalanceMonitorServiceTag;
			return handlers
				.handle(
					"list",
					({ params, query }) =>
						Effect.gen(function* () {
							yield* requirePermissions(["ledger:account:balance_monitor:read"]);
							const monitors = yield* service.listLedgerAccountBalanceMonitors(
								yield* scopeOf(params),
								query.offset,
								query.limit
							);
							return monitors.map(monitor => monitor.toResponse());
						}),
					runToCompletion
				)
				.handle(
					"get",
					({ params }) =>
						Effect.gen(function* () {
							yield* requirePermissions(["ledger:account:balance_monitor:read"]);
							const monitor = yield* service.getLedgerAccountBalanceMonitor(
								yield* scopeOf(params),
								params.balanceMonitorId
							);
							return monitor.toResponse();
						}),
					runToCompletion
				)
				.handle(
					"create",
					({ params, payload }) =>
						Effect.gen(function* () {
							yield* requirePermissions(["ledger:account:balance_monitor:write"]);
							const monitor = yield* service.createLedgerAccountBalanceMonitor(
								yield* scopeOf(params),
								payload
							);
							return monitor.toResponse();
						}),
					runToCompletion
				)
				.handle(
					"update",
					({ params, payload }) =>
						Effect.gen(function* () {
							yield* requirePermissions(["ledger:account:balance_monitor:write"]);
							const monitor = yield* service.updateLedgerAccountBalanceMonitor(
								yield* scopeOf(params),
								params.balanceMonitorId,
								payload
							);
							return monitor.toResponse();
						}),
					runToCompletion
				)
				.handle(
					"delete",
					({ params }) =>
						Effect.gen(function* () {
							yield* requirePermissions(["ledger:account:balance_monitor:delete"]);
							yield* service.deleteLedgerAccountBalanceMonitor(
								yield* scopeOf(params),
								params.balanceMonitorId
							);
						}),
					runToCompletion
				);
		})
);

export { LedgerAccountBalanceMonitorRoutes };
