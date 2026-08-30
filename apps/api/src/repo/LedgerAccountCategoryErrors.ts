// oxlint-disable-next-line boundaries/element-types -- The in-place Category migration keeps its errors beside the legacy repository.
import { isPostgresUnavailable } from "@/db";
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";

class CategoryNotFound extends NotFoundError {
	constructor(message: string) {
		super(message);
	}
}

class CategoryConflict extends ConflictError {
	constructor(message: string) {
		super(message);
	}
}

class CategoryRepositoryUnavailable extends ServiceUnavailableError {
	constructor(cause: unknown) {
		super("Category repository unavailable", { cause });
	}
}

class CategoryPersistenceDecodingFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Persisted Category could not be decoded", { cause });
	}
}

class CategoryPersistenceFailure extends InternalServerError {
	constructor(cause: unknown) {
		super("Category persistence operation failed", { cause });
	}
}

type CategoryInfrastructureError =
	| CategoryPersistenceDecodingFailure
	| CategoryPersistenceFailure
	| CategoryRepositoryUnavailable;

const mapCategoryInfrastructureError = (cause: unknown): CategoryInfrastructureError => {
	if (
		cause instanceof CategoryPersistenceDecodingFailure ||
		cause instanceof CategoryPersistenceFailure ||
		cause instanceof CategoryRepositoryUnavailable
	) {
		return cause;
	}
	return isPostgresUnavailable(cause)
		? new CategoryRepositoryUnavailable(cause)
		: new CategoryPersistenceFailure(cause);
};

export type { CategoryInfrastructureError };
export {
	CategoryConflict,
	CategoryNotFound,
	CategoryPersistenceDecodingFailure,
	CategoryPersistenceFailure,
	CategoryRepositoryUnavailable,
	mapCategoryInfrastructureError,
};
