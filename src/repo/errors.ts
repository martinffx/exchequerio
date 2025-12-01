import {
  ConflictError,
  type ErrorContext,
  InternalServerError,
  NotFoundError,
  ServiceUnavailableError,
} from "@/errors";

/**
 * Database error with code property (PostgreSQL/DSQL)
 */
interface DBError extends Error {
  code?: string;
  cause?: { code?: string };
}

/**
 * Type guard to check if error is a database error with a code
 */
function isDBError(error: unknown): error is DBError {
  if (!error || typeof error !== "object") return false;

  // Direct code property
  if (
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return true;
  }

  // Drizzle wraps errors in cause
  if ("cause" in error) {
    const cause = (error as { cause: unknown }).cause;
    if (cause && typeof cause === "object" && "code" in cause) {
      return typeof (cause as { code: unknown }).code === "string";
    }
  }

  return false;
}

/**
 * Extracts the error code from a DBError (handles Drizzle's cause wrapping)
 */
function getDBErrorCode(error: DBError): string {
  if (error.code) return error.code;

  // Check cause for wrapped errors
  if (error.cause?.code) return error.cause.code;

  return "";
}

/**
 * Converts database error codes to domain errors.
 *
 * PostgreSQL/DSQL Error Code Reference:
 * | Code   | Name                    | Error Type              |
 * |--------|-------------------------|-------------------------|
 * | 23505  | unique_violation        | ConflictError           |
 * | 23503  | foreign_key_violation   | NotFoundError (PG only) |
 * | 40001  | serialization_failure   | ServiceUnavailableError |
 * | 40P01  | deadlock_detected       | ServiceUnavailableError |
 * | OC000  | occ_conflict (DSQL)     | ServiceUnavailableError |
 * | OC001  | catalog_stale (DSQL)    | ServiceUnavailableError |
 *
 * @param error - Database error with code
 * @param context - Optional context with resource IDs for debugging
 * @returns LedgerError based on error code
 */
function handleDBError(error: DBError, context: ErrorContext = {}): Error {
  const code = getDBErrorCode(error);

  switch (code) {
    // Unique constraint violation
    case "23505":
      return new ConflictError("Resource already exists", false, context);

    // Foreign key violation (PG only - DSQL doesn't support FKs)
    case "23503":
      return new NotFoundError("Referenced resource not found", context);

    // Serialization failure (PG + DSQL)
    case "40001":
    case "OC000":
      return new ServiceUnavailableError(
        "Transaction conflict - please retry",
        true,
        context,
      );

    // Deadlock (PG only)
    case "40P01":
      return new ServiceUnavailableError(
        "Transaction deadlock - please retry",
        true,
        context,
      );

    // Catalog cache stale (DSQL)
    case "OC001":
      return new ServiceUnavailableError(
        "Schema conflict - please retry",
        true,
        context,
      );

    default:
      return new InternalServerError(
        error.message || "Database error",
        context,
      );
  }
}

export { handleDBError, isDBError, type DBError };
