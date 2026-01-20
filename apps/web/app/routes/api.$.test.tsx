import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authModule from "../lib/auth.server";
import * as sessionModule from "../lib/session.server";
import * as utilsModule from "../lib/utils.server";
import { action, loader } from "./api.$";

// Mock modules
vi.mock("../lib/session.server");
vi.mock("../lib/utils.server");
vi.mock("../lib/auth.server");

describe("API Proxy Route", () => {
	const mockKV = {} as KVNamespace;
	const mockEnv = {
		SESSION_KV: mockKV,
		API_URL: "http://localhost:3000",
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("loader (GET requests)", () => {
		it("should redirect to /login when no session exists", async () => {
			// Arrange
			vi.mocked(sessionModule.getUserSession).mockResolvedValue(null);

			const request = new Request("http://localhost:5173/api/ledgers");
			const params = { "*": "ledgers" };
			const context = { cloudflare: { env: mockEnv } };

			// Act & Assert
			await expect(loader({ request, params, context } as any)).rejects.toThrow();
		});

		it("should forward GET request with valid token", async () => {
			// Arrange
			const mockSession = {
				accessToken: "valid_token",
				refreshToken: "refresh_token",
				user: { id: "user_123", email: "test@example.com", emailVerified: true },
			};

			vi.mocked(sessionModule.getUserSession).mockResolvedValue(mockSession);
			vi.mocked(utilsModule.isTokenExpired).mockReturnValue(false);

			const mockBackendResponse = new Response(JSON.stringify({ ledgers: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});

			global.fetch = vi.fn().mockResolvedValue(mockBackendResponse);

			const request = new Request("http://localhost:5173/api/ledgers?page=1");
			const params = { "*": "ledgers" };
			const context = { cloudflare: { env: mockEnv } };

			// Act
			const response = await loader({ request, params, context } as any);

			// Assert
			expect(global.fetch).toHaveBeenCalledWith(
				"http://localhost:3000/ledgers?page=1",
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						Authorization: "Bearer valid_token",
					}),
				})
			);
			expect(response.status).toBe(200);
		});

		it("should refresh token when expired and forward request", async () => {
			// Arrange
			const mockSession = {
				accessToken: "expired_token",
				refreshToken: "refresh_token",
				user: { id: "user_123", email: "test@example.com", emailVerified: true },
			};

			const mockRefreshedAuth = {
				accessToken: "new_token",
				refreshToken: "new_refresh_token",
				user: mockSession.user,
			};

			const mockSessionObj = {
				set: vi.fn(),
			};

			vi.mocked(sessionModule.getUserSession).mockResolvedValue(mockSession);
			vi.mocked(utilsModule.isTokenExpired).mockReturnValue(true);
			vi.mocked(authModule.refreshAccessToken).mockResolvedValue(mockRefreshedAuth);
			vi.mocked(sessionModule.createSessionStorage).mockReturnValue({
				getSession: vi.fn().mockResolvedValue(mockSessionObj),
				commitSession: vi.fn().mockResolvedValue("updated-cookie"),
			} as any);

			const mockBackendResponse = new Response(JSON.stringify({ ledgers: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});

			global.fetch = vi.fn().mockResolvedValue(mockBackendResponse);

			const request = new Request("http://localhost:5173/api/ledgers");
			const params = { "*": "ledgers" };
			const context = { cloudflare: { env: mockEnv } };

			// Act
			const response = await loader({ request, params, context } as any);

			// Assert
			expect(authModule.refreshAccessToken).toHaveBeenCalledWith("refresh_token");
			expect(global.fetch).toHaveBeenCalledWith(
				"http://localhost:3000/ledgers",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer new_token",
					}),
				})
			);
			expect(response.status).toBe(200);
		});

		it("should redirect to /login on 401 response from backend", async () => {
			// Arrange
			const mockSession = {
				accessToken: "valid_token",
				refreshToken: "refresh_token",
				user: { id: "user_123", email: "test@example.com", emailVerified: true },
			};

			vi.mocked(sessionModule.getUserSession).mockResolvedValue(mockSession);
			vi.mocked(utilsModule.isTokenExpired).mockReturnValue(false);

			const mockBackendResponse = new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
			});

			global.fetch = vi.fn().mockResolvedValue(mockBackendResponse);

			const request = new Request("http://localhost:5173/api/ledgers");
			const params = { "*": "ledgers" };
			const context = { cloudflare: { env: mockEnv } };

			// Act & Assert
			await expect(loader({ request, params, context } as any)).rejects.toThrow();
		});

		it("should preserve query parameters when forwarding", async () => {
			// Arrange
			const mockSession = {
				accessToken: "valid_token",
				refreshToken: "refresh_token",
				user: { id: "user_123", email: "test@example.com", emailVerified: true },
			};

			vi.mocked(sessionModule.getUserSession).mockResolvedValue(mockSession);
			vi.mocked(utilsModule.isTokenExpired).mockReturnValue(false);

			const mockBackendResponse = new Response(JSON.stringify({ data: [] }), {
				status: 200,
			});

			global.fetch = vi.fn().mockResolvedValue(mockBackendResponse);

			const request = new Request("http://localhost:5173/api/ledgers?page=2&limit=50");
			const params = { "*": "ledgers" };
			const context = { cloudflare: { env: mockEnv } };

			// Act
			await loader({ request, params, context } as any);

			// Assert
			expect(global.fetch).toHaveBeenCalledWith(
				"http://localhost:3000/ledgers?page=2&limit=50",
				expect.any(Object)
			);
		});
	});

	describe("action (POST/PUT/DELETE requests)", () => {
		it("should forward POST request with body", async () => {
			// Arrange
			const mockSession = {
				accessToken: "valid_token",
				refreshToken: "refresh_token",
				user: { id: "user_123", email: "test@example.com", emailVerified: true },
			};

			vi.mocked(sessionModule.getUserSession).mockResolvedValue(mockSession);
			vi.mocked(utilsModule.isTokenExpired).mockReturnValue(false);

			const mockBackendResponse = new Response(JSON.stringify({ id: "ledger_123" }), { status: 201 });

			global.fetch = vi.fn().mockResolvedValue(mockBackendResponse);

			const requestBody = JSON.stringify({ name: "New Ledger" });
			const request = new Request("http://localhost:5173/api/ledgers", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: requestBody,
			});
			const params = { "*": "ledgers" };
			const context = { cloudflare: { env: mockEnv } };

			// Act
			const response = await action({ request, params, context } as any);

			// Assert
			const fetchCall = vi.mocked(global.fetch).mock.calls[0];
			expect(fetchCall[0]).toBe("http://localhost:3000/ledgers");
			expect(fetchCall[1]).toMatchObject({
				method: "POST",
				body: requestBody,
			});
			expect(fetchCall[1]?.headers).toHaveProperty("Authorization", "Bearer valid_token");
			// Header keys are lowercase when copied from Request
			expect(fetchCall[1]?.headers).toHaveProperty("content-type", "application/json");
			expect(response.status).toBe(201);
		});

		it("should forward PUT request", async () => {
			// Arrange
			const mockSession = {
				accessToken: "valid_token",
				refreshToken: "refresh_token",
				user: { id: "user_123", email: "test@example.com", emailVerified: true },
			};

			vi.mocked(sessionModule.getUserSession).mockResolvedValue(mockSession);
			vi.mocked(utilsModule.isTokenExpired).mockReturnValue(false);

			const mockBackendResponse = new Response(JSON.stringify({ id: "ledger_123" }), { status: 200 });

			global.fetch = vi.fn().mockResolvedValue(mockBackendResponse);

			const requestBody = JSON.stringify({ name: "Updated Ledger" });
			const request = new Request("http://localhost:5173/api/ledgers/ledger_123", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: requestBody,
			});
			const params = { "*": "ledgers/ledger_123" };
			const context = { cloudflare: { env: mockEnv } };

			// Act
			const response = await action({ request, params, context } as any);

			// Assert
			expect(global.fetch).toHaveBeenCalledWith(
				"http://localhost:3000/ledgers/ledger_123",
				expect.objectContaining({
					method: "PUT",
					body: requestBody,
				})
			);
			expect(response.status).toBe(200);
		});

		it("should forward DELETE request", async () => {
			// Arrange
			const mockSession = {
				accessToken: "valid_token",
				refreshToken: "refresh_token",
				user: { id: "user_123", email: "test@example.com", emailVerified: true },
			};

			vi.mocked(sessionModule.getUserSession).mockResolvedValue(mockSession);
			vi.mocked(utilsModule.isTokenExpired).mockReturnValue(false);

			const mockBackendResponse = new Response(null, { status: 204 });

			global.fetch = vi.fn().mockResolvedValue(mockBackendResponse);

			const request = new Request("http://localhost:5173/api/ledgers/ledger_123", {
				method: "DELETE",
			});
			const params = { "*": "ledgers/ledger_123" };
			const context = { cloudflare: { env: mockEnv } };

			// Act
			const response = await action({ request, params, context } as any);

			// Assert
			expect(global.fetch).toHaveBeenCalledWith(
				"http://localhost:3000/ledgers/ledger_123",
				expect.objectContaining({
					method: "DELETE",
				})
			);
			expect(response.status).toBe(204);
		});
	});
});
