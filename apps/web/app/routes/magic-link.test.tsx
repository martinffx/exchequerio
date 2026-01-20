import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock WorkOS before any imports
vi.mock("@workos-inc/node", () => ({
	WorkOS: class MockWorkOS {
		userManagement = {
			sendMagicAuthCode: vi.fn(),
			authenticateWithMagicAuth: vi.fn(),
		};
	},
}));

// Mock dependencies
vi.mock("@/lib/auth.server");
vi.mock("@/lib/session.server");

import * as authServer from "@/lib/auth.server";
import * as sessionServer from "@/lib/session.server";
import { action } from "./magic-link";

describe("Magic Link Route", () => {
	const mockContext = {
		cloudflare: {
			env: {
				SESSION_KV: {} as KVNamespace,
			},
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("action", () => {
		it("should send magic link code when no code provided", async () => {
			const sendMagicAuthCodeMock = vi
				.spyOn(authServer, "sendMagicAuthCode")
				.mockResolvedValue(undefined);

			const request = new Request("http://localhost/magic-link", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ email: "test@example.com" }),
			});

			const result = await action({
				request,
				context: mockContext,
				params: {},
			});

			expect(sendMagicAuthCodeMock).toHaveBeenCalledWith("test@example.com");
			expect(result).toEqual({ codeSent: true });
		});

		it("should authenticate with code when provided", async () => {
			const authenticateWithMagicAuthMock = vi
				.spyOn(authServer, "authenticateWithMagicAuth")
				.mockResolvedValue({
					accessToken: "access_token",
					refreshToken: "refresh_token",
					user: {
						id: "user_123",
						email: "test@example.com",
						emailVerified: true,
					},
				});

			const mockSession = {
				set: vi.fn(),
			};

			const mockCommitSession = vi.fn().mockResolvedValue("session_cookie");

			vi.spyOn(sessionServer, "createSessionStorage").mockReturnValue({
				getSession: vi.fn().mockResolvedValue(mockSession),
				commitSession: mockCommitSession,
				destroySession: vi.fn(),
			} as any);

			const request = new Request("http://localhost/magic-link", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					email: "test@example.com",
					code: "123456",
				}),
			});

			try {
				await action({
					request,
					context: mockContext,
					params: {},
				});
				expect.fail("Should have thrown redirect");
			} catch (error) {
				expect(error).toBeInstanceOf(Response);
				expect((error as Response).status).toBe(302);
				expect((error as Response).headers.get("Location")).toBe("/dashboard");
				expect((error as Response).headers.get("Set-Cookie")).toBe("session_cookie");
			}

			expect(authenticateWithMagicAuthMock).toHaveBeenCalledWith("123456", "test@example.com");
			expect(mockSession.set).toHaveBeenCalledWith("accessToken", "access_token");
			expect(mockSession.set).toHaveBeenCalledWith("refreshToken", "refresh_token");
			expect(mockSession.set).toHaveBeenCalledWith("user", {
				id: "user_123",
				email: "test@example.com",
				emailVerified: true,
			});
		});

		it("should return error message on invalid code", async () => {
			const authenticateWithMagicAuthMock = vi
				.spyOn(authServer, "authenticateWithMagicAuth")
				.mockRejectedValue(new Error("Invalid code"));

			const request = new Request("http://localhost/magic-link", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					email: "test@example.com",
					code: "invalid",
				}),
			});

			const result = await action({
				request,
				context: mockContext,
				params: {},
			});

			expect(authenticateWithMagicAuthMock).toHaveBeenCalledWith("invalid", "test@example.com");
			expect(result).toEqual({ error: "Invalid code" });
		});

		it("should return error message on send code failure", async () => {
			const sendMagicAuthCodeMock = vi
				.spyOn(authServer, "sendMagicAuthCode")
				.mockRejectedValue(new Error("Failed to send code"));

			const request = new Request("http://localhost/magic-link", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ email: "test@example.com" }),
			});

			const result = await action({
				request,
				context: mockContext,
				params: {},
			});

			expect(sendMagicAuthCodeMock).toHaveBeenCalledWith("test@example.com");
			expect(result).toEqual({ error: "Failed to send code" });
		});
	});
});
