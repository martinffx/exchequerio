import { describe, expect, it } from "vitest";
import {
	AuthError,
	EmailVerificationRequiredError,
	InvalidCredentialsError,
	RateLimitError,
} from "./errors";

describe("AuthError", () => {
	it("should create error with code, message, and statusCode", () => {
		const error = new AuthError("test_error", "Test error message", 400);

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(AuthError);
		expect(error.name).toBe("AuthError");
		expect(error.code).toBe("test_error");
		expect(error.message).toBe("Test error message");
		expect(error.statusCode).toBe(400);
	});

	it("should default to 401 status code if not provided", () => {
		const error = new AuthError("test_error", "Test error message");

		expect(error.statusCode).toBe(401);
	});
});

describe("EmailVerificationRequiredError", () => {
	it("should extend AuthError with correct properties", () => {
		const error = new EmailVerificationRequiredError();

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(AuthError);
		expect(error).toBeInstanceOf(EmailVerificationRequiredError);
		expect(error.name).toBe("AuthError");
		expect(error.code).toBe("email_verification_required");
		expect(error.message).toBe("Email verification required");
		expect(error.statusCode).toBe(403);
	});
});

describe("InvalidCredentialsError", () => {
	it("should extend AuthError with correct properties", () => {
		const error = new InvalidCredentialsError();

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(AuthError);
		expect(error).toBeInstanceOf(InvalidCredentialsError);
		expect(error.name).toBe("AuthError");
		expect(error.code).toBe("invalid_credentials");
		expect(error.message).toBe("Invalid email or password");
		expect(error.statusCode).toBe(401);
	});
});

describe("RateLimitError", () => {
	it("should extend AuthError with correct properties", () => {
		const error = new RateLimitError();

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(AuthError);
		expect(error).toBeInstanceOf(RateLimitError);
		expect(error.name).toBe("AuthError");
		expect(error.code).toBe("rate_limit_exceeded");
		expect(error.message).toBe("Too many requests. Please try again later.");
		expect(error.statusCode).toBe(429);
	});
});
