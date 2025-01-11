import type { OrganizationRepo } from "@/repo/OrganizationRepo";
import { buildServer } from "@/server";
import { sighJWT } from "@/auth";
import type { FastifyInstance } from "fastify";
import { createOrganizationFixture } from "./ledgers/fixtures";
import type { OrganizationService } from "@/services/OrganizationService";
import { ConflictError, NotFoundError } from "@/errors";

const mockOryService = jest.mocked<OrganizationService>({
	createOrganization: jest.fn(),
	getOrganization: jest.fn(),
	updateOrganization: jest.fn(),
	deleteOrganization: jest.fn(),
	listOrganizations: jest.fn(),
} as unknown as OrganizationService);

jest.mock("@/services/OrganizationService", () => {
	const actual = jest.requireActual("@/services/OrganizationService");
	return {
		__esModule: true,
		...actual,
		OrganizationService: jest.fn().mockImplementation(() => mockOryService),
	};
});

describe("OrganizationRoutes", () => {
	let server: FastifyInstance;
	const mockOrg = createOrganizationFixture();

	beforeEach(async () => {
		jest.clearAllMocks();
		server = await buildServer();
	});

	describe("List Organizations", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should return a list of organizations", async () => {
			mockOryService.listOrganizations.mockImplementation(
				async (offset, limit) => {
					expect(offset).toBe(0);
					expect(limit).toBe(20);
					return [mockOrg];
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
			});
			console.log("response", rs.json());

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([mockOrg.toResponse()]);
		});

		it("should return a list of organizations with pagination", async () => {
			mockOryService.listOrganizations.mockImplementation(
				async (offset, limit) => {
					expect(offset).toBe(10);
					expect(limit).toBe(20);
					return [mockOrg];
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations?offset=10&limit=20",
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([mockOrg.toResponse()]);
		});

		it("should handle internal server error", async () => {
			mockOryService.listOrganizations.mockImplementation(
				async (offset, limit) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
			});
			expect(rs.statusCode).toBe(500);
			expect(rs.json().status).toEqual(500);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle bad request error", async () => {
			mockOryService.listOrganizations.mockImplementation(
				async (offset, limit) => {
					return [mockOrg];
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations?offset=invalid&limit=invalid",
			});
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("querystring/offset must be number");
		});

		it("should handle unauthorized request error", async () => {
			mockOryService.listOrganizations.mockImplementation(
				async (offset, limit) => {
					return [mockOrg];
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: "Bearer token",
				},
				url: "/api/organizations?offset=10&limit=10",
			});
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Invalid token");
		});

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			});
			mockOryService.listOrganizations.mockImplementation(
				async (offset, limit) => {
					return [mockOrg];
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: "/api/organizations?offset=10&limit=10",
			});
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual(
				"One of: my:organization:read,organization:read; permissions is required",
			);
		});
	});

	describe("Get Organization", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should return a organization", async () => {
			mockOryService.getOrganization.mockImplementation(async (id) => {
				expect(id).toBe(mockOrg.id.toString());
				return mockOrg;
			});
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(mockOrg.toResponse());
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/lgr_${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("params/orgId must match pattern \"^org_[0-9a-z]{26}$\"");
		});

		it("should handle unauthorized request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: "Bearer token",
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Invalid token");
		});

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			});
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual(
				"One of: my:organization:read,organization:read; permissions is required",
			);
		});

		it("should handle not found error", async () => {
			mockOryService.getOrganization.mockImplementation(async (id) => {
				throw new NotFoundError(`Organization ${id} not found`);
			});
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(404);
			expect(rs.json().status).toEqual(404);
			expect(rs.json().detail).toEqual(`Organization ${mockOrg.id} not found`);
		});

		it("should handle internal server error", async () => {
			mockOryService.getOrganization.mockImplementation(async (id) => {
				throw new Error("Internal Server Error");
			});
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(500);
			const body = rs.json();
			expect(body.status).toEqual(500);
			expect(body.detail).toEqual("Internal Server Error");
		});
	});

	describe("Create Organization", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should create a organization", async () => {
			mockOryService.createOrganization.mockImplementation(async (org) => {
				expect(org.name).toBe("test");
				return mockOrg;
			});
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(mockOrg.toResponse());
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
				body: {
					foo: "bar",
				},
			});
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("body must have required property 'name'");
		});

		it("should handle unauthorized request error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: "Bearer token",
				},
				url: "/api/organizations",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Invalid token");
		});

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			});
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: "/api/organizations",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual(
				"One of: my:organization:write,organization:write; permissions is required",
			);
		});

		it("should handle a conflict error", async () => {
			mockOryService.createOrganization.mockImplementation(async (org) => {
				throw new ConflictError("Organization already exists");
			});
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(409);
			expect(rs.json().status).toEqual(409);
			expect(rs.json().detail).toEqual("Organization already exists");
		});

		it("should handle internal server error", async () => {
			mockOryService.createOrganization.mockImplementation(async (org) => {
				throw new Error("Internal Server Error");
			});
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(500);
			const body = rs.json();
			expect(body.status).toEqual(500);
			expect(body.detail).toEqual("Internal Server Error");
		});
	});

	describe("Update Organization", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should update a organization", async () => {
			mockOryService.updateOrganization.mockImplementation(async (id, org) => {
				expect(id).toBe(mockOrg.id.toString());
				expect(org.name).toBe("test");
				return mockOrg;
			});
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(mockOrg.toResponse());
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/lgr_${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("params/orgId must match pattern \"^org_[0-9a-z]{26}$\"");
		});

		it("should handle unauthorized request error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: "Bearer token",
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Invalid token");
		});

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			});
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual(
				"One of: my:organization:write,organization:write; permissions is required",
			);
		});

		it("should handle not found error", async () => {
			mockOryService.updateOrganization.mockImplementation(async (id, org) => {
				throw new NotFoundError("Organization not found");
			});
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(404);
			expect(rs.json().status).toEqual(404);
			expect(rs.json().detail).toEqual("Organization not found");
		});

		it("should handle a conflict error", async () => {
			mockOryService.updateOrganization.mockImplementation(async (id, org) => {
				throw new ConflictError("Organization already exists");
			});
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(409);
			expect(rs.json().status).toEqual(409);
			expect(rs.json().detail).toEqual("Organization already exists");
		});

		it("should handle internal server error", async () => {
			mockOryService.updateOrganization.mockImplementation(async (id, org) => {
				throw new Error("Internal Server Error");
			});
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(500);
			const body = rs.json();
			expect(body.status).toEqual(500);
			expect(body.detail).toEqual("Internal Server Error");
		});
	});

	describe("Delete Organization", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should delete a organization", async () => {
			mockOryService.deleteOrganization.mockImplementation(async (id) => {
				expect(id).toBe(mockOrg.id.toString());
				return;
			});
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(200);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/lgr_${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("params/orgId must match pattern \"^org_[0-9a-z]{26}$\"");
		});

		it("should handle unauthorized request error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: "Bearer token",
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Invalid token");
		});

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_user"],
			});
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual(
				"One of: my:organization:delete,organization:delete; permissions is required",
			);
		});

		it("should handle not found error", async () => {
			mockOryService.deleteOrganization.mockImplementation(async (id) => {
				throw new NotFoundError("Organization not found");
			});
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(404);
			expect(rs.json().status).toEqual(404);
			expect(rs.json().detail).toEqual("Organization not found");
		});

		it("should handle a conflict error", async () => {
			mockOryService.deleteOrganization.mockImplementation(async (id) => {
				throw new ConflictError("Organization already exists");
			});
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(409);
			expect(rs.json().status).toEqual(409);
			expect(rs.json().detail).toEqual("Organization already exists");
		});

		it("should handle internal server error", async () => {
			mockOryService.deleteOrganization.mockImplementation(async (id) => {
				throw new Error("Internal Server Error");
			});
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			const body = rs.json();
			console.log("body", body);

			expect(rs.statusCode).toBe(500);
			expect(body.status).toEqual(500);
			expect(body.detail).toEqual("Internal Server Error");
		});
	});
});
