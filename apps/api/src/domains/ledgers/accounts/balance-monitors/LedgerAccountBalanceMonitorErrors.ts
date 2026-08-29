import { InternalServerError, NotFoundError } from "@/lib/errors";
import type { LedgerAccountBalanceMonitorID } from "@/repo/entities/types";

class LedgerAccountBalanceMonitorNotFound extends NotFoundError {
	constructor(id: LedgerAccountBalanceMonitorID) {
		super(`Balance monitor not found: ${id.toString()}`);
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
