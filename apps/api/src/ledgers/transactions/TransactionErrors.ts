import {
	BadRequestError,
	ConflictError,
	type ErrorContext,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";

class TransactionValidationFailure extends BadRequestError {
	constructor(message: string, options: ErrorOptions = {}) {
		super(message, options);
	}
}

class TransactionNotFound extends NotFoundError {
	constructor(organizationId: string, ledgerId: string, transactionId: string) {
		super(`Transaction not found: ${transactionId}`, {
			organizationId,
			ledgerId,
			transactionId,
		});
	}
}

class TransactionLifecycleConflict extends ConflictError {
	constructor(transactionId: string, from: string, to: string, context: ErrorContext = {}) {
		super(`Transaction ${transactionId} cannot transition from ${from} to ${to}`, {
			...context,
			transactionId,
			retryable: false,
		});
	}
}

class TransactionConcurrencyFailure extends ConflictError {
	constructor(cause: unknown, context: ErrorContext = {}) {
		super("Transaction was modified by another operation", {
			...context,
			cause,
			retryable: true,
		});
	}
}

class TransactionVersionConflict extends ConflictError {
	constructor(organizationId: string, ledgerId: string, transactionId: string) {
		super(`Transaction was modified by another operation: ${transactionId}`, {
			organizationId,
			ledgerId,
			transactionId,
			retryable: true,
		});
	}
}

class TransactionRepositoryUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown, context: ErrorContext = {}) {
		super("Transaction repository unavailable", { ...context, cause });
	}
}

class TransactionIdempotencyUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown, context: ErrorContext = {}) {
		super("Transaction idempotency store unavailable", { ...context, cause });
	}
}

class TransactionPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown, context: ErrorContext = {}) {
		super("Persisted Transaction could not be decoded", { ...context, cause });
	}
}

class TransactionPersistenceFailure extends InternalServerError {
	constructor(cause: unknown, context: ErrorContext = {}) {
		super("Transaction persistence operation failed", { ...context, cause });
	}
}

type TransactionInfrastructureError =
	| TransactionIdempotencyUnavailable
	| TransactionPersistenceDecodingFailure
	| TransactionPersistenceFailure
	| TransactionRepositoryUnavailable;

export type { TransactionInfrastructureError };
export {
	TransactionConcurrencyFailure,
	TransactionIdempotencyUnavailable,
	TransactionLifecycleConflict,
	TransactionNotFound,
	TransactionPersistenceDecodingFailure,
	TransactionPersistenceFailure,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
	TransactionVersionConflict,
};
