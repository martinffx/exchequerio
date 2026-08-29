import { Effect, Option } from "effect";

import { isPostgresUnavailable, postgresErrorCode } from "@/db";
import {
	AccountNotFound,
	AccountPersistenceDecodingFailure,
	AccountVersionConflict,
	LedgerAccountCurrencyMismatch,
} from "@/ledgers/accounts";
import {
	BadRequestError,
	ConflictError,
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
	constructor() {
		super("Transaction not found");
	}
}

class TransactionLifecycleConflict extends ConflictError {
	constructor(from: string, to: string) {
		super(`Transaction cannot transition from ${from} to ${to}`, { retryable: false });
	}
}

class TransactionConcurrencyFailure extends ConflictError {
	constructor(cause: unknown) {
		super("Transaction was modified by another operation", { cause, retryable: true });
	}
}

class TransactionVersionConflict extends ConflictError {
	constructor() {
		super("Transaction was modified by another operation", { retryable: true });
	}
}

class TransactionRepositoryUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown) {
		super("Transaction repository unavailable", { cause });
	}
}

class TransactionIdempotencyUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown) {
		super("Transaction idempotency store unavailable", { cause });
	}
}

class TransactionCreationPending extends ServiceUnavailableError {
	constructor() {
		super("Transaction creation is still in progress");
	}
}

class TransactionPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Persisted Transaction could not be decoded", { cause });
	}
}

class TransactionPersistenceFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Transaction persistence operation failed", { cause });
	}
}

type TransactionInfrastructureError =
	| TransactionIdempotencyUnavailable
	| TransactionPersistenceDecodingFailure
	| TransactionPersistenceFailure
	| TransactionRepositoryUnavailable;

const mapTransactionInfrastructureError = (cause: unknown): TransactionInfrastructureError => {
	if (cause instanceof TransactionPersistenceDecodingFailure) return cause;
	if (cause instanceof AccountPersistenceDecodingFailure) {
		return new TransactionPersistenceDecodingFailure(cause);
	}
	if (
		cause instanceof TransactionPersistenceFailure ||
		cause instanceof TransactionRepositoryUnavailable
	) {
		return cause;
	}
	return isPostgresUnavailable(cause)
		? new TransactionRepositoryUnavailable(cause)
		: new TransactionPersistenceFailure(cause);
};

const mapTransactionConcurrentError = (cause: unknown) => {
	const code = postgresErrorCode(cause);
	return code === "40001" || code === "40P01"
		? new TransactionConcurrencyFailure(cause)
		: mapTransactionInfrastructureError(cause);
};

const mapTransactionCreateError = (cause: unknown) =>
	cause instanceof AccountNotFound ||
	cause instanceof AccountVersionConflict ||
	cause instanceof LedgerAccountCurrencyMismatch ||
	cause instanceof TransactionValidationFailure
		? cause
		: mapTransactionConcurrentError(cause);

const mapTransactionMutationError = (cause: unknown) =>
	cause instanceof AccountNotFound ||
	cause instanceof AccountVersionConflict ||
	cause instanceof LedgerAccountCurrencyMismatch ||
	cause instanceof TransactionLifecycleConflict ||
	cause instanceof TransactionNotFound ||
	cause instanceof TransactionPersistenceDecodingFailure ||
	cause instanceof TransactionPersistenceFailure ||
	cause instanceof TransactionRepositoryUnavailable ||
	cause instanceof TransactionValidationFailure ||
	cause instanceof TransactionVersionConflict
		? cause
		: mapTransactionConcurrentError(cause);

const requireTransaction = <A>(value: Option.Option<A>) =>
	Option.match(value, {
		onNone: () => Effect.fail(new TransactionNotFound()),
		onSome: Effect.succeed,
	});

const requireTransactionWrite = (written: boolean) =>
	written ? Effect.void : Effect.fail(new TransactionVersionConflict());

export type { TransactionInfrastructureError };
export {
	TransactionConcurrencyFailure,
	TransactionCreationPending,
	TransactionIdempotencyUnavailable,
	TransactionLifecycleConflict,
	TransactionNotFound,
	TransactionPersistenceDecodingFailure,
	TransactionPersistenceFailure,
	TransactionRepositoryUnavailable,
	TransactionValidationFailure,
	TransactionVersionConflict,
	mapTransactionCreateError,
	mapTransactionInfrastructureError,
	mapTransactionMutationError,
	requireTransaction,
	requireTransactionWrite,
};
