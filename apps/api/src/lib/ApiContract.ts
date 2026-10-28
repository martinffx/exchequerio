import { OpenApi } from "effect/unstable/httpapi";
import {
	BadRequestApiError,
	ConflictApiError,
	ForbiddenApiError,
	InternalServerApiError,
	NotFoundApiError,
	ServiceUnavailableApiError,
	TooManyRequestsApiError,
	UnauthorizedApiError,
} from "./errors";

// Authentication adds the 401 at the API level; it is declared per route to match the contract.
// The order of each tuple is the order of responses in the generated OpenAPI document.
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

/** Legacy order of declared errors, 404 and 429 included (Categories and Statements). */
const throttledNotFoundErrors = [
	BadRequestApiError,
	UnauthorizedApiError,
	ForbiddenApiError,
	NotFoundApiError,
	TooManyRequestsApiError,
	InternalServerApiError,
	ServiceUnavailableApiError,
] as const;

/** Legacy order of declared errors, 404, 409 and 429 included (Categories and Statements). */
const throttledConflictErrors = [
	BadRequestApiError,
	UnauthorizedApiError,
	ForbiddenApiError,
	NotFoundApiError,
	ConflictApiError,
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
	commonErrors,
	describedOperation,
	operation,
	throttledConflictErrors,
	throttledErrors,
	throttledNotFoundErrors,
};
