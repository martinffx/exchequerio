import { Layer } from "effect";
import { ledgerRepoLayer } from "./LedgerRepo";
import { ledgerServiceLayer } from "./LedgerService";

const ledgerLayer = ledgerServiceLayer.pipe(Layer.provide(ledgerRepoLayer));

export { Ledger } from "./Ledger";
export type { LedgerOptions } from "./Ledger";
export {
	LedgerHasDependents,
	LedgerNotFound,
	LedgerPersistenceDecodingFailure,
	LedgerPersistenceFailure,
	LedgerRepositoryUnavailable,
} from "./LedgerErrors";
export { LedgerRoutes } from "./LedgerRoutes";
export type {
	LedgerCreateError,
	LedgerDeleteError,
	LedgerGetError,
	LedgerListError,
	LedgerService,
	LedgerUpdateError,
} from "./LedgerService";
export { LedgerServiceTag } from "./LedgerService";
export { ledgerLayer };
