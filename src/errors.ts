import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuid } from "uuid";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	ServiceUnavailableErrorResponse,
	TooManyRequestsErrorResponse,
	UnauthorizedErrorResponse,
} from "@/routes/schema";

abstract class LedgerError extends Error {
	abstract status: number;
	abstract toResponse(): unknown;
}

class BadRequestError extends LedgerError {
	public readonly status = 400;
	constructor(message: string) {
		super(message);
		this.name = "BadRequestError";
	}

	public toResponse(): BadRequestErrorResponse {
		return {
			type: "BAD_REQUEST",
			status: this.status,
			title: "Bad Request",
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
		};
	}
}

class UnauthorizedError extends LedgerError {
	public readonly status = 401;
	constructor(message: string) {
		super(message);
		this.name = "UnauthorizedError";
	}

	public toResponse(): UnauthorizedErrorResponse {
		return {
			type: "UNAUTHORIZED",
			status: this.status,
			title: "Bad Request",
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
		};
	}
}

class ForbiddenError extends LedgerError {
	public readonly status = 403;
	constructor(message: string) {
		super(message);
		this.name = "ForbiddenError";
	}

	public toResponse(): ForbiddenErrorResponse {
		return {
			type: "FORBIDDEN",
			status: this.status,
			title: "Bad Request",
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
		};
	}
}

class NotFoundError extends LedgerError {
	public readonly status = 404;
	constructor(message: string) {
		super(message);
		this.name = "NotFoundError";
	}

	public toResponse(): NotFoundErrorResponse {
		return {
			type: "NOT_FOUND",
			status: this.status,
			title: "Bad Request",
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
		};
	}
}

class ConflictError extends LedgerError {
	public readonly status = 409;
	constructor(message: string) {
		super(message);
		this.name = "ConflictError";
	}

	public toResponse(): ConflictErrorResponse {
		return {
			type: "CONFLICT",
			status: this.status,
			title: "Bad Request",
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
		};
	}
}

class TooManyRequestsError extends LedgerError {
	public readonly status = 429;
	constructor(message: string) {
		super(message);
		this.name = "TooManyRequestsError";
	}

	public toResponse(): TooManyRequestsErrorResponse {
		return {
			type: "TOO_MANY_REQUESTS",
			status: this.status,
			title: "Bad Request",
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
		};
	}
}

class InternalServerError extends LedgerError {
	public readonly status = 500;
	constructor(message: string) {
		super(message);
		this.name = "InternalServerError";
	}

	public toResponse(): InternalServerErrorResponse {
		return {
			type: "INTERNAL_SERVER_ERROR",
			status: this.status,
			title: "Bad Request",
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
		};
	}
}

class ServiceUnavailableError extends LedgerError {
	public readonly status = 503;
	constructor(message: string) {
		super(message);
		this.name = "ServiceUnavailableError";
	}

	public toResponse(): ServiceUnavailableErrorResponse {
		return {
			type: "SERVICE_UNAVAILABLE",
			status: this.status,
			title: "Bad Request",
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
		};
	}
}

class NotImplementedError extends LedgerError {
	public readonly status = 501;
	constructor(message: string) {
		super(message);
		this.name = "NotImplementedError";
	}

	public toResponse(): Record<string, unknown> {
		return {
			type: "NOT_IMPLEMENTED",
			status: 500, // Use 500 since we don't have 501 response type defined
			title: "Not Implemented",
			detail: this.message,
			instance: `/instance/${uuid()}`,
			traceId: uuid(),
		};
	}
}

const globalErrorHandler = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
	console.log("error", error);

	if (error.code === "FST_ERR_VALIDATION") {
		const ex = new BadRequestError(error.message);
		reply.status(ex.status).send(ex.toResponse());
		return;
	}

	if (error instanceof LedgerError) {
		reply.status(error.status).send(error.toResponse());
		return;
	}

	request.server.log.error(error, "Unknown Error");
	const ex = new InternalServerError(error.message);
	reply.status(ex.status).send(ex.toResponse());
};

export {
	globalErrorHandler,
	LedgerError,
	BadRequestError,
	UnauthorizedError,
	ForbiddenError,
	NotFoundError,
	ConflictError,
	TooManyRequestsError,
	InternalServerError,
	ServiceUnavailableError,
	NotImplementedError,
};
