import { OpenApi } from "effect/unstable/httpapi";
import {
	BadRequestApiError,
	ForbiddenApiError,
	InternalServerApiError,
	ServiceUnavailableApiError,
	TooManyRequestsApiError,
	UnauthorizedApiError,
} from "./errors";

// Authentication adds the 401 at the API level; it is declared per route to match the contract.
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

export { commonErrors, describedOperation, operation, throttledErrors };
