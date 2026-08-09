import {
	ConflictError,
	type ErrorContext,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";

class LedgerNotFound extends NotFoundError {
	constructor(organizationId: string, ledgerId: string) {
		super(`Ledger not found: ${ledgerId}`, { organizationId, ledgerId });
	}
}

class LedgerHasDependents extends ConflictError {
	constructor(organizationId: string, ledgerId: string) {
		super(`Ledger has dependents: ${ledgerId}`, { organizationId, ledgerId });
	}
}

class LedgerRepositoryUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown, context: ErrorContext = {}) {
		super("Ledger repository unavailable", { ...context, cause });
	}
}

class LedgerPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Persisted Ledger could not be decoded", { cause });
	}
}

class LedgerPersistenceFailure extends InternalServerError {
	constructor(cause: unknown, context: ErrorContext = {}) {
		super("Ledger persistence operation failed", { ...context, cause });
	}
}

type LedgerInfrastructureError =
	| LedgerPersistenceDecodingFailure
	| LedgerPersistenceFailure
	| LedgerRepositoryUnavailable;

export type { LedgerInfrastructureError };
export {
	LedgerHasDependents,
	LedgerNotFound,
	LedgerPersistenceDecodingFailure,
	LedgerPersistenceFailure,
	LedgerRepositoryUnavailable,
};
