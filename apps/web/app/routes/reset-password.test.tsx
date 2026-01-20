import { beforeEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "./reset-password";

// Mock auth.server module
vi.mock("@/lib/auth.server", () => ({
	resetPassword: vi.fn(),
}));

import { resetPassword } from "@/lib/auth.server";
import { AuthError } from "@/lib/errors";

describe("Reset Password Route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("loader", () => {
		it("should extract token from query params", async () => {
			const request = new Request("http://localhost/reset-password?token=reset_token_123");

			const result = await loader({
				request,
				params: {},
				context: {} as any,
			});

			expect(result).toEqual({ token: "reset_token_123" });
		});

		it("should return null when no token provided", async () => {
			const request = new Request("http://localhost/reset-password");

			const result = await loader({
				request,
				params: {},
				context: {} as any,
			});

			expect(result).toEqual({ token: null });
		});
	});

	describe("action", () => {
		it("should reset password and redirect to login on success", async () => {
			vi.mocked(resetPassword).mockResolvedValue(undefined);

			const formData = new FormData();
			formData.append("token", "reset_token_123");
			formData.append("password", "newPassword123!");

			const request = new Request("http://localhost/reset-password", {
				method: "POST",
				body: formData,
			});

			const result = await action({
				request,
				params: {},
				context: {} as any,
			});

			expect(resetPassword).toHaveBeenCalledWith("reset_token_123", "newPassword123!");
			expect(result).toBeInstanceOf(Response);
			expect((result as Response).status).toBe(302);
			expect((result as Response).headers.get("Location")).toBe("/login?reset=success");
		});

		it("should return error message when token is invalid", async () => {
			vi
				.mocked(resetPassword)
				.mockRejectedValue(new AuthError("invalid_grant", "Invalid or expired token", 401));

			const formData = new FormData();
			formData.append("token", "invalid_token");
			formData.append("password", "newPassword123!");

			const request = new Request("http://localhost/reset-password", {
				method: "POST",
				body: formData,
			});

			const result = await action({
				request,
				params: {},
				context: {} as any,
			});

			expect(result).toEqual({
				error: "Invalid or expired token",
			});
		});

		it("should return error message on unexpected errors", async () => {
			vi.mocked(resetPassword).mockRejectedValue(new Error("Network error"));

			const formData = new FormData();
			formData.append("token", "reset_token_123");
			formData.append("password", "newPassword123!");

			const request = new Request("http://localhost/reset-password", {
				method: "POST",
				body: formData,
			});

			const result = await action({
				request,
				params: {},
				context: {} as any,
			});

			expect(result).toEqual({
				error: "Network error",
			});
		});
	});
});
