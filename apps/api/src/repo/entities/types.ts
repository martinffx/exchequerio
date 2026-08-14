import { TypeID } from "typeid-js";

// Shared type definitions for all entities
type LedgerID = TypeID<"lgr">;
function newLedgerID(): LedgerID {
	return new TypeID<"lgr">("lgr") as LedgerID;
}

type OrgID = TypeID<"org">;
function newOrgID(): OrgID {
	return new TypeID<"org">("org") as OrgID;
}

type LedgerAccountID = TypeID<"lat">;
function newLedgerAccountID(): LedgerAccountID {
	return new TypeID<"lat">("lat") as LedgerAccountID;
}

type LedgerAccountCategoryID = TypeID<"lac">;
function newLedgerAccountCategoryID(): LedgerAccountCategoryID {
	return new TypeID<"lac">("lac") as LedgerAccountCategoryID;
}

type LedgerTransactionID = TypeID<"ltr">;
function newLedgerTransactionID(): LedgerTransactionID {
	return new TypeID<"ltr">("ltr") as LedgerTransactionID;
}

type LedgerTransactionEntryID = TypeID<"lte">;
function newLedgerTransactionEntryID(): LedgerTransactionEntryID {
	return new TypeID<"lte">("lte") as LedgerTransactionEntryID;
}

type LedgerAccountSettlementID = TypeID<"las">;
function newLedgerAccountSettlementID(): LedgerAccountSettlementID {
	return new TypeID<"las">("las") as LedgerAccountSettlementID;
}

type LedgerAccountBalanceMonitorID = TypeID<"lbm">;
function newLedgerAccountBalanceMonitorID(): LedgerAccountBalanceMonitorID {
	return new TypeID<"lbm">("lbm") as LedgerAccountBalanceMonitorID;
}

type LedgerAccountStatementID = TypeID<"lst">;
function newLedgerAccountStatementID(): LedgerAccountStatementID {
	return new TypeID<"lst">("lst") as LedgerAccountStatementID;
}

export type {
	LedgerID,
	OrgID,
	LedgerAccountID,
	LedgerAccountCategoryID,
	LedgerTransactionID,
	LedgerTransactionEntryID,
	LedgerAccountSettlementID,
	LedgerAccountBalanceMonitorID,
	LedgerAccountStatementID,
};
export {
	newLedgerAccountBalanceMonitorID,
	newLedgerAccountCategoryID,
	newLedgerAccountID,
	newLedgerAccountSettlementID,
	newLedgerAccountStatementID,
	newLedgerID,
	newLedgerTransactionEntryID,
	newLedgerTransactionID,
	newOrgID,
};
