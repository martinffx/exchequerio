import { describe, expect, it } from "vitest";
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "@/lib/errors";
import { type DBError, getDBErrorCode, handleDBError, isDBError } from "./errors";

describe("isDBError", () => {
	it("should return false for null or undefined", () => {
		expect(isDBError(undefined)).toBe(false);
		expect(isDBError(undefined)).toBe(false);
	});

	it("should return false for non-object types", () => {
		expect(isDBError("string")).toBe(false);
		expect(isDBError(123)).toBe(false);
		expect(isDBError(true)).toBe(false);
	});

	it("should return true for error with direct code property", () => {
		const error = { code: "23505", message: "unique violation" };
		expect(isDBError(error)).toBe(true);
	});

	it("should return false for error with non-string code property", () => {
		const error = { code: 123, message: "error" };
		expect(isDBError(error)).toBe(false);
	});

	it("should return true for error with code in cause", () => {
		const error = {
			message: "wrapped error",
			cause: { code: "40001" },
		};
		expect(isDBError(error)).toBe(true);
	});

	it("should return false for error with non-string code in cause", () => {
		const error = {
			message: "wrapped error",
			cause: { code: 456 },
		};
		expect(isDBError(error)).toBe(false);
	});

	it("should return false for error with cause but no code", () => {
		const error = {
			message: "wrapped error",
			cause: { message: "inner error" },
		};
		expect(isDBError(error)).toBe(false);
	});

	it("should return false for error with null cause", () => {
		const error = {
			message: "error",
			cause: undefined,
		};
		expect(isDBError(error)).toBe(false);
	});
});

describe("getDBErrorCode", () => {
	it("should return direct code property", () => {
		const error: DBError = new Error("test") as DBError;
		error.code = "23505";
		expect(getDBErrorCode(error)).toBe("23505");
	});

	it("should return code from cause when direct code is missing", () => {
		const error: DBError = new Error("test") as DBError;
		error.cause = { code: "40001" };
		expect(getDBErrorCode(error)).toBe("40001");
	});

	it("should prefer direct code over cause code", () => {
		const error: DBError = new Error("test") as DBError;
		error.code = "23505";
		error.cause = { code: "40001" };
		expect(getDBErrorCode(error)).toBe("23505");
	});

	it("should return empty string when no code is present", () => {
		const error: DBError = new Error("test") as DBError;
		expect(getDBErrorCode(error)).toBe("");
	});

	it("should return empty string when cause has no code", () => {
		const error: DBError = new Error("test") as DBError;
		error.cause = {};
		expect(getDBErrorCode(error)).toBe("");
	});
});

describe("handleDBError", () => {
	it("should return ConflictError for code 23505 (unique violation)", () => {
		const error: DBError = new Error("unique violation") as DBError;
		error.code = "23505";

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(ConflictError);
		expect(result.message).toBe("Resource already exists");
		expect((result as ConflictError).retryable).toBe(false);
	});

	it("should return NotFoundError for code 23503 (foreign key violation)", () => {
		const error: DBError = new Error("foreign key violation") as DBError;
		error.code = "23503";

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(NotFoundError);
		expect(result.message).toBe("Referenced resource not found");
	});

	it("should return ServiceUnavailableError for code 40001 (serialization failure)", () => {
		const error: DBError = new Error("serialization failure") as DBError;
		error.code = "40001";

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(ServiceUnavailableError);
		expect(result.message).toBe("Transaction conflict - please retry");
		expect((result as ServiceUnavailableError).retryable).toBe(true);
	});

	it("should return ServiceUnavailableError for code OC000 (occ conflict)", () => {
		const error: DBError = new Error("occ conflict") as DBError;
		error.code = "OC000";

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(ServiceUnavailableError);
		expect(result.message).toBe("Transaction conflict - please retry");
		expect((result as ServiceUnavailableError).retryable).toBe(true);
	});

	it("should return ServiceUnavailableError for code 40P01 (deadlock)", () => {
		const error: DBError = new Error("deadlock detected") as DBError;
		error.code = "40P01";

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(ServiceUnavailableError);
		expect(result.message).toBe("Transaction deadlock - please retry");
		expect((result as ServiceUnavailableError).retryable).toBe(true);
	});

	it("should return ServiceUnavailableError for code OC001 (catalog stale)", () => {
		const error: DBError = new Error("catalog stale") as DBError;
		error.code = "OC001";

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(ServiceUnavailableError);
		expect(result.message).toBe("Schema conflict - please retry");
		expect((result as ServiceUnavailableError).retryable).toBe(true);
	});

	it("should return InternalServerError for unknown error code", () => {
		const error: DBError = new Error("unknown error") as DBError;
		error.code = "99999";

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(InternalServerError);
		expect(result.message).toBe("unknown error");
	});

	it("should return InternalServerError with default message when error has no message", () => {
		const error: DBError = new Error("") as DBError;
		error.code = "99999";
		error.message = "";

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(InternalServerError);
		expect(result.message).toBe("Database error");
	});

	it("should handle error with code in cause", () => {
		const error: DBError = new Error("wrapped error") as DBError;
		error.cause = { code: "23505" };

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(ConflictError);
		expect(result.message).toBe("Resource already exists");
	});

	it("should return InternalServerError when no code is present", () => {
		const error: DBError = new Error("no code error") as DBError;

		const result = handleDBError(error);

		expect(result).toBeInstanceOf(InternalServerError);
		expect(result.message).toBe("no code error");
	});

});
