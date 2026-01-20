import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock WorkOS SDK first
vi.mock("@workos-inc/node", () => {
	const mockUserManagement = {
		authenticateWithPassword: vi.fn(),
		createUser: vi.fn(),
		authenticateWithCode: vi.fn(),
		sendPasswordResetEmail: vi.fn(),
		resetPassword: vi.fn(),
		sendMagicAuthCode: vi.fn(),
		authenticateWithMagicAuth: vi.fn(),
		authenticateWithRefreshToken: vi.fn(),
		revokeSession: vi.fn(),
	};

	return {
		WorkOS: class MockWorkOS {
			userManagement = mockUserManagement;
		},
		__mockUserManagement: mockUserManagement,
	};
});

// Mock session server
vi.mock("@/lib/session.server", () => ({
	getUserSession: vi.fn(),
	createSessionStorage: vi.fn(),
}));

import { __mockUserManagement } from "@workos-inc/node";
import * as sessionServer from "@/lib/session.server";
// Import after mocking
import { action, loader } from "./verify-email";

describe("VerifyEmail Route", () => {
	const mockKV = {} as KVNamespace;
	const mockContext = {
		cloudflare: {
			env: {
				SESSION_KV: mockKV,
				WORKOS_API_KEY: "test_key",
				WORKOS_CLIENT_ID: "test_client",
				WORKOS_COOKIE_PASSWORD: "test_password_32_characters_long",
			},
			ctx: {} as ExecutionContext,
		},
	};

	const mockUserManagement = __mockUserManagement;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("loader", () => {
		it("should return email from query params", async () => {
			const request = new Request("http://localhost/verify-email?email=test@example.com");

			const result = await loader({
				request,
				params: {},
				context: mockContext,
			});

			expect(result).toEqual({ email: "test@example.com" });
		});

		it("should return null email when not provided", async () => {
			const request = new Request("http://localhost/verify-email");

			const result = await loader({
				request,
				params: {},
				context: mockContext,
			});

			expect(result).toEqual({ email: null });
		});
	});

	describe("action", () => {
		it("should verify email code and create session on success", async () => {
			// Arrange
			const formData = new FormData();
			formData.append("email", "test@example.com");
			formData.append("code", "123456");

			const request = new Request("http://localhost/verify-email", {
				method: "POST",
				body: formData,
			});

			const mockAuthResponse = {
				accessToken: "access_token",
				refreshToken: "refresh_token",
				user: {
					id: "user_123",
					email: "test@example.com",
					emailVerified: true,
				},
			};

			const mockSession = {
				get: vi.fn(),
				set: vi.fn(),
				has: vi.fn(),
				unset: vi.fn(),
				flash: vi.fn(),
				data: {},
				id: "session_id",
			};

			const mockCommitSession = vi.fn().mockResolvedValue("Set-Cookie: session=...");

			mockUserManagement.authenticateWithCode.mockResolvedValue(mockAuthResponse);
			vi.mocked(sessionServer.createSessionStorage).mockReturnValue({
				getSession: vi.fn().mockResolvedValue(mockSession),
				commitSession: mockCommitSession,
				destroySession: vi.fn(),
			});

			// Act & Assert - redirect() throws a Response object
			try {
				await action({ request, context: mockContext, params: {} });
				expect.fail("Should have thrown a redirect");
			} catch (error) {
				// Verify it's a Response (redirect)
				expect(error).toBeInstanceOf(Response);
				const response = error as Response;
				expect(response.status).toBe(302);
				expect(response.headers.get("Location")).toBe("/dashboard");
				expect(response.headers.get("Set-Cookie")).toBe("Set-Cookie: session=...");
			}

			// Verify session was set correctly
			expect(mockSession.set).toHaveBeenCalledWith("accessToken", "access_token");
			expect(mockSession.set).toHaveBeenCalledWith("refreshToken", "refresh_token");
			expect(mockSession.set).toHaveBeenCalledWith("user", mockAuthResponse.user);
			expect(mockCommitSession).toHaveBeenCalledWith(mockSession);
		});

		it("should return error message on invalid code", async () => {
			// Arrange
			const formData = new FormData();
			formData.append("email", "test@example.com");
			formData.append("code", "000000");

			const request = new Request("http://localhost/verify-email", {
				method: "POST",
				body: formData,
			});

			mockUserManagement.authenticateWithCode.mockRejectedValue(
				new Error("Invalid verification code")
			);

			// Act
			const result = await action({
				request,
				params: {},
				context: mockContext,
			});

			// Assert
			expect(result).toEqual({ error: "Invalid verification code" });
		});

		it("should handle unexpected errors", async () => {
			// Arrange
			const formData = new FormData();
			formData.append("email", "test@example.com");
			formData.append("code", "123456");

			const request = new Request("http://localhost/verify-email", {
				method: "POST",
				body: formData,
			});

			mockUserManagement.authenticateWithCode.mockRejectedValue(new Error("Unexpected error"));

			// Act
			const result = await action({
				request,
				params: {},
				context: mockContext,
			});

			// Assert
			expect(result).toEqual({ error: "Unexpected error" });
		});
	});
});
