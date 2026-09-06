import { Layer } from "effect";
import { ledgerTransactionRepoLayer } from "../transactions/LedgerTransactionRepo";
import { ledgerAccountSettlementRepoLayer } from "./LedgerAccountSettlementRepo";
import { ledgerAccountSettlementServiceLayer } from "./LedgerAccountSettlementService";
/** Provides Settlement and Transaction persistence to the Settlement service. */
const settlementLayer = ledgerAccountSettlementServiceLayer.pipe(
	Layer.provide(Layer.mergeAll(ledgerAccountSettlementRepoLayer, ledgerTransactionRepoLayer))
);
export { settlementLayer };
export { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
export type { LedgerAccountSettlementEntityOptions } from "./LedgerAccountSettlementEntity";
export {
	LedgerAccountSettlementRepoLive,
	LedgerAccountSettlementRepoTag,
	ledgerAccountSettlementRepoLayer,
} from "./LedgerAccountSettlementRepo";
export type { LedgerAccountSettlementRepo } from "./LedgerAccountSettlementRepo";
export {
	LedgerAccountSettlementService,
	LedgerAccountSettlementServiceTag,
	ledgerAccountSettlementServiceLayer,
} from "./LedgerAccountSettlementService";
export { LedgerAccountSettlementRoutes } from "./LedgerAccountSettlementRoutes";
export * from "./LedgerAccountSettlementSchema";
