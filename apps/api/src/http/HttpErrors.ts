import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuid } from "uuid";
import { LedgerError } from "../Errors";
import {
	BadRequestError,
	HttpError,
	InternalServerError,
	problem,
	ServiceUnavailableError,
	type ProblemContext,
	type ProblemDetail,
} from "./ProblemDetails";

interface HttpFailure {
	readonly status: number;
	readonly problem: ProblemDetail;
	readonly cause?: unknown;
}

const httpFailure = (error: HttpError, context: ProblemContext): HttpFailure => ({
	status: error.statusCode,
	problem: problem(context, {
		type: error.title.toUpperCase().replaceAll(" ", "_"),
		status: error.statusCode,
		title: error.title,
		detail: error.message,
		...(error.organizationId === undefined ? {} : { organizationId: error.organizationId }),
		...(error.retryable === undefined ? {} : { retryable: error.retryable }),
	}),
	...(error.cause === undefined ? {} : { cause: error.cause }),
});

const problemContext = (): ProblemContext => ({
	instance: `/instance/${uuid()}`,
	traceId: uuid(),
});

const sendHttpFailure = (error: HttpError, request: FastifyRequest, reply: FastifyReply) => {
	const failure = httpFailure(error, problemContext());
	if (failure.status >= 500) {
		request.server.log.error(failure.cause ?? error, error.message);
	}
	reply.status(failure.status).send(failure.problem);
};

const globalErrorHandler = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
	if (error.code === "FST_ERR_VALIDATION") {
		sendHttpFailure(new BadRequestError(error.message), request, reply);
		return;
	}
	if (error.code === "FST_UNDER_PRESSURE") {
		sendHttpFailure(new ServiceUnavailableError(error.message, { cause: error }), request, reply);
		return;
	}
	if (error instanceof HttpError) {
		sendHttpFailure(error, request, reply);
		return;
	}
	if (error instanceof LedgerError) {
		reply.status(error.status).send(error.toResponse());
		return;
	}
	sendHttpFailure(
		new InternalServerError("Internal Server Error", { cause: error }),
		request,
		reply
	);
};

export type { HttpFailure };
export { globalErrorHandler, httpFailure };
