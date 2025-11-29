import type { FastifyInstance } from "fastify";
import { vi } from "vitest";
import { signJWT } from "@/auth";
import { ConflictError, NotFoundError } from "@/errors";

import { buildServer } from "@/server";
import type { OrganizationService } from "@/services/OrganizationService";
import { createOrganizationFixture } from "./ledgers/fixtures";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "./schema";

const mockOrganizationService = vi.mocked<OrganizationService>({
	createOrganization: vi.fn(),
	getOrganization: vi.fn(),
	updateOrganization: vi.fn(),
	deleteOrganization: vi.fn(),
	listOrganizations: vi.fn(),
} as unknown as OrganizationService);

describe("OrganizationRoutes", () => {
	let server: FastifyInstance;
	const mockOrg = createOrganizationFixture();

	beforeAll(async () => {
		server = await buildServer({
			servicePluginOpts: {
				services: { organizationService: mockOrganizationService },
			},
		});
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("List Organizations", () => {
		const token = signJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should return a list of organizations", async () => {
			mockOrganizationService.listOrganizations.mockResolvedValue([mockOrg]);

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([mockOrg.toResponse()]);
			expect(mockOrganizationService.listOrganizations).toHaveBeenCalledWith();
		});

		it("should return a list of organizations with pagination", async () => {
			mockOrganizationService.listOrganizations.mockImplementation(async () => {
				return [mockOrg];
			});
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
			mockOrganizationService.listOrganizations.mockImplementation(async () => {
				throw new Error("Internal Server Error");
			});
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
			});
			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
			expect(response.detail).toEqual("Internal Server Error");
		});

		it("should handle bad request error", async () => {
			mockOrganizationService.listOrganizations.mockResolvedValue([mockOrg]);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations?offset=invalid&limit=invalid",
			});
			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toEqual("querystring/offset must be number");
		});

		it("should handle unauthorized request error", async () => {
			mockOrganizationService.listOrganizations.mockResolvedValue([mockOrg]);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: "Bearer token",
				},
				url: "/api/organizations?offset=10&limit=10",
			});
			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toEqual("Invalid token");
		});

		it("should handle forbidden request error", async () => {
			const orgAdmin = signJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			});
			mockOrganizationService.listOrganizations.mockResolvedValue([mockOrg]);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: "/api/organizations?offset=10&limit=10",
			});
			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
			expect(response.detail).toEqual(
				"One of: my:organization:read,organization:read; permissions is required"
			);
		});
	});

	describe("Get Organization", () => {
		const token = signJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should return a organization", async () => {
			mockOrganizationService.getOrganization.mockImplementation(async () => mockOrg);
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
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toEqual('params/orgId must match pattern "^org_[0-9a-z]{26}$"');
		});

		it("should handle not found error", async () => {
			mockOrganizationService.getOrganization.mockImplementation(async () => {
				throw new NotFoundError(`Organization ${mockOrg.id.toString()} not found`);
			});
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
			expect(response.detail).toEqual(`Organization ${mockOrg.id.toString()} not found`);
		});

		it("should handle internal server error", async () => {
			mockOrganizationService.getOrganization.mockImplementation(async () => {
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
			const body: InternalServerErrorResponse = rs.json();
			expect(body.status).toEqual(500);
			expect(body.detail).toEqual("Internal Server Error");
		});
	});

	describe("Create Organization", () => {
		const token = signJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should create a organization", async () => {
			mockOrganizationService.createOrganization.mockImplementation(async () => mockOrg);
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
				payload: {
					foo: "bar",
				},
			});
			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toEqual("body must have required property 'name'");
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
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toEqual("Invalid token");
		});

		it("should handle forbidden request error", async () => {
			const orgAdmin = signJWT({
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
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
			expect(response.detail).toEqual(
				"One of: my:organization:write,organization:write; permissions is required"
			);
		});

		it("should handle a conflict error", async () => {
			mockOrganizationService.createOrganization.mockImplementation(async () => {
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
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
			expect(response.detail).toEqual("Organization already exists");
		});

		it("should handle internal server error", async () => {
			mockOrganizationService.createOrganization.mockImplementation(async () => {
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
			const body: InternalServerErrorResponse = rs.json();
			expect(body.status).toEqual(500);
			expect(body.detail).toEqual("Internal Server Error");
		});
	});

	describe("Update Organization", () => {
		const token = signJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should update a organization", async () => {
			mockOrganizationService.updateOrganization.mockImplementation(async () => mockOrg);
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				payload: {
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
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toEqual('params/orgId must match pattern "^org_[0-9a-z]{26}$"');
		});

		it("should handle unauthorized request error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: "Bearer token",
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toEqual("Invalid token");
		});

		it("should handle forbidden request error", async () => {
			const orgAdmin = signJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			});
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
			expect(response.detail).toEqual(
				"One of: my:organization:write,organization:write; permissions is required"
			);
		});

		it("should handle not found error", async () => {
			mockOrganizationService.updateOrganization.mockImplementation(async () => {
				throw new NotFoundError("Organization not found");
			});
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
			expect(response.detail).toEqual("Organization not found");
		});

		it("should handle a conflict error", async () => {
			mockOrganizationService.updateOrganization.mockImplementation(async () => {
				throw new ConflictError("Organization already exists");
			});
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
			expect(response.detail).toEqual("Organization already exists");
		});

		it("should handle internal server error", async () => {
			mockOrganizationService.updateOrganization.mockImplementation(async () => {
				throw new Error("Internal Server Error");
			});
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(500);
			const body: InternalServerErrorResponse = rs.json();
			expect(body.status).toEqual(500);
			expect(body.detail).toEqual("Internal Server Error");
		});
	});

	describe("Delete Organization", () => {
		const token = signJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		});

		it("should delete a organization", async () => {
			mockOrganizationService.deleteOrganization.mockImplementation(async () => Promise.resolve());
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
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toEqual('params/orgId must match pattern "^org_[0-9a-z]{26}$"');
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
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toEqual("Invalid token");
		});

		it("should handle forbidden request error", async () => {
			const orgAdmin = signJWT({
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
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
			expect(response.detail).toEqual(
				"One of: my:organization:delete,organization:delete; permissions is required"
			);
		});

		it("should handle not found error", async () => {
			mockOrganizationService.deleteOrganization.mockImplementation(async () => {
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
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
			expect(response.detail).toEqual("Organization not found");
		});

		it("should handle a conflict error", async () => {
			mockOrganizationService.deleteOrganization.mockImplementation(async () => {
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
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
			expect(response.detail).toEqual("Organization already exists");
		});

		it("should handle internal server error", async () => {
			mockOrganizationService.deleteOrganization.mockImplementation(async () => {
				throw new Error("Internal Server Error");
			});
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			});
			expect(rs.statusCode).toBe(500);
			const body: InternalServerErrorResponse = rs.json();
			expect(body.status).toEqual(500);
			expect(body.detail).toEqual("Internal Server Error");
		});
	});
});
