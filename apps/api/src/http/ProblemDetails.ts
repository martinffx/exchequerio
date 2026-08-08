import { Type } from "@sinclair/typebox";

interface ProblemDetail {
	readonly type: string;
	readonly status: number;
	readonly title: string;
	readonly detail: string;
	readonly instance: string;
	readonly traceId: string;
	readonly organizationId?: string;
	readonly retryable?: boolean;
}

interface ProblemContext {
	readonly instance: string;
	readonly traceId: string;
}

abstract class HttpError extends Error {
	abstract readonly statusCode: number;
	abstract readonly title: string;
	readonly organizationId?: string;
	readonly retryable?: boolean;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = this.constructor.name;
	}
}

class BadRequestError extends HttpError {
	readonly statusCode = 400;
	readonly title = "Bad Request";
}

class ForbiddenError extends HttpError {
	readonly statusCode = 403;
	readonly title = "Forbidden";
}

class NotFoundError extends HttpError {
	readonly statusCode = 404;
	readonly title = "Not Found";
}

class ConflictError extends HttpError {
	readonly statusCode = 409;
	readonly title = "Conflict";
}

class InternalServerError extends HttpError {
	readonly statusCode = 500;
	readonly title = "Internal Server Error";
}

class ServiceUnavailableError extends HttpError {
	readonly statusCode = 503;
	readonly title = "Service Unavailable";
	readonly retryable = true;
}

const problem = (
	context: ProblemContext,
	fields: Omit<ProblemDetail, "instance" | "traceId">
): ProblemDetail => ({ ...fields, ...context });

const ProblemDetailSchema = Type.Object({
	type: Type.String(),
	status: Type.Integer(),
	title: Type.String(),
	detail: Type.String(),
	instance: Type.String(),
	traceId: Type.String(),
	organizationId: Type.Optional(Type.String()),
	retryable: Type.Optional(Type.Boolean()),
});

const problemDetailSchema = (type: string, status: number) =>
	Type.Object({
		type: Type.Literal(type),
		status: Type.Literal(status),
		title: Type.String(),
		detail: Type.String(),
		instance: Type.String(),
		traceId: Type.String(),
		organizationId: Type.Optional(Type.String()),
		retryable: Type.Optional(Type.Boolean()),
	});

export type { ProblemContext, ProblemDetail };
export {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	HttpError,
	InternalServerError,
	NotFoundError,
	problem,
	ProblemDetailSchema,
	problemDetailSchema,
	ServiceUnavailableError,
};
