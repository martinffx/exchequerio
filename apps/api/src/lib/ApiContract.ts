import { Schema } from "effect";
import { HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	type HttpError,
	type HttpErrorOptions,
	InternalServerError,
	NotFoundError,
	retryAfterHeaders,
	ServiceUnavailableError,
	TooManyRequestsError,
	UnauthorizedError,
} from "./errors";

/**
 * Effect schemas for the HttpApi path: each encodes its error class to the problem-detail
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

// Collection paths end with `/` because that is the published OpenAPI path key; routing ignores trailing
// slashes. Authentication adds the 401 at the API level; it is declared per route to match the contract.
const commonErrors = [
	BadRequestApiError,
	UnauthorizedApiError,
	ForbiddenApiError,
	InternalServerApiError,
	ServiceUnavailableApiError,
] as const;

/** Common errors plus 429, for groups whose every route is rate limited. */
const throttledErrors = [
	BadRequestApiError,
	UnauthorizedApiError,
	ForbiddenApiError,
	TooManyRequestsApiError,
	InternalServerApiError,
	ServiceUnavailableApiError,
] as const;

const operation = (identifier: string, summary: string, description?: string) =>
	OpenApi.annotations(
		description === undefined ? { identifier, summary } : { identifier, summary, description }
	);

/** An operation whose description repeats its summary. */
const describedOperation = (identifier: string, summary: string) =>
	operation(identifier, summary, summary);

export {
	BadRequestApiError,
	commonErrors,
	ConflictApiError,
	describedOperation,
	ForbiddenApiError,
	InternalServerApiError,
	NotFoundApiError,
	operation,
	ServiceUnavailableApiError,
	throttledErrors,
	TooManyRequestsApiError,
	UnauthorizedApiError,
};
