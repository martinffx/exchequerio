import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";
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
			traceId: uuid(),
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

/**
 * Effect schemas for the HttpApi path: each encodes its error class to today's problem
 * body plus an optional `retry-after` header. `instance` and `traceId` are minted at
 * encode time, as `toProblemDetail` does. The body has no `_tag`.
 */
const problemBody = <TypeName extends string, Status extends number>(
	type: TypeName,
	status: Status
) =>
	Schema.Struct({
		type: Schema.Literal(type),
		status: Schema.Literal(status),
		title: Schema.String,
		detail: Schema.String,
		instance: Schema.String,
		traceId: Schema.String,
		retryable: Schema.optionalKey(Schema.Boolean),
	}).pipe(HttpApiSchema.status(status));

const encodeProblem = <
	Self extends Schema.Top & { readonly Type: HttpError },
	TypeName extends Self["Type"]["type"],
	Status extends Self["Type"]["statusCode"],
>(
	schema: Self,
	type: TypeName,
	status: Status,
	create: (message: string, options: HttpErrorOptions) => Self["Type"]
) =>
	schema.pipe(
		HttpApiSchema.encodeToWithHeaders(
			{
				body: problemBody(type, status),
				headers: { "retry-after": Schema.optionalKey(Schema.Int) },
			},
			{
				decode: ({ body, headers }) =>
					create(body.detail, {
						retryable: body.retryable,
						retryAfterSeconds: headers["retry-after"],
					}),
				encode: error => {
					const { retryable, ...problem } = error.toProblemDetail();
					return {
						// `type` and `status` are the literals the schema declares; the class states the same values.
						body: {
							...problem,
							type,
							status,
							...(retryable === undefined ? {} : { retryable }),
						},
						headers: retryAfterHeaders(error),
					};
				},
			}
		)
	);

const BadRequestApiError = encodeProblem(
	BadRequestError,
	"BAD_REQUEST",
	400,
	(m, o) => new BadRequestError(m, o)
);
const UnauthorizedApiError = encodeProblem(
	UnauthorizedError,
	"UNAUTHORIZED",
	401,
	(m, o) => new UnauthorizedError(m, o)
);
const ForbiddenApiError = encodeProblem(
	ForbiddenError,
	"FORBIDDEN",
	403,
	(m, o) => new ForbiddenError(m, o)
);
const NotFoundApiError = encodeProblem(
	NotFoundError,
	"NOT_FOUND",
	404,
	(m, o) => new NotFoundError(m, o)
);
const ConflictApiError = encodeProblem(
	ConflictError,
	"CONFLICT",
	409,
	(m, o) => new ConflictError(m, o)
);
const TooManyRequestsApiError = encodeProblem(
	TooManyRequestsError,
	"TOO_MANY_REQUESTS",
	429,
	(m, o) => new TooManyRequestsError(m, o)
);
const InternalServerApiError = encodeProblem(
	InternalServerError,
	"INTERNAL_SERVER_ERROR",
	500,
	(m, o) => new InternalServerError(m, o)
);
const ServiceUnavailableApiError = encodeProblem(
	ServiceUnavailableError,
	"SERVICE_UNAVAILABLE",
	503,
	(m, o) => new ServiceUnavailableError(m, o)
);

export type { HttpErrorOptions };
export {
	retryAfterHeaders,
	BadRequestApiError,
	ConflictApiError,
	ForbiddenApiError,
	InternalServerApiError,
	NotFoundApiError,
	ServiceUnavailableApiError,
	TooManyRequestsApiError,
	UnauthorizedApiError,
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
