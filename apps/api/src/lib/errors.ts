import { type Static, Type } from "@sinclair/typebox";
import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuid } from "uuid";

type HttpErrorOptions = ErrorOptions & {
	readonly retryable?: boolean;
	readonly retryAfterSeconds?: number;
};

const ProblemDetailSchema = Type.Object({
	type: Type.String(),
	status: Type.Integer(),
	title: Type.String(),
	detail: Type.String(),
	instance: Type.String(),
	traceId: Type.String(),
	retryable: Type.Optional(Type.Boolean()),
});
type ProblemDetail = Static<typeof ProblemDetailSchema>;

const problemDetailSchema = <TypeName extends string, Status extends number>(
	type: TypeName,
	status: Status
) =>
	Type.Object({
		type: Type.Literal(type),
		status: Type.Literal(status),
		title: Type.String(),
		detail: Type.String(),
		instance: Type.String(),
		traceId: Type.String(),
		retryable: Type.Optional(Type.Boolean()),
	});

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
const BadRequestProblem = problemDetailSchema("BAD_REQUEST", 400);
type BadRequestProblem = Static<typeof BadRequestProblem>;

class UnauthorizedError extends HttpError.extend<UnauthorizedError>("UnauthorizedError")({}) {
	readonly type = "UNAUTHORIZED";
	readonly statusCode = 401;
	readonly title = "Unauthorized";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}
const UnauthorizedProblem = problemDetailSchema("UNAUTHORIZED", 401);
type UnauthorizedProblem = Static<typeof UnauthorizedProblem>;

class ForbiddenError extends HttpError.extend<ForbiddenError>("ForbiddenError")({}) {
	readonly type = "FORBIDDEN";
	readonly statusCode = 403;
	readonly title = "Forbidden";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}
const ForbiddenProblem = problemDetailSchema("FORBIDDEN", 403);
type ForbiddenProblem = Static<typeof ForbiddenProblem>;

class NotFoundError extends HttpError.extend<NotFoundError>("NotFoundError")({}) {
	readonly type = "NOT_FOUND";
	readonly statusCode = 404;
	readonly title = "Not Found";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}
const NotFoundProblem = problemDetailSchema("NOT_FOUND", 404);
type NotFoundProblem = Static<typeof NotFoundProblem>;

class ConflictError extends HttpError.extend<ConflictError>("ConflictError")({}) {
	readonly type = "CONFLICT";
	readonly statusCode = 409;
	readonly title = "Conflict";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}
const ConflictProblem = problemDetailSchema("CONFLICT", 409);
type ConflictProblem = Static<typeof ConflictProblem>;

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
const TooManyRequestsProblem = problemDetailSchema("TOO_MANY_REQUESTS", 429);
type TooManyRequestsProblem = Static<typeof TooManyRequestsProblem>;

class InternalServerError extends HttpError.extend<InternalServerError>("InternalServerError")({}) {
	readonly type = "INTERNAL_SERVER_ERROR";
	readonly statusCode = 500;
	readonly title = "Internal Server Error";
	constructor(message: string, options: HttpErrorOptions = {}) {
		super({ detail: message, retryable: options.retryable });
		initHttpError(this, message, options);
	}
}
const InternalServerProblem = problemDetailSchema("INTERNAL_SERVER_ERROR", 500);
type InternalServerProblem = Static<typeof InternalServerProblem>;

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
const ServiceUnavailableProblem = problemDetailSchema("SERVICE_UNAVAILABLE", 503);
type ServiceUnavailableProblem = Static<typeof ServiceUnavailableProblem>;

class InvalidId extends BadRequestError {
	constructor(
		public readonly prefix: string,
		public readonly value: string,
		options?: ErrorOptions
	) {
		super(`Invalid ${prefix} id: ${value}`, options);
	}
}

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
	TypeName extends string,
	Status extends number,
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
				encode: error => ({
					body: {
						type,
						status,
						title: error.title,
						detail: error.message,
						instance: `/instance/${uuid()}`,
						traceId: uuid(),
						...(error.retryable === undefined ? {} : { retryable: error.retryable }),
					},
					headers:
						error.retryAfterSeconds === undefined ? {} : { "retry-after": error.retryAfterSeconds },
				}),
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

const sendHttpError = (error: HttpError, request: FastifyRequest, reply: FastifyReply): void => {
	if (error.statusCode >= 500) {
		request.server.log.error(error.cause ?? error, error.message);
	}
	if (error.retryAfterSeconds !== undefined) {
		reply.header("Retry-After", error.retryAfterSeconds.toString());
	}
	reply.status(error.statusCode).send(error.toProblemDetail());
};

const globalErrorHandler = (
	error: FastifyError,
	request: FastifyRequest,
	reply: FastifyReply
): void => {
	if (error.code === "FST_ERR_VALIDATION") {
		sendHttpError(new BadRequestError(error.message), request, reply);
		return;
	}
	if (error.code === "FST_UNDER_PRESSURE") {
		sendHttpError(new ServiceUnavailableError(error.message, { cause: error }), request, reply);
		return;
	}
	if (error instanceof HttpError) {
		sendHttpError(error, request, reply);
		return;
	}
	sendHttpError(new InternalServerError("Internal Server Error", { cause: error }), request, reply);
};

const BadRequestErrorResponse = BadRequestProblem;
type BadRequestErrorResponse = BadRequestProblem;
const UnauthorizedErrorResponse = UnauthorizedProblem;
type UnauthorizedErrorResponse = UnauthorizedProblem;
const ForbiddenErrorResponse = ForbiddenProblem;
type ForbiddenErrorResponse = ForbiddenProblem;
const NotFoundErrorResponse = NotFoundProblem;
type NotFoundErrorResponse = NotFoundProblem;
const ConflictErrorResponse = ConflictProblem;
type ConflictErrorResponse = ConflictProblem;
const TooManyRequestsErrorResponse = TooManyRequestsProblem;
type TooManyRequestsErrorResponse = TooManyRequestsProblem;
const InternalServerErrorResponse = InternalServerProblem;
type InternalServerErrorResponse = InternalServerProblem;
const ServiceUnavailableErrorResponse = ServiceUnavailableProblem;
type ServiceUnavailableErrorResponse = ServiceUnavailableProblem;

export type { HttpErrorOptions, ProblemDetail };
export {
	BadRequestApiError,
	ConflictApiError,
	ForbiddenApiError,
	InternalServerApiError,
	NotFoundApiError,
	ServiceUnavailableApiError,
	TooManyRequestsApiError,
	UnauthorizedApiError,
	BadRequestError,
	BadRequestErrorResponse,
	BadRequestProblem,
	ConflictError,
	ConflictErrorResponse,
	ConflictProblem,
	ForbiddenError,
	ForbiddenErrorResponse,
	ForbiddenProblem,
	globalErrorHandler,
	HttpError,
	InternalServerError,
	InternalServerErrorResponse,
	InternalServerProblem,
	InvalidId,
	NotFoundError,
	NotFoundErrorResponse,
	NotFoundProblem,
	ProblemDetailSchema,
	ServiceUnavailableError,
	ServiceUnavailableErrorResponse,
	ServiceUnavailableProblem,
	TooManyRequestsError,
	TooManyRequestsErrorResponse,
	TooManyRequestsProblem,
	UnauthorizedError,
	UnauthorizedErrorResponse,
	UnauthorizedProblem,
};
