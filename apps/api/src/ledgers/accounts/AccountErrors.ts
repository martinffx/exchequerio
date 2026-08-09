import {
	ConflictError,
	type ErrorContext,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";

class AccountNotFound extends NotFoundError {
	constructor(organizationId: string, ledgerId: string, accountId: string) {
		super(`Account not found: ${accountId}`, { organizationId, ledgerId, accountId });
	}
}

class AccountNameConflict extends ConflictError {
	constructor(organizationId: string, ledgerId: string, name: string) {
		super(`Account name already exists in Ledger: ${name}`, {
			organizationId,
			ledgerId,
			retryable: false,
		});
	}
}

class AccountVersionConflict extends ConflictError {
	constructor(organizationId: string, ledgerId: string, accountId: string) {
		super(`Account was modified by another operation: ${accountId}`, {
			organizationId,
			ledgerId,
			accountId,
			retryable: true,
		});
	}
}

class AccountHasDependents extends ConflictError {
	constructor(organizationId: string, ledgerId: string, accountId: string) {
		super(`Account has dependents: ${accountId}`, { organizationId, ledgerId, accountId });
	}
}

class AccountRepositoryUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown, context: ErrorContext = {}) {
		super("Account repository unavailable", { ...context, cause });
	}
}

class AccountPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Persisted Account could not be decoded", { cause });
	}
}

class AccountPersistenceFailure extends InternalServerError {
	constructor(cause: unknown, context: ErrorContext = {}) {
		super("Account persistence operation failed", { ...context, cause });
	}
}

type AccountInfrastructureError =
	| AccountPersistenceDecodingFailure
	| AccountPersistenceFailure
	| AccountRepositoryUnavailable;

export type { AccountInfrastructureError };
export {
	AccountHasDependents,
	AccountNameConflict,
	AccountNotFound,
	AccountPersistenceDecodingFailure,
	AccountPersistenceFailure,
	AccountRepositoryUnavailable,
	AccountVersionConflict,
};
