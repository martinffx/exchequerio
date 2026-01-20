import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock session server
vi.mock("@/lib/session.server", () => ({
	getUserSession: vi.fn(),
	createSessionStorage: vi.fn(),
}));

// Import after mocking
import * as sessionServer from "@/lib/session.server";
import { loader } from "./home";

describe("Home Route (Protected Route Pattern)", () => {
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

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("loader", () => {
		it("should redirect to /login if user is not authenticated", async () => {
			// Arrange
			const request = new Request("http://localhost/home");
			vi.mocked(sessionServer.getUserSession).mockResolvedValue(null);

			// Act & Assert - redirect() throws a Response object
			try {
				await loader({ request, context: mockContext, params: {} });
				expect.fail("Should have thrown a redirect");
			} catch (error) {
				// Verify it's a Response (redirect)
				expect(error).toBeInstanceOf(Response);
				const response = error as Response;
				expect(response.status).toBe(302);
				expect(response.headers.get("Location")).toBe("/login");
			}
		});

		it("should return user data if user is authenticated", async () => {
			// Arrange
			const request = new Request("http://localhost/home");
			const mockSession = {
				accessToken: "token",
				refreshToken: "refresh",
				user: {
					id: "user_123",
					email: "test@example.com",
					emailVerified: true,
				},
			};
			vi.mocked(sessionServer.getUserSession).mockResolvedValue(mockSession);

			// Act
			const result = await loader({ request, context: mockContext, params: {} });

			// Assert
			expect(result).toEqual({
				user: mockSession.user,
			});
		});
	});
});
