import type { ProblemContext, ProblemDetail } from "../http/ProblemDetails";
import { problem } from "../http/ProblemDetails";
import {
	InvalidOrganizationDescriptionUpdate,
	InvalidOrganizationId,
	OrganizationAccessDenied,
	OrganizationHasDependents,
	OrganizationNotFound,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
} from "./domain/OrganizationErrors";

type OrganizationHttpError =
	| InvalidOrganizationDescriptionUpdate
	| InvalidOrganizationId
	| OrganizationAccessDenied
	| OrganizationHasDependents
	| OrganizationNotFound
	| OrganizationPersistenceDecodingFailure
	| OrganizationPersistenceFailure
	| OrganizationRepositoryUnavailable;

interface OrganizationHttpFailure {
	readonly status: number;
	readonly problem: ProblemDetail;
	readonly cause?: unknown;
}

const organizationHttpFailure = (
	error: OrganizationHttpError,
	context: ProblemContext
): OrganizationHttpFailure => {
	switch (error._tag) {
		case "InvalidOrganizationId":
			return {
				status: 400,
				problem: problem(context, {
					type: "BAD_REQUEST",
					status: 400,
					title: "Bad Request",
					detail: `Invalid Organization ID: ${error.value}`,
				}),
			};
		case "InvalidOrganizationDescriptionUpdate":
			return {
				status: 400,
				problem: problem(context, {
					type: "BAD_REQUEST",
					status: 400,
					title: "Bad Request",
					detail: "The Organization description update is invalid",
				}),
			};
		case "OrganizationAccessDenied":
			return {
				status: 403,
				problem: problem(context, {
					type: "FORBIDDEN",
					status: 403,
					title: "Forbidden",
					detail: "The caller cannot access this Organization",
					...(error.organizationId === undefined ? {} : { organizationId: error.organizationId }),
				}),
			};
		case "OrganizationNotFound":
			return {
				status: 404,
				problem: problem(context, {
					type: "NOT_FOUND",
					status: 404,
					title: "Not Found",
					detail: "The Organization was not found",
					organizationId: error.organizationId,
				}),
			};
		case "OrganizationHasDependents":
			return {
				status: 409,
				problem: problem(context, {
					type: "CONFLICT",
					status: 409,
					title: "Conflict",
					detail: "The Organization has dependent resources",
					organizationId: error.organizationId,
				}),
			};
		case "OrganizationRepositoryUnavailable":
			return {
				status: 503,
				cause: error.cause,
				problem: problem(context, {
					type: "SERVICE_UNAVAILABLE",
					status: 503,
					title: "Service Unavailable",
					detail: "The Organization repository is temporarily unavailable",
					retryable: true,
				}),
			};
		case "OrganizationPersistenceDecodingFailure":
		case "OrganizationPersistenceFailure":
			return {
				status: 500,
				cause: error.cause,
				problem: problem(context, {
					type: "INTERNAL_SERVER_ERROR",
					status: 500,
					title: "Internal Server Error",
					detail: "The Organization operation could not be completed",
				}),
			};
	}
};

export type { OrganizationHttpError, OrganizationHttpFailure };
export { organizationHttpFailure };
