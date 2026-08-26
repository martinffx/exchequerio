import { Layer } from "effect";
import { ledgerAccountRepoLayer } from "./LedgerAccountRepo";
import { accountServiceLayer } from "./AccountService";

const accountLayer = accountServiceLayer.pipe(Layer.provide(ledgerAccountRepoLayer));

export { LedgerAccount, LedgerAccountCurrencyMismatch } from "./domain/LedgerAccount";
export type {
	LedgerAccountBalance,
	LedgerAccountMetadata,
	LedgerAccountOptions,
} from "./domain/LedgerAccount";
export {
	AccountHasDependents,
	AccountNameConflict,
	AccountNotFound,
	AccountPersistenceDecodingFailure,
	AccountPersistenceFailure,
	AccountRepositoryUnavailable,
	AccountVersionConflict,
} from "./AccountErrors";
export { AccountRoutes } from "./AccountRoutes";
export type {
	AccountCreateRequest,
	AccountListQuery,
	AccountResponse,
	AccountUpdateRequest,
} from "./AccountSchema";
export { toAccountResponse } from "./AccountSchema";
export type { AccountService } from "./AccountService";
export { AccountServiceTag } from "./AccountService";
export { accountLayer };
