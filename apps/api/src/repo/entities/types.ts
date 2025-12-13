import type { TypeID } from "typeid-js";

// Shared type definitions for all entities
export type LedgerID = TypeID<"lgr">;
export type OrgID = TypeID<"org">;
export type LedgerAccountID = TypeID<"lat">;
export type LedgerAccountCategoryID = TypeID<"lac">;
export type LedgerTransactionID = TypeID<"ltr">;
export type LedgerTransactionEntryID = TypeID<"lte">;
export type LedgerAccountSettlementID = TypeID<"las">;
export type LedgerAccountBalanceMonitorID = TypeID<"lbm">;
export type LedgerAccountStatementID = TypeID<"lst">;
