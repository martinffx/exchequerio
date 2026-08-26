import { Layer } from "effect";

import { ledgerTransactionRepoLayer } from "./LedgerTransactionRepo";
import { transactionServiceLayer } from "./TransactionService";

const transactionLayer = transactionServiceLayer.pipe(Layer.provide(ledgerTransactionRepoLayer));

export { TransactionRoutes } from "./TransactionRoutes";
export type {
	TransactionCreateError,
	TransactionGetError,
	TransactionListError,
	TransactionService,
	TransactionTransitionError,
	TransactionUpdateError,
} from "./TransactionService";
export { TransactionServiceTag } from "./TransactionService";
export { transactionLayer };
