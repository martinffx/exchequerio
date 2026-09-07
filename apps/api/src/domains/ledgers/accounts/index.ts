import { Layer } from "effect";
import { ledgerAccountRepoLayer } from "./LedgerAccountRepo";
import { accountServiceLayer } from "./AccountService";

const accountLayer = accountServiceLayer.pipe(Layer.provide(ledgerAccountRepoLayer));

export { LedgerAccount, LedgerAccountAssetMismatch } from "./LedgerAccount";
export type { LedgerAccountBalance, LedgerAccountOptions } from "./LedgerAccount";
export {
	AccountHasDependents,
	AccountNameConflict,
	AccountNotFound,
	AccountPersistenceDecodingFailure,
	AccountPersistenceFailure,
	AccountRepositoryUnavailable,
	AccountVersionConflict,
	requireAccount,
	requireAccountWrite,
} from "./AccountErrors";
export { AccountRoutes } from "./AccountRoutes";
export type {
	AccountCreateRequest,
	AccountListQuery,
	AccountResponse,
	AccountUpdateRequest,
} from "./AccountSchema";
export type { AccountService } from "./AccountService";
export { AccountServiceTag } from "./AccountService";
export { accountLayer };
