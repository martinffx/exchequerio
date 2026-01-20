import { describe, expect, it } from "vitest";
import { isTokenExpired } from "./utils.server";

/**
 * Helper function to create a JWT token with a specific expiration time.
 * Note: This creates a minimal JWT for testing purposes only.
 */
function createJWT(payload: { exp: number }): string {
	const header = { alg: "HS256", typ: "JWT" };
	const encodedHeader = btoa(JSON.stringify(header));
	const encodedPayload = btoa(JSON.stringify(payload));
	// Signature is not validated in our implementation, so we can use a dummy value
	const signature = "dummy-signature";
	return `${encodedHeader}.${encodedPayload}.${signature}`;
}

describe("isTokenExpired", () => {
	it("should return true for expired token", () => {
		const expiredTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
		const token = createJWT({ exp: expiredTime });

		expect(isTokenExpired(token)).toBe(true);
	});

	it("should return false for valid token", () => {
		const validTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
		const token = createJWT({ exp: validTime });

		expect(isTokenExpired(token)).toBe(false);
	});

	it("should return true for token expiring within 1 minute", () => {
		const soonToExpireTime = Math.floor(Date.now() / 1000) + 30; // 30 seconds from now
		const token = createJWT({ exp: soonToExpireTime });

		expect(isTokenExpired(token)).toBe(true);
	});

	it("should return true for token expiring in exactly 1 minute", () => {
		const oneMinuteFromNow = Math.floor(Date.now() / 1000) + 60;
		const token = createJWT({ exp: oneMinuteFromNow });

		// Should be considered expired (within the 1-minute buffer)
		expect(isTokenExpired(token)).toBe(true);
	});

	it("should return false for token expiring in more than 1 minute", () => {
		const moreThanOneMinute = Math.floor(Date.now() / 1000) + 61; // 61 seconds from now
		const token = createJWT({ exp: moreThanOneMinute });

		expect(isTokenExpired(token)).toBe(false);
	});

	it("should return true for malformed token (invalid structure)", () => {
		const malformedToken = "not.a.valid.jwt.token";

		expect(isTokenExpired(malformedToken)).toBe(true);
	});

	it("should return true for token with invalid base64 payload", () => {
		const invalidToken = "header.invalid-base64.signature";

		expect(isTokenExpired(invalidToken)).toBe(true);
	});

	it("should return true for token with missing exp claim", () => {
		// Manually create token without exp
		const header = { alg: "HS256", typ: "JWT" };
		const payload = { sub: "user123" }; // No exp field
		const encodedHeader = btoa(JSON.stringify(header));
		const encodedPayload = btoa(JSON.stringify(payload));
		const token = `${encodedHeader}.${encodedPayload}.signature`;

		expect(isTokenExpired(token)).toBe(true);
	});
});
