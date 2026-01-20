import { beforeEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "./logout";

// Mock dependencies
vi.mock("../lib/session.server", () => ({
	getSession: vi.fn(),
	destroySession: vi.fn(),
}));

vi.mock("../lib/auth.server", () => ({
	logoutUser: vi.fn(),
}));

describe("logout route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("loader", () => {
		it("should redirect GET requests to /login", async () => {
			const response = await loader();

			expect(response).toBeInstanceOf(Response);
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe("/login");
		});
	});

	describe("action", () => {
		it("should logout user and redirect to /login", async () => {
			const { getSession, destroySession } = await import("../lib/session.server");
			const { logoutUser } = await import("../lib/auth.server");

			const mockSession = {
				accessToken: "mock_access_token",
				refreshToken: "mock_refresh_token",
				user: {
					id: "user_123",
					email: "test@example.com",
					emailVerified: true,
				},
			};

			vi.mocked(getSession).mockResolvedValue(mockSession);
			vi.mocked(destroySession).mockResolvedValue("session_cookie=; Max-Age=0");
			vi.mocked(logoutUser).mockResolvedValue(undefined);

			const request = new Request("http://localhost:3000/logout", {
				method: "POST",
			});

			const response = await action({ request } as any);

			expect(getSession).toHaveBeenCalledWith(request);
			expect(logoutUser).toHaveBeenCalledWith("user_123");
			expect(destroySession).toHaveBeenCalled();
			expect(response).toBeInstanceOf(Response);
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe("/login");
			expect(response.headers.get("Set-Cookie")).toBe("session_cookie=; Max-Age=0");
		});

		it("should destroy session even if no session exists", async () => {
			const { getSession, destroySession } = await import("../lib/session.server");
			const { logoutUser } = await import("../lib/auth.server");

			vi.mocked(getSession).mockResolvedValue(null);
			vi.mocked(destroySession).mockResolvedValue("session_cookie=; Max-Age=0");

			const request = new Request("http://localhost:3000/logout", {
				method: "POST",
			});

			const response = await action({ request } as any);

			expect(getSession).toHaveBeenCalledWith(request);
			expect(logoutUser).not.toHaveBeenCalled();
			expect(destroySession).toHaveBeenCalled();
			expect(response).toBeInstanceOf(Response);
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe("/login");
		});

		it("should redirect to /login even if WorkOS logout fails", async () => {
			const { getSession, destroySession } = await import("../lib/session.server");
			const { logoutUser } = await import("../lib/auth.server");

			const mockSession = {
				accessToken: "mock_access_token",
				refreshToken: "mock_refresh_token",
				user: {
					id: "user_123",
					email: "test@example.com",
					emailVerified: true,
				},
			};

			vi.mocked(getSession).mockResolvedValue(mockSession);
			vi.mocked(destroySession).mockResolvedValue("session_cookie=; Max-Age=0");
			vi.mocked(logoutUser).mockRejectedValue(new Error("WorkOS logout failed"));

			const request = new Request("http://localhost:3000/logout", {
				method: "POST",
			});

			const response = await action({ request } as any);

			expect(getSession).toHaveBeenCalledWith(request);
			expect(logoutUser).toHaveBeenCalledWith("user_123");
			expect(destroySession).toHaveBeenCalled();
			expect(response).toBeInstanceOf(Response);
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe("/login");
		});
	});
});
