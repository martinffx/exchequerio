import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "./forgot-password";

// Mock auth.server module
vi.mock("@/lib/auth.server", () => ({
	createPasswordReset: vi.fn(),
}));

import { createPasswordReset } from "@/lib/auth.server";
import { RateLimitError } from "@/lib/errors";

describe("Forgot Password Route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("action", () => {
		it("should return success message when password reset email sent", async () => {
			vi.mocked(createPasswordReset).mockResolvedValue(undefined);

			const formData = new FormData();
			formData.append("email", "test@example.com");

			const request = new Request("http://localhost/forgot-password", {
				method: "POST",
				body: formData,
			});

			const result = await action({
				request,
				params: {},
				context: {} as any,
			});

			expect(result).toEqual({ success: true });
			expect(createPasswordReset).toHaveBeenCalledWith("test@example.com");
		});

		it("should return error message when rate limit exceeded", async () => {
			vi.mocked(createPasswordReset).mockRejectedValue(new RateLimitError());

			const formData = new FormData();
			formData.append("email", "test@example.com");

			const request = new Request("http://localhost/forgot-password", {
				method: "POST",
				body: formData,
			});

			const result = await action({
				request,
				params: {},
				context: {} as any,
			});

			expect(result).toEqual({
				error: "Too many requests. Please try again later.",
			});
		});

		it("should return error message on unexpected errors", async () => {
			vi.mocked(createPasswordReset).mockRejectedValue(new Error("Network error"));

			const formData = new FormData();
			formData.append("email", "test@example.com");

			const request = new Request("http://localhost/forgot-password", {
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
