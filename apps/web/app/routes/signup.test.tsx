import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/errors";

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

import { __mockUserManagement } from "@workos-inc/node";
// Import after mocking
import { action } from "./signup";

describe("Signup Route", () => {
	const mockUserManagement = __mockUserManagement;
	const mockContext = {
		cloudflare: {
			env: {},
			ctx: {} as ExecutionContext,
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("action", () => {
		it("should create user and redirect to /verify-email on success", async () => {
			// Arrange
			const formData = new FormData();
			formData.append("email", "newuser@example.com");
			formData.append("password", "password123");

			const request = new Request("http://localhost/signup", {
				method: "POST",
				body: formData,
			});

			const mockCreateUserResponse = {
				id: "user_new",
				email: "newuser@example.com",
				emailVerified: false,
			};

			mockUserManagement.createUser.mockResolvedValue(mockCreateUserResponse);

			// Act & Assert - redirect() throws a Response object
			try {
				await action({ request, context: mockContext, params: {} });
				expect.fail("Should have thrown a redirect");
			} catch (error) {
				// Verify it's a Response (redirect)
				expect(error).toBeInstanceOf(Response);
				const response = error as Response;
				expect(response.status).toBe(302);
				expect(response.headers.get("Location")).toBe("/verify-email?email=newuser%40example.com");
			}

			// Verify createUser was called with correct data
			expect(mockUserManagement.createUser).toHaveBeenCalledWith({
				email: "newuser@example.com",
				password: "password123",
			});
		});

		it("should return error message on duplicate email", async () => {
			// Arrange
			const formData = new FormData();
			formData.append("email", "existing@example.com");
			formData.append("password", "password123");

			const request = new Request("http://localhost/signup", {
				method: "POST",
				body: formData,
			});

			// Simulate duplicate email error
			const duplicateError = new AuthError(
				"user_already_exists",
				"User with this email already exists",
				409
			);
			mockUserManagement.createUser.mockRejectedValue(duplicateError);

			// Act
			const result = await action({ request, context: mockContext, params: {} });

			// Assert
			expect(result).toEqual({
				error: "User with this email already exists",
			});
		});

		it("should return generic error message for unexpected errors", async () => {
			// Arrange
			const formData = new FormData();
			formData.append("email", "test@example.com");
			formData.append("password", "password123");

			const request = new Request("http://localhost/signup", {
				method: "POST",
				body: formData,
			});

			mockUserManagement.createUser.mockRejectedValue(new Error("Unexpected error"));

			// Act
			const result = await action({ request, context: mockContext, params: {} });

			// Assert
			expect(result).toEqual({
				error: "Unexpected error",
			});
		});
	});
});
