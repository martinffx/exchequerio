import { Effect, Option } from "effect";

import { isPostgresUnavailable, postgresErrorCode } from "@/db";
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";
import { OrganizationNotFound } from "@/organizations";

class LedgerNotFound extends NotFoundError {
	constructor() {
		super("Ledger not found");
	}
}

class LedgerHasDependents extends ConflictError {
	constructor() {
		super("Ledger has dependents");
	}
}

class LedgerRepositoryUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown) {
		super("Ledger repository unavailable", { cause });
	}
}

class LedgerPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Persisted Ledger could not be decoded", { cause });
	}
}

class LedgerPersistenceFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Ledger persistence operation failed", { cause });
	}
}

type LedgerInfrastructureError =
	| LedgerPersistenceDecodingFailure
	| LedgerPersistenceFailure
	| LedgerRepositoryUnavailable;

const mapLedgerInfrastructureError = (cause: unknown): LedgerInfrastructureError => {
	if (
		cause instanceof LedgerPersistenceDecodingFailure ||
		cause instanceof LedgerPersistenceFailure ||
		cause instanceof LedgerRepositoryUnavailable
	) {
		return cause;
	}
	return isPostgresUnavailable(cause)
		? new LedgerRepositoryUnavailable(cause)
		: new LedgerPersistenceFailure(cause);
};

const mapLedgerCreateError = (cause: unknown) => {
	const code = postgresErrorCode(cause);
	if (code === "23503") return new OrganizationNotFound();
	if (code === "23505") return new LedgerPersistenceFailure(cause);
	return mapLedgerInfrastructureError(cause);
};

const mapLedgerDeleteError = (cause: unknown) =>
	postgresErrorCode(cause) === "23503"
		? new LedgerHasDependents()
		: mapLedgerInfrastructureError(cause);

const requireCreatedLedger = <A>(value: Option.Option<A>) =>
	Option.match(value, {
		onNone: () =>
			Effect.fail(new LedgerPersistenceFailure(new Error("Database write returned no row"))),
		onSome: Effect.succeed,
	});

export type { LedgerInfrastructureError };
export {
	LedgerHasDependents,
	LedgerNotFound,
	LedgerPersistenceDecodingFailure,
	LedgerPersistenceFailure,
	LedgerRepositoryUnavailable,
	mapLedgerCreateError,
	mapLedgerDeleteError,
	mapLedgerInfrastructureError,
	requireCreatedLedger,
};
