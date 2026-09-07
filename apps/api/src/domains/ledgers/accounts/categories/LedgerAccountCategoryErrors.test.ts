import { describe, expect, expectTypeOf, it } from "vitest";

import {
	CategoryConflict,
	CategoryNotFound,
	CategoryPersistenceDecodingFailure,
	CategoryPersistenceFailure,
	CategoryRepositoryUnavailable,
	mapCategoryInfrastructureError,
} from "./LedgerAccountCategoryErrors";
import type { CategoryInfrastructureError } from "./LedgerAccountCategoryErrors";

describe("Category errors", () => {
	it("preserves operation-specific not-found and conflict messages", () => {
		const notFound = new CategoryNotFound("Category not found: cat_123");
		const conflict = new CategoryConflict("Category not found or ledgerId mismatch");

		expect(notFound).toMatchObject({
			message: "Category not found: cat_123",
			name: "CategoryNotFound",
			statusCode: 404,
		});
		expect(conflict).toMatchObject({
			message: "Category not found or ledgerId mismatch",
			name: "CategoryConflict",
			statusCode: 409,
		});
	});

	it("retains causes on persistence errors", () => {
		const decodingCause = new Error("invalid row");
		const persistenceCause = new Error("query failed");

		expect(new CategoryPersistenceDecodingFailure(decodingCause)).toMatchObject({
			cause: decodingCause,
			message: "Persisted Category could not be decoded",
			statusCode: 500,
		});
		expect(new CategoryPersistenceFailure(persistenceCause)).toMatchObject({
			cause: persistenceCause,
			message: "Category persistence operation failed",
			statusCode: 500,
		});
	});

	it("retains the cause and retryable response behavior for repository unavailability", () => {
		const cause = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
		const error = new CategoryRepositoryUnavailable(cause);

		expect(error).toMatchObject({
			cause,
			message: "Category repository unavailable",
			retryable: true,
			statusCode: 503,
		});
	});

	it("preserves already-typed infrastructure errors", () => {
		const errors = [
			new CategoryPersistenceDecodingFailure(new Error("invalid row")),
			new CategoryPersistenceFailure(new Error("query failed")),
			new CategoryRepositoryUnavailable(new Error("offline")),
		] satisfies CategoryInfrastructureError[];

		for (const error of errors) {
			expect(mapCategoryInfrastructureError(error)).toBe(error);
		}
	});

	it("maps PostgreSQL unavailability to a repository-unavailable error", () => {
		const cause = { code: "57P01" };
		const error = mapCategoryInfrastructureError(cause);

		expectTypeOf(error).toEqualTypeOf<CategoryInfrastructureError>();
		expect(error).toBeInstanceOf(CategoryRepositoryUnavailable);
		expect(error.cause).toBe(cause);
	});

	it("maps other causes to a persistence failure", () => {
		const cause = new Error("query failed");
		const error = mapCategoryInfrastructureError(cause);

		expect(error).toBeInstanceOf(CategoryPersistenceFailure);
		expect(error.cause).toBe(cause);
	});
});
