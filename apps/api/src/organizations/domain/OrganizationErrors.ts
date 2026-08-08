import {
	BadRequestError,
	ConflictError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "../../http/ProblemDetails";

class InvalidId extends BadRequestError {
	constructor(
		public readonly prefix: string,
		public readonly value: string,
		options?: ErrorOptions
	) {
		super(`Invalid ${prefix} id: ${value}`, options);
	}
}

class OrganizationNotFound extends NotFoundError {
	constructor(public readonly organizationId: string) {
		super(`Organization not found: ${organizationId}`);
	}
}

class OrganizationHasDependents extends ConflictError {
	constructor(public readonly organizationId: string) {
		super(`Organization has dependents: ${organizationId}`);
	}
}

class OrganizationRepositoryUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown) {
		super("Organization repository unavailable", { cause });
	}
}

class OrganizationPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Persisted Organization could not be decoded", { cause });
	}
}

class OrganizationPersistenceFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Organization persistence operation failed", { cause });
	}
}

type OrganizationInfrastructureError =
	| OrganizationPersistenceDecodingFailure
	| OrganizationPersistenceFailure
	| OrganizationRepositoryUnavailable;

export type { OrganizationInfrastructureError };

export {
	InvalidId,
	OrganizationHasDependents,
	OrganizationNotFound,
	OrganizationPersistenceDecodingFailure,
	OrganizationPersistenceFailure,
	OrganizationRepositoryUnavailable,
};
