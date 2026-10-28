import { Fiber, Schema } from "effect";
import { v7 as uuid } from "uuid";

type HttpErrorOptions = ErrorOptions & {
	readonly retryable?: boolean;
	readonly retryAfterSeconds?: number;
};

type ProblemDetail = {
	readonly type: string;
	readonly status: number;
	readonly title: string;
	readonly detail: string;
	readonly instance: string;
	readonly traceId: string;
	readonly retryable?: boolean | undefined;
};

/** The current span's trace id; a fresh uuid when running outside any span. */
const currentTraceId = (): string => Fiber.getCurrent()?.currentSpan?.traceId ?? uuid();

/**
 * Shared base of every problem. `detail` and `retryable` are the only encoded fields;
 * `retryAfterSeconds` and `cause` live on the instance and are never encoded.
 *
 * Each concrete base extends this with its own class identifier so its schema only
 * matches its own instances (see the `*ApiError` schemas below).
 */
abstract class HttpError extends Schema.Error<HttpError>("HttpError")({
	detail: Schema.String,
	retryable: Schema.optional(Schema.Boolean),
}) {
	abstract readonly type: string;
	abstract readonly statusCode: number;
	abstract readonly title: string;
	declare readonly retryAfterSeconds?: number;

	toProblemDetail(): ProblemDetail {
		return {
			type: this.type,
			status: this.statusCode,
			title: this.title,
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: currentTraceId(),
			retryable: this.retryable,
		};
	}
}

/** Applies the `(message, options)` constructor members that sit outside the encoded shape. */
const initHttpError = (error: HttpError, message: string, options: HttpErrorOptions): void => {
	Object.defineProperties(error, {
		name: { value: error.constructor.name, configurable: true, writable: true },
		message: { value: message, configurable: true, writable: true },
		retryAfterSeconds: { value: options.retryAfterSeconds, enumerable: true },
	});
	if ("cause" in options) {
		Object.defineProperty(error, "cause", {
			value: options.cause,
			configurable: true,
			writable: true,
		});
	}
};

class BadRequestError extends HttpError.extend<BadRequestError>("BadRequestError")({}) {
	readonly type = "BAD_REQUEST";
	readonly statusCode = 400;
	readonly title = "Bad Request";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}

class UnauthorizedError extends HttpError.extend<UnauthorizedError>("UnauthorizedError")({}) {
	readonly type = "UNAUTHORIZED";
	readonly statusCode = 401;
	readonly title = "Unauthorized";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}

class ForbiddenError extends HttpError.extend<ForbiddenError>("ForbiddenError")({}) {
	readonly type = "FORBIDDEN";
	readonly statusCode = 403;
	readonly title = "Forbidden";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}

class NotFoundError extends HttpError.extend<NotFoundError>("NotFoundError")({}) {
	readonly type = "NOT_FOUND";
	readonly statusCode = 404;
	readonly title = "Not Found";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}

class ConflictError extends HttpError.extend<ConflictError>("ConflictError")({}) {
	readonly type = "CONFLICT";
	readonly statusCode = 409;
	readonly title = "Conflict";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}

class TooManyRequestsError extends HttpError.extend<TooManyRequestsError>("TooManyRequestsError")(
	{}
) {
	readonly type = "TOO_MANY_REQUESTS";
	readonly statusCode = 429;
	readonly title = "Too Many Requests";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}

class InternalServerError extends HttpError.extend<InternalServerError>("InternalServerError")({}) {
	readonly type = "INTERNAL_SERVER_ERROR";
	readonly statusCode = 500;
	readonly title = "Internal Server Error";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}

class ServiceUnavailableError extends HttpError.extend<ServiceUnavailableError>(
	"ServiceUnavailableError"
)({}) {
	readonly type = "SERVICE_UNAVAILABLE";
	readonly statusCode = 503;
	readonly title = "Service Unavailable";

	constructor(message: string, options: HttpErrorOptions = {}) {
		const merged = { retryable: true, ...options };
		super({ detail: message, retryable: merged.retryable });
		initHttpError(this, message, merged);
	}
}

class InvalidId extends BadRequestError {
	constructor(
		public readonly prefix: string,
		public readonly value: string,
		options?: ErrorOptions
	) {
		super(`Invalid ${prefix} id: ${value}`, options);
	}
}

/** The only place the `retry-after` header rule lives: present exactly when `retryAfterSeconds` is set. */
const retryAfterHeaders = (error: HttpError): { readonly "retry-after"?: number } =>
	error.retryAfterSeconds === undefined ? {} : { "retry-after": error.retryAfterSeconds };

export type { HttpErrorOptions };
export {
	retryAfterHeaders,
	BadRequestError,
	ConflictError,
	ForbiddenError,
	HttpError,
	InternalServerError,
	InvalidId,
	NotFoundError,
	ServiceUnavailableError,
	TooManyRequestsError,
	UnauthorizedError,
};
