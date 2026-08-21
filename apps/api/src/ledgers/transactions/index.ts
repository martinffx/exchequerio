import { Layer } from "effect";

import { transactionRepoLayer } from "./TransactionRepo";
import { transactionServiceLayer } from "./TransactionService";

const transactionLayer = transactionServiceLayer.pipe(Layer.provide(transactionRepoLayer));

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
