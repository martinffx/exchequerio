import { Layer } from "effect";
import { accountRepoLayer } from "./AccountRepo";
import { accountServiceLayer } from "./AccountService";

const accountLayer = accountServiceLayer.pipe(Layer.provide(accountRepoLayer));

export { Account } from "./domain/Account";
export type { AccountBalance, AccountMetadata, AccountOptions } from "./domain/Account";
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
