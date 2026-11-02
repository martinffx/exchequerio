import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { isPostgresUnavailable } from "@/db";
import { InternalServerError, ServiceUnavailableError } from "@/lib/errors";

class StatementPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: Error) {
		super("Persisted Statement could not be decoded", { cause });
	}
}

class StatementPersistenceFailure extends InternalServerError {
	constructor(cause: Error) {
		super("Statement database operation failed", { cause });
	}
}

class StatementRepositoryUnavailable extends ServiceUnavailableError {
	constructor(cause: Error) {
		super("Statement database unavailable", { cause });
	}
}

type StatementInfrastructureError =
	| StatementPersistenceDecodingFailure
	| StatementPersistenceFailure
	| StatementRepositoryUnavailable;

const mapStatementInfrastructureError = (
	cause: EffectDrizzleQueryError | SqlError
): StatementPersistenceFailure | StatementRepositoryUnavailable =>
	isPostgresUnavailable(cause)
		? new StatementRepositoryUnavailable(cause)
		: new StatementPersistenceFailure(cause);

const isStatementInfrastructureError = <E>(
	error: E
): error is Extract<E, StatementInfrastructureError> =>
	error instanceof StatementPersistenceDecodingFailure ||
	error instanceof StatementPersistenceFailure ||
	error instanceof StatementRepositoryUnavailable;

export {
	isStatementInfrastructureError,
	mapStatementInfrastructureError,
	StatementPersistenceDecodingFailure,
	StatementPersistenceFailure,
	StatementRepositoryUnavailable,
};
export type { StatementInfrastructureError };
