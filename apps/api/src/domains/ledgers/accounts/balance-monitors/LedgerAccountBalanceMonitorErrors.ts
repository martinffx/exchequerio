import { InternalServerError, NotFoundError } from "@/lib/errors";

class LedgerAccountBalanceMonitorNotFound extends NotFoundError {
	constructor() {
		super("Balance monitor not found");
	}
}

class LedgerAccountBalanceMonitorPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Internal Server Error", { cause });
	}
}

class LedgerAccountBalanceMonitorPersistenceFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Internal Server Error", { cause });
	}
}

type LedgerAccountBalanceMonitorInfrastructureError =
	| LedgerAccountBalanceMonitorPersistenceDecodingFailure
	| LedgerAccountBalanceMonitorPersistenceFailure;

export type { LedgerAccountBalanceMonitorInfrastructureError };
export {
	LedgerAccountBalanceMonitorNotFound,
	LedgerAccountBalanceMonitorPersistenceDecodingFailure,
	LedgerAccountBalanceMonitorPersistenceFailure,
};
