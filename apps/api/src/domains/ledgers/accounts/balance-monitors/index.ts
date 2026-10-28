import { Layer } from "effect";

import { ledgerAccountBalanceMonitorRepoLayer } from "./LedgerAccountBalanceMonitorRepo";
import { ledgerAccountBalanceMonitorServiceLayer } from "./LedgerAccountBalanceMonitorService";

const balanceMonitorLayer = (encryptionKey: string) =>
	ledgerAccountBalanceMonitorServiceLayer(encryptionKey).pipe(
		Layer.provide(ledgerAccountBalanceMonitorRepoLayer)
	);

export type {
	LedgerAccountBalanceMonitorListQuery,
	LedgerAccountBalanceMonitorRequest,
	LedgerAccountBalanceMonitorResponse,
} from "./LedgerAccountBalanceMonitorSchema";
export type { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";
export { LedgerAccountBalanceMonitorServiceTag } from "./LedgerAccountBalanceMonitorService";
export { balanceMonitorLayer };
