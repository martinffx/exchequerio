import { ConflictError, InternalServerError } from "@/lib/errors";

/** A requested Settlement lifecycle transition is not permitted. */
class LedgerAccountSettlementLifecycleConflict extends ConflictError {
	/**
	 * Describes the rejected transition.
	 *
	 * @param from - Current status.
	 * @param to - Requested status.
	 */
	constructor(from: string, to: string) {
		super(`Invalid Settlement status transition from '${from}' to '${to}'`, { retryable: false });
	}
}

/** Persisted Settlement data cannot be converted into its domain representation. */
class LedgerAccountSettlementPersistenceDecodingFailure extends InternalServerError {
	/**
	 * Preserves the decoding cause as an internal failure.
	 *
	 * @param cause - Failure encountered while decoding the row.
	 */
	constructor(cause: unknown) {
		super("Persisted Settlement could not be decoded", { cause });
	}
}

export {
	LedgerAccountSettlementLifecycleConflict,
	LedgerAccountSettlementPersistenceDecodingFailure,
};
