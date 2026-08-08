import { type Static, Type } from "@sinclair/typebox";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuid } from "uuid";

type ErrorContext = {
	readonly organizationId?: string;
	readonly ledgerId?: string;
	readonly accountId?: string;
	readonly transactionId?: string;
	readonly idempotencyKey?: string;
};

type HttpErrorOptions = ErrorOptions &
	ErrorContext & {
		readonly retryable?: boolean;
	};

const ProblemDetailSchema = Type.Object({
	type: Type.String(),
	status: Type.Integer(),
	title: Type.String(),
	detail: Type.String(),
	instance: Type.String(),
	traceId: Type.String(),
	organizationId: Type.Optional(Type.String()),
	ledgerId: Type.Optional(Type.String()),
	accountId: Type.Optional(Type.String()),
	transactionId: Type.Optional(Type.String()),
	idempotencyKey: Type.Optional(Type.String()),
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
		organizationId: Type.Optional(Type.String()),
		ledgerId: Type.Optional(Type.String()),
		accountId: Type.Optional(Type.String()),
		transactionId: Type.Optional(Type.String()),
		idempotencyKey: Type.Optional(Type.String()),
		retryable: Type.Optional(Type.Boolean()),
	});

abstract class HttpError extends Error {
	abstract readonly type: string;
	abstract readonly statusCode: number;
	abstract readonly title: string;
	readonly organizationId?: string;
	readonly ledgerId?: string;
	readonly accountId?: string;
	readonly transactionId?: string;
	readonly idempotencyKey?: string;
	readonly retryable?: boolean;
	readonly context: ErrorContext;

	constructor(message: string, options: HttpErrorOptions = {}) {
		super(message, options);
		this.name = this.constructor.name;
		this.organizationId = options.organizationId;
		this.ledgerId = options.ledgerId;
		this.accountId = options.accountId;
		this.transactionId = options.transactionId;
		this.idempotencyKey = options.idempotencyKey;
		this.retryable = options.retryable;
		this.context = {
			...(options.organizationId === undefined ? {} : { organizationId: options.organizationId }),
			...(options.ledgerId === undefined ? {} : { ledgerId: options.ledgerId }),
			...(options.accountId === undefined ? {} : { accountId: options.accountId }),
			...(options.transactionId === undefined ? {} : { transactionId: options.transactionId }),
			...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
		};
	}

	toProblemDetail(): ProblemDetail {
		return {
			type: this.type,
			status: this.statusCode,
			title: this.title,
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
			...(this.organizationId === undefined ? {} : { organizationId: this.organizationId }),
			...(this.ledgerId === undefined ? {} : { ledgerId: this.ledgerId }),
			...(this.accountId === undefined ? {} : { accountId: this.accountId }),
			...(this.transactionId === undefined ? {} : { transactionId: this.transactionId }),
			...(this.idempotencyKey === undefined ? {} : { idempotencyKey: this.idempotencyKey }),
			...(this.retryable === undefined ? {} : { retryable: this.retryable }),
		};
	}
}

class BadRequestError extends HttpError {
	readonly type = "BAD_REQUEST";
	readonly statusCode = 400;
	readonly title = "Bad Request";
}
const BadRequestProblem = problemDetailSchema("BAD_REQUEST", 400);
type BadRequestProblem = Static<typeof BadRequestProblem>;

class UnauthorizedError extends HttpError {
	readonly type = "UNAUTHORIZED";
	readonly statusCode = 401;
	readonly title = "Unauthorized";
}
const UnauthorizedProblem = problemDetailSchema("UNAUTHORIZED", 401);
type UnauthorizedProblem = Static<typeof UnauthorizedProblem>;

class ForbiddenError extends HttpError {
	readonly type = "FORBIDDEN";
	readonly statusCode = 403;
	readonly title = "Forbidden";
}
const ForbiddenProblem = problemDetailSchema("FORBIDDEN", 403);
type ForbiddenProblem = Static<typeof ForbiddenProblem>;

class NotFoundError extends HttpError {
	readonly type = "NOT_FOUND";
	readonly statusCode = 404;
	readonly title = "Not Found";
}
const NotFoundProblem = problemDetailSchema("NOT_FOUND", 404);
type NotFoundProblem = Static<typeof NotFoundProblem>;

class ConflictError extends HttpError {
	readonly type = "CONFLICT";
	readonly statusCode = 409;
	readonly title = "Conflict";
}
const ConflictProblem = problemDetailSchema("CONFLICT", 409);
type ConflictProblem = Static<typeof ConflictProblem>;

class TooManyRequestsError extends HttpError {
	readonly type = "TOO_MANY_REQUESTS";
	readonly statusCode = 429;
	readonly title = "Too Many Requests";
}
const TooManyRequestsProblem = problemDetailSchema("TOO_MANY_REQUESTS", 429);
type TooManyRequestsProblem = Static<typeof TooManyRequestsProblem>;

class InternalServerError extends HttpError {
	readonly type = "INTERNAL_SERVER_ERROR";
	readonly statusCode = 500;
	readonly title = "Internal Server Error";
}
const InternalServerProblem = problemDetailSchema("INTERNAL_SERVER_ERROR", 500);
type InternalServerProblem = Static<typeof InternalServerProblem>;

class ServiceUnavailableError extends HttpError {
	readonly type = "SERVICE_UNAVAILABLE";
	readonly statusCode = 503;
	readonly title = "Service Unavailable";

	constructor(message: string, options: HttpErrorOptions = {}) {
		super(message, { retryable: true, ...options });
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

const sendHttpError = (error: HttpError, request: FastifyRequest, reply: FastifyReply): void => {
	if (error.statusCode >= 500) {
		request.server.log.error(error.cause ?? error, error.message);
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

export type { ErrorContext, HttpErrorOptions, ProblemDetail };
export {
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
