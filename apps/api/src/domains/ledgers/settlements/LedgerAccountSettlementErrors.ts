import { ConflictError, InternalServerError } from "@/lib/errors";

class LedgerAccountSettlementLifecycleConflict extends ConflictError {
	constructor(from: string, to: string) {
		super(`Invalid Settlement status transition from '${from}' to '${to}'`, { retryable: false });
	}
}

class LedgerAccountSettlementPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Persisted Settlement could not be decoded", { cause });
	}
}

export {
	LedgerAccountSettlementLifecycleConflict,
	LedgerAccountSettlementPersistenceDecodingFailure,
};
