import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the WorkOS SDK
vi.mock("@workos-inc/node", () => {
	// Create mock functions inside the factory
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
		// Export the mocks so we can access them in tests
		__mockUserManagement: mockUserManagement,
	};
});

import { __mockUserManagement } from "@workos-inc/node";
// Import after mocking
import {
	authenticateWithMagicAuth,
	authenticateWithPassword,
	createPasswordReset,
	createUser,
	logoutUser,
	refreshAccessToken,
	resetPassword,
	sendMagicAuthCode,
	verifyEmailCode,
} from "./auth.server";
import {
	AuthError,
	EmailVerificationRequiredError,
	InvalidCredentialsError,
	RateLimitError,
} from "./errors";

describe("auth.server", () => {
	const mockUserManagement = __mockUserManagement;

	beforeEach(() => {
		// Reset all mocks before each test
		vi.clearAllMocks();
	});

	describe("authenticateWithPassword", () => {
		it("should return auth response on success", async () => {
			const mockResponse = {
				accessToken: "mock_access_token",
				refreshToken: "mock_refresh_token",
				user: {
					id: "user_123",
					email: "test@example.com",
					emailVerified: true,
					firstName: "Test",
					lastName: "User",
				},
			};

			mockUserManagement.authenticateWithPassword.mockResolvedValue(mockResponse);

			const result = await authenticateWithPassword("test@example.com", "password123");

			expect(result).toEqual(mockResponse);
			expect(mockUserManagement.authenticateWithPassword).toHaveBeenCalledWith({
				clientId: expect.any(String),
				email: "test@example.com",
				password: "password123",
			});
		});

		it("should throw EmailVerificationRequiredError when email not verified", async () => {
			mockUserManagement.authenticateWithPassword.mockRejectedValue({
				code: "email_verification_required",
				message: "Email verification required",
			});

			await expect(authenticateWithPassword("unverified@example.com", "password123")).rejects.toThrow(
				EmailVerificationRequiredError
			);
		});

		it("should throw InvalidCredentialsError on invalid credentials", async () => {
			mockUserManagement.authenticateWithPassword.mockRejectedValue({
				code: "invalid_credentials",
				message: "Invalid credentials",
			});

			await expect(authenticateWithPassword("test@example.com", "wrongpassword")).rejects.toThrow(
				InvalidCredentialsError
			);
		});

		it("should throw RateLimitError when rate limit exceeded", async () => {
			mockUserManagement.authenticateWithPassword.mockRejectedValue({
				code: "rate_limit_exceeded",
				message: "Rate limit exceeded",
			});

			await expect(authenticateWithPassword("test@example.com", "password123")).rejects.toThrow(
				RateLimitError
			);
		});
	});

	describe("createUser", () => {
		it("should create user with valid data", async () => {
			const mockResponse = {
				id: "user_new",
				email: "newuser@example.com",
				emailVerified: false,
			};

			mockUserManagement.createUser.mockResolvedValue(mockResponse);

			const result = await createUser("newuser@example.com", "password123");

			expect(result).toEqual(mockResponse);
			expect(mockUserManagement.createUser).toHaveBeenCalledWith({
				email: "newuser@example.com",
				password: "password123",
			});
		});

		it("should throw error when email already exists", async () => {
			mockUserManagement.createUser.mockRejectedValue({
				code: "user_already_exists",
				message: "User already exists",
			});

			await expect(createUser("existing@example.com", "password123")).rejects.toThrow(AuthError);
		});
	});

	describe("verifyEmailCode", () => {
		it("should authenticate with valid code", async () => {
			const mockResponse = {
				accessToken: "mock_access_token",
				refreshToken: "mock_refresh_token",
				user: {
					id: "user_123",
					email: "test@example.com",
					emailVerified: true,
				},
			};

			mockUserManagement.authenticateWithCode.mockResolvedValue(mockResponse);

			const result = await verifyEmailCode("test@example.com", "123456");

			expect(result).toEqual(mockResponse);
			expect(result.user.emailVerified).toBe(true);
			expect(mockUserManagement.authenticateWithCode).toHaveBeenCalledWith({
				clientId: expect.any(String),
				code: "123456",
				email: "test@example.com",
			});
		});

		it("should throw error with invalid code", async () => {
			mockUserManagement.authenticateWithCode.mockRejectedValue({
				code: "invalid_code",
				message: "Invalid code",
			});

			await expect(verifyEmailCode("test@example.com", "000000")).rejects.toThrow(AuthError);
		});
	});

	describe("createPasswordReset", () => {
		it("should send password reset email", async () => {
			mockUserManagement.sendPasswordResetEmail.mockResolvedValue(undefined);

			await expect(createPasswordReset("test@example.com")).resolves.toBeUndefined();

			expect(mockUserManagement.sendPasswordResetEmail).toHaveBeenCalledWith({
				email: "test@example.com",
			});
		});

		it("should throw RateLimitError when rate limit exceeded", async () => {
			mockUserManagement.sendPasswordResetEmail.mockRejectedValue({
				code: "rate_limit_exceeded",
				message: "Rate limit exceeded",
			});

			await expect(createPasswordReset("test@example.com")).rejects.toThrow(RateLimitError);
		});
	});

	describe("resetPassword", () => {
		it("should reset password with valid token", async () => {
			mockUserManagement.resetPassword.mockResolvedValue(undefined);

			await expect(resetPassword("valid_token", "newpassword123")).resolves.toBeUndefined();

			expect(mockUserManagement.resetPassword).toHaveBeenCalledWith({
				token: "valid_token",
				newPassword: "newpassword123",
			});
		});

		it("should throw error with invalid token", async () => {
			mockUserManagement.resetPassword.mockRejectedValue({
				code: "invalid_token",
				message: "Invalid token",
			});

			await expect(resetPassword("invalid_token", "newpassword123")).rejects.toThrow(AuthError);
		});
	});

	describe("sendMagicAuthCode", () => {
		it("should send magic auth code", async () => {
			mockUserManagement.sendMagicAuthCode.mockResolvedValue(undefined);

			await expect(sendMagicAuthCode("test@example.com")).resolves.toBeUndefined();

			expect(mockUserManagement.sendMagicAuthCode).toHaveBeenCalledWith({
				email: "test@example.com",
			});
		});

		it("should throw RateLimitError when rate limit exceeded", async () => {
			mockUserManagement.sendMagicAuthCode.mockRejectedValue({
				code: "rate_limit_exceeded",
				message: "Rate limit exceeded",
			});

			await expect(sendMagicAuthCode("test@example.com")).rejects.toThrow(RateLimitError);
		});
	});

	describe("authenticateWithMagicAuth", () => {
		it("should authenticate with valid code", async () => {
			const mockResponse = {
				accessToken: "mock_access_token",
				refreshToken: "mock_refresh_token",
				user: {
					id: "user_123",
					email: "test@example.com",
					emailVerified: true,
				},
			};

			mockUserManagement.authenticateWithMagicAuth.mockResolvedValue(mockResponse);

			const result = await authenticateWithMagicAuth("123456", "test@example.com");

			expect(result).toEqual(mockResponse);
			expect(mockUserManagement.authenticateWithMagicAuth).toHaveBeenCalledWith({
				clientId: expect.any(String),
				code: "123456",
				email: "test@example.com",
			});
		});

		it("should throw error with invalid code", async () => {
			mockUserManagement.authenticateWithMagicAuth.mockRejectedValue({
				code: "invalid_code",
				message: "Invalid code",
			});

			await expect(authenticateWithMagicAuth("000000", "test@example.com")).rejects.toThrow(AuthError);
		});
	});

	describe("refreshAccessToken", () => {
		it("should refresh access token with valid refresh token", async () => {
			const mockResponse = {
				accessToken: "new_access_token",
				refreshToken: "new_refresh_token",
				user: {
					id: "user_123",
					email: "test@example.com",
					emailVerified: true,
				},
			};

			mockUserManagement.authenticateWithRefreshToken.mockResolvedValue(mockResponse);

			const result = await refreshAccessToken("valid_refresh_token");

			expect(result).toEqual(mockResponse);
			expect(mockUserManagement.authenticateWithRefreshToken).toHaveBeenCalledWith({
				clientId: expect.any(String),
				refreshToken: "valid_refresh_token",
			});
		});

		it("should throw error with invalid refresh token", async () => {
			mockUserManagement.authenticateWithRefreshToken.mockRejectedValue({
				code: "invalid_grant",
				message: "Invalid refresh token",
			});

			await expect(refreshAccessToken("invalid_token")).rejects.toThrow(AuthError);
		});
	});

	describe("logoutUser", () => {
		it("should revoke user session", async () => {
			mockUserManagement.revokeSession.mockResolvedValue(undefined);

			await expect(logoutUser("user_123")).resolves.toBeUndefined();

			expect(mockUserManagement.revokeSession).toHaveBeenCalledWith({
				userId: "user_123",
			});
		});

		it("should not throw error on logout failure", async () => {
			mockUserManagement.revokeSession.mockRejectedValue(new Error("Session not found"));

			// Logout should be silent even if it fails
			await expect(logoutUser("invalid_user")).resolves.toBeUndefined();
		});
	});
});
