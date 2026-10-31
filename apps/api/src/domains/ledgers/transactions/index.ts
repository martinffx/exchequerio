import { Layer } from "effect";

import { ledgerTransactionRepoLayer } from "./LedgerTransactionRepo";
import { transactionServiceLayer } from "./LedgerTransactionService";

const transactionLayer = transactionServiceLayer.pipe(Layer.provide(ledgerTransactionRepoLayer));

export type {
	TransactionCreateError,
	TransactionGetError,
	TransactionListError,
	TransactionService,
	TransactionTransitionError,
	TransactionUpdateError,
} from "./LedgerTransactionService";
export { TransactionServiceTag } from "./LedgerTransactionService";
export { transactionLayer };
