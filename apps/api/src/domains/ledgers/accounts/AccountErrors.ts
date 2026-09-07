import { Effect, Option } from "effect";

import { isPostgresUnavailable, postgresErrorCode } from "@/db";
import { postgresConstraint } from "@/db/errors";
import { LedgerNotFound } from "@/domains/ledgers/LedgerErrors";
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";

class AccountNotFound extends NotFoundError {
	constructor(options?: ErrorOptions) {
		super("Account not found", options);
	}
}

class AccountNameConflict extends ConflictError {
	constructor(name: string) {
		super(`Account name already exists in Ledger: ${name}`, { retryable: false });
	}
}

class AccountVersionConflict extends ConflictError {
	constructor() {
		super("Account was modified by another operation", { retryable: true });
	}
}

class AccountHasDependents extends ConflictError {
	constructor() {
		super("Account has dependents");
	}
}

class AccountRepositoryUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown) {
		super("Account repository unavailable", { cause });
	}
}

class AccountPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Persisted Account could not be decoded", { cause });
	}
}

class AccountPersistenceFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Account persistence operation failed", { cause });
	}
}

type AccountInfrastructureError =
	| AccountPersistenceDecodingFailure
	| AccountPersistenceFailure
	| AccountRepositoryUnavailable;

const isAccountInfrastructureError = (cause: unknown): cause is AccountInfrastructureError =>
	cause instanceof AccountPersistenceDecodingFailure ||
	cause instanceof AccountPersistenceFailure ||
	cause instanceof AccountRepositoryUnavailable;

const mapAccountInfrastructureError = (cause: unknown): AccountInfrastructureError => {
	if (isAccountInfrastructureError(cause)) return cause;
	return isPostgresUnavailable(cause)
		? new AccountRepositoryUnavailable(cause)
		: new AccountPersistenceFailure(cause);
};

const mapAccountCreateError = (cause: unknown, name: string) => {
	if (isAccountInfrastructureError(cause)) return cause;
	if (postgresErrorCode(cause) === "23503") return new LedgerNotFound();
	if (
		postgresErrorCode(cause) === "23505" &&
		postgresConstraint(cause) === "unique_account_name_per_ledger"
	) {
		return new AccountNameConflict(name);
	}
	return mapAccountInfrastructureError(cause);
};

const mapAccountUpdateError = (cause: unknown, name: string) => {
	if (cause instanceof AccountVersionConflict) return cause;
	if (
		postgresErrorCode(cause) === "23505" &&
		postgresConstraint(cause) === "unique_account_name_per_ledger"
	) {
		return new AccountNameConflict(name);
	}
	return mapAccountInfrastructureError(cause);
};

const mapAccountDeleteError = (cause: unknown) =>
	postgresErrorCode(cause) === "23503"
		? new AccountHasDependents()
		: mapAccountInfrastructureError(cause);

const requireCreatedAccount = <A>(value: Option.Option<A>) =>
	Option.match(value, {
		onNone: () =>
			Effect.fail(new AccountPersistenceFailure(new Error("Database write returned no Account row"))),
		onSome: Effect.succeed,
	});

const requireUpdatedAccount = <A>(value: Option.Option<A>) =>
	Option.match(value, {
		onNone: () => Effect.fail(new AccountVersionConflict()),
		onSome: Effect.succeed,
	});

const requireAccount = <A>(value: A | undefined) =>
	value === undefined ? Effect.fail(new AccountNotFound()) : Effect.succeed(value);

const requireAccountWrite = (written: boolean) =>
	written ? Effect.void : Effect.fail(new AccountVersionConflict());

export type { AccountInfrastructureError };
export {
	AccountHasDependents,
	AccountNameConflict,
	AccountNotFound,
	AccountPersistenceDecodingFailure,
	AccountPersistenceFailure,
	AccountRepositoryUnavailable,
	AccountVersionConflict,
	mapAccountCreateError,
	mapAccountDeleteError,
	mapAccountInfrastructureError,
	mapAccountUpdateError,
	requireAccount,
	requireAccountWrite,
	requireCreatedAccount,
	requireUpdatedAccount,
};
