const unavailableCodes = new Set([
	"57P01",
	"57P02",
	"57P03",
	"53300",
	"ECONNREFUSED",
	"ECONNRESET",
	"ENETDOWN",
	"ENETUNREACH",
	"EHOSTDOWN",
	"EHOSTUNREACH",
	"ETIMEDOUT",
	"ENOTFOUND",
	"EAI_AGAIN",
	"EPIPE",
]);

const unavailableMessages = [
	"connection terminated unexpectedly",
	"client has encountered a connection error and is not queryable",
	"timeout exceeded when trying to connect",
];

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
	typeof value === "object" && value !== null;

const nestedErrors = (error: Record<PropertyKey, unknown>): readonly unknown[] =>
	Array.isArray(error.errors) ? error.errors : [];

const isPostgresUnavailable = (cause: unknown, seen = new Set<object>()): boolean => {
	if (!isRecord(cause) || seen.has(cause)) return false;
	seen.add(cause);

	if (
		typeof cause.code === "string" &&
		(cause.code.startsWith("08") || unavailableCodes.has(cause.code))
	) {
		return true;
	}
	const causeMessage = cause.message;
	if (
		typeof causeMessage === "string" &&
		unavailableMessages.some(message => causeMessage.toLowerCase().includes(message))
	) {
		return true;
	}
	if (isPostgresUnavailable(cause.cause, seen)) return true;
	return nestedErrors(cause).some(error => isPostgresUnavailable(error, seen));
};

const postgresErrorCode = (cause: unknown, seen = new Set<object>()): string | undefined => {
	if (!isRecord(cause) || seen.has(cause)) return undefined;
	seen.add(cause);

	if (typeof cause.code === "string") return cause.code;
	const causedBy = postgresErrorCode(cause.cause, seen);
	if (causedBy !== undefined) return causedBy;
	for (const error of nestedErrors(cause)) {
		const code = postgresErrorCode(error, seen);
		if (code !== undefined) return code;
	}
	return undefined;
};

const postgresConstraint = (cause: unknown, seen = new Set<object>()): string | undefined => {
	if (!isRecord(cause) || seen.has(cause)) return undefined;
	seen.add(cause);
	if (typeof cause.constraint === "string") return cause.constraint;
	const nested = postgresConstraint(cause.cause, seen);
	if (nested !== undefined) return nested;
	if (!Array.isArray(cause.errors)) return undefined;
	for (const error of cause.errors) {
		const constraint = postgresConstraint(error, seen);
		if (constraint !== undefined) return constraint;
	}
	return undefined;
};

export { isPostgresUnavailable, postgresErrorCode, postgresConstraint };
