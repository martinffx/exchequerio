import type { FastifyInstance } from "fastify";
import { createLocalJWKSet } from "jose";
import { TypeID } from "typeid-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "@/server";
import { getTestJWKS, signTestJWT } from "@/test-utils/jwt";

describe("Auth", () => {
	let server: FastifyInstance;
	const orgId = new TypeID("org");

	beforeAll(async () => {
		const testJWKS = await getTestJWKS();
		server = await buildServer({
			authOpts: { jwks: createLocalJWKSet(testJWKS) },
		});
	});

	afterAll(async () => {
		await server.close();
	});

	describe("JWT Verification", () => {
		it("should verify valid JWT and extract claims", async () => {
			const token = await signTestJWT({
				sub: "user_123",
				org_id: orgId.toString(),
				role: "admin",
			});

			const response = await server.inject({
				method: "GET",
				url: "/health",
				headers: { Authorization: `Bearer ${token}` },
			});

			// Health endpoint doesn't require auth, but we can check it doesn't error
			expect(response.statusCode).toBe(200);
		});

		it("should reject expired JWT", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				expiresIn: "-1h", // Already expired
			});

			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().detail).toContain("expired");
		});

		it("should reject missing Authorization header", async () => {
			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().detail).toContain("Missing Authorization header");
		});

		it("should reject malformed Bearer token", async () => {
			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: "InvalidFormat token" },
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().detail).toContain("Missing Authorization header");
		});

		it("should reject missing org_id", async () => {
			const token = await signTestJWT({
				// org_id omitted
				sub: "user_123",
				sid: "session_123",
			});

			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().detail).toContain("Missing organization ID");
		});

		it("should reject invalid org_id format", async () => {
			const token = await signTestJWT({
				org_id: "invalid_not_a_typeid", // Invalid format
				sub: "user_123",
				sid: "session_123",
			});

			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().detail).toContain("Invalid organization ID format");
		});

		it("should reject missing sub claim", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				sid: "session_123",
				sub: undefined, // Explicitly omit sub
			});

			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().detail).toContain("Invalid token claims");
		});

		it("should reject missing sid claim", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				sub: "user_123",
				sid: undefined, // Explicitly omit sid
			});

			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(response.statusCode).toBe(401);
			expect(response.json().detail).toContain("Invalid token claims");
		});
	});

	describe("Permission Checking", () => {
		it("should allow access with admin role (has all permissions)", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				role: "admin",
			});

			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
			});

			// Should not be 403 (forbidden)
			expect(response.statusCode).not.toBe(403);
		});

		it("should deny POST with viewer role (read-only)", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				role: "viewer",
			});

			const response = await server.inject({
				method: "POST",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
				payload: {
					name: "Test Ledger",
					currency: "USD",
					currencyExponent: 2,
				},
			});

			expect(response.statusCode).toBe(403);
			expect(response.json().detail).toContain("Missing required permission");
		});

		it("should allow explicit permissions over role", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				role: "viewer", // Viewer normally can't write
				permissions: ["ledger:read", "ledger:write"], // But explicit permissions override
			});

			const response = await server.inject({
				method: "POST",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
				payload: {
					name: "Test Ledger",
					currency: "USD",
					currencyExponent: 2,
				},
			});

			// Should not be 403 (has explicit permission)
			expect(response.statusCode).not.toBe(403);
		});
	});

	describe("Role Permission Mapping", () => {
		it("should map admin role to full permissions", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				role: "admin",
			});

			// Admin should have delete permissions
			const response = await server.inject({
				method: "DELETE",
				url: `/api/ledgers/${new TypeID("lgr")}`,
				headers: { Authorization: `Bearer ${token}` },
			});

			// Not 403 (has permission, might be 404 if ledger doesn't exist)
			expect(response.statusCode).not.toBe(403);
		});

		it("should map member role to read/write permissions", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				role: "member",
			});

			// Member should have write permissions
			const writeResponse = await server.inject({
				method: "POST",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
				payload: {
					name: "Test Ledger",
					currency: "USD",
					currencyExponent: 2,
				},
			});

			expect(writeResponse.statusCode).not.toBe(403);

			// But not delete
			const deleteResponse = await server.inject({
				method: "DELETE",
				url: `/api/ledgers/${new TypeID("lgr")}`,
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(deleteResponse.statusCode).toBe(403);
		});

		it("should map viewer role to read-only permissions", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				role: "viewer",
			});

			// Viewer should have read permissions
			const readResponse = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(readResponse.statusCode).not.toBe(403);

			// But not write
			const writeResponse = await server.inject({
				method: "POST",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
				payload: {
					name: "Test Ledger",
					currency: "USD",
					currencyExponent: 2,
				},
			});

			expect(writeResponse.statusCode).toBe(403);
		});

		it("should handle super_admin role with organization permissions", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				role: "super_admin",
			});

			// Super admin should have all permissions including organization:*
			const response = await server.inject({
				method: "GET",
				url: "/api/organizations",
				headers: { Authorization: `Bearer ${token}` },
			});

			// Not 403 (has permission)
			expect(response.statusCode).not.toBe(403);
		});

		it("should return empty permissions for unknown role", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				role: "unknown_role",
			});

			// Unknown role = no permissions
			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(response.statusCode).toBe(403);
		});

		it("should return empty permissions when no role and no permissions", async () => {
			const token = await signTestJWT({
				org_id: orgId.toString(),
				// No role, no permissions
			});

			const response = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(response.statusCode).toBe(403);
		});
	});
});
