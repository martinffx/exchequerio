import { Layer } from "effect";

import { ledgerAccountBalanceMonitorRepoLayer } from "./LedgerAccountBalanceMonitorRepo";
import { ledgerAccountBalanceMonitorServiceLayer } from "./LedgerAccountBalanceMonitorService";

const balanceMonitorLayer = ledgerAccountBalanceMonitorServiceLayer.pipe(
	Layer.provide(ledgerAccountBalanceMonitorRepoLayer)
);

export { LedgerAccountBalanceMonitorRoutes } from "./LedgerAccountBalanceMonitorRoutes";
export type {
	LedgerAccountBalanceMonitorListQuery,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
} from "./LedgerAccountBalanceMonitorSchema";
export type { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";
export { LedgerAccountBalanceMonitorServiceTag } from "./LedgerAccountBalanceMonitorService";
export { balanceMonitorLayer };
