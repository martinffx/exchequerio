import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionStorage, getUserSession } from "./session.server";
import type { SessionData } from "./types";

// Mock @react-router/cloudflare
vi.mock("@react-router/cloudflare", () => ({
	createWorkersKVSessionStorage: vi.fn(),
}));

import { createWorkersKVSessionStorage } from "@react-router/cloudflare";

describe("session.server", () => {
	let mockKV: KVNamespace;
	let mockSession: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock KV namespace
		mockKV = {
			get: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
			list: vi.fn(),
			getWithMetadata: vi.fn(),
		} as any;

		// Mock session object returned by React Router
		mockSession = {
			get: vi.fn(),
			set: vi.fn(),
			has: vi.fn(),
			unset: vi.fn(),
			flash: vi.fn(),
			data: {},
		};
	});

	describe("createSessionStorage", () => {
		it("should call createWorkersKVSessionStorage with correct config", () => {
			const mockStorage = {
				getSession: vi.fn(),
				commitSession: vi.fn(),
				destroySession: vi.fn(),
			};

			vi.mocked(createWorkersKVSessionStorage).mockReturnValue(mockStorage as any);

			const storage = createSessionStorage(mockKV);

			expect(createWorkersKVSessionStorage).toHaveBeenCalledWith({
				kv: mockKV,
				cookie: expect.objectContaining({
					name: "workos_session",
					httpOnly: true,
					secure: true,
					sameSite: "lax",
					secrets: expect.any(Array),
					maxAge: 60 * 60 * 24 * 7, // 7 days
				}),
			});

			expect(storage).toBe(mockStorage);
		});

		it("should use WORKOS_COOKIE_PASSWORD from environment", () => {
			const originalEnv = process.env.WORKOS_COOKIE_PASSWORD;
			process.env.WORKOS_COOKIE_PASSWORD = "test-secret-password-32-chars-min";

			vi.mocked(createWorkersKVSessionStorage).mockReturnValue({} as any);

			createSessionStorage(mockKV);

			expect(createWorkersKVSessionStorage).toHaveBeenCalledWith(
				expect.objectContaining({
					cookie: expect.objectContaining({
						secrets: ["test-secret-password-32-chars-min"],
					}),
				})
			);

			process.env.WORKOS_COOKIE_PASSWORD = originalEnv;
		});
	});

	describe("getUserSession", () => {
		it("should return null when session has no accessToken", async () => {
			mockSession.has.mockReturnValue(false);

			const mockStorage = {
				getSession: vi.fn().mockResolvedValue(mockSession),
				commitSession: vi.fn(),
				destroySession: vi.fn(),
			};

			vi.mocked(createWorkersKVSessionStorage).mockReturnValue(mockStorage as any);

			const request = new Request("http://localhost", {
				headers: { Cookie: "workos_session=abc123" },
			});

			const result = await getUserSession(request, mockKV);

			expect(result).toBeNull();
			expect(mockStorage.getSession).toHaveBeenCalledWith("workos_session=abc123");
			expect(mockSession.has).toHaveBeenCalledWith("accessToken");
		});

		it("should return session data when valid session exists", async () => {
			const sessionData: SessionData = {
				accessToken: "mock_access_token",
				refreshToken: "mock_refresh_token",
				user: {
					id: "user_123",
					email: "test@example.com",
					emailVerified: true,
					firstName: "John",
					lastName: "Doe",
				},
			};

			mockSession.has.mockReturnValue(true);
			mockSession.get.mockImplementation((key: string) => {
				if (key === "accessToken") return sessionData.accessToken;
				if (key === "refreshToken") return sessionData.refreshToken;
				if (key === "user") return sessionData.user;
				return undefined;
			});

			const mockStorage = {
				getSession: vi.fn().mockResolvedValue(mockSession),
				commitSession: vi.fn(),
				destroySession: vi.fn(),
			};

			vi.mocked(createWorkersKVSessionStorage).mockReturnValue(mockStorage as any);

			const request = new Request("http://localhost", {
				headers: { Cookie: "workos_session=abc123" },
			});

			const result = await getUserSession(request, mockKV);

			expect(result).toEqual(sessionData);
			expect(mockSession.has).toHaveBeenCalledWith("accessToken");
			expect(mockSession.get).toHaveBeenCalledWith("accessToken");
			expect(mockSession.get).toHaveBeenCalledWith("refreshToken");
			expect(mockSession.get).toHaveBeenCalledWith("user");
		});

		it("should handle request with no cookie header", async () => {
			mockSession.has.mockReturnValue(false);

			const mockStorage = {
				getSession: vi.fn().mockResolvedValue(mockSession),
				commitSession: vi.fn(),
				destroySession: vi.fn(),
			};

			vi.mocked(createWorkersKVSessionStorage).mockReturnValue(mockStorage as any);

			const request = new Request("http://localhost");

			const result = await getUserSession(request, mockKV);

			expect(result).toBeNull();
			expect(mockStorage.getSession).toHaveBeenCalledWith(null);
		});
	});

	describe("session lifecycle", () => {
		it("should support commit and destroy operations", async () => {
			const mockStorage = {
				getSession: vi.fn().mockResolvedValue(mockSession),
				commitSession: vi.fn().mockResolvedValue("Set-Cookie: session=xyz"),
				destroySession: vi.fn().mockResolvedValue("Set-Cookie: session=; Max-Age=0"),
			};

			vi.mocked(createWorkersKVSessionStorage).mockReturnValue(mockStorage as any);

			const { getSession, commitSession, destroySession } = createSessionStorage(mockKV);

			const request = new Request("http://localhost", {
				headers: { Cookie: "workos_session=abc123" },
			});

			// Get session
			const session = await getSession(request.headers.get("Cookie"));
			expect(session).toBe(mockSession);

			// Commit session
			const commitCookie = await commitSession(session);
			expect(commitCookie).toBe("Set-Cookie: session=xyz");

			// Destroy session
			const destroyCookie = await destroySession(session);
			expect(destroyCookie).toBe("Set-Cookie: session=; Max-Age=0");
		});
	});
});
