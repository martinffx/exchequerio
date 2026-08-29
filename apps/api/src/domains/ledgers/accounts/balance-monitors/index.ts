import { Layer } from "effect";

import { ledgerAccountBalanceMonitorRepoLayer } from "./LedgerAccountBalanceMonitorRepo";
import { ledgerAccountBalanceMonitorServiceLayer } from "./LedgerAccountBalanceMonitorService";

const balanceMonitorLayer = ledgerAccountBalanceMonitorServiceLayer.pipe(
	Layer.provide(ledgerAccountBalanceMonitorRepoLayer)
);

export { LedgerAccountBalanceMonitor } from "./LedgerAccountBalanceMonitor";
export type {
	LedgerAccountBalanceMonitorMetadata,
	LedgerAccountBalanceMonitorOptions,
} from "./LedgerAccountBalanceMonitor";
export {
	LedgerAccountBalanceMonitorNotFound,
	LedgerAccountBalanceMonitorPersistenceDecodingFailure,
	LedgerAccountBalanceMonitorPersistenceFailure,
} from "./LedgerAccountBalanceMonitorErrors";
export { LedgerAccountBalanceMonitorRoutes } from "./LedgerAccountBalanceMonitorRoutes";
export type {
	LedgerAccountBalanceMonitorListQuery,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
} from "./LedgerAccountBalanceMonitorSchema";
export type {
	LedgerAccountBalanceMonitorCreateError,
	LedgerAccountBalanceMonitorDeleteError,
	LedgerAccountBalanceMonitorGetError,
	LedgerAccountBalanceMonitorListError,
	LedgerAccountBalanceMonitorUpdateError,
} from "./LedgerAccountBalanceMonitorService";
export {
	LedgerAccountBalanceMonitorService,
	LedgerAccountBalanceMonitorServiceTag,
} from "./LedgerAccountBalanceMonitorService";
export { balanceMonitorLayer };
