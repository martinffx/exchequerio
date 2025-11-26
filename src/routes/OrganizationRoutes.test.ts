import type { FastifyInstance } from "fastify"
import { sighJWT } from "@/auth"
import { ConflictError, NotFoundError } from "@/errors"

import { buildServer } from "@/server"
import type { OrganizationService } from "@/services/OrganizationService"
import { createOrganizationFixture } from "./ledgers/fixtures"

const mockOryService = jest.mocked<OrganizationService>({
	createOrganization: jest.fn(),
	getOrganization: jest.fn(),
	updateOrganization: jest.fn(),
	deleteOrganization: jest.fn(),
	listOrganizations: jest.fn(),
} as unknown as OrganizationService)

jest.mock("@/services/OrganizationService", () => {
	const actual = jest.requireActual("@/services/OrganizationService")
	return {
		__esModule: true,
		...actual,
		OrganizationService: jest.fn().mockImplementation(() => mockOryService), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
	}
})

describe("OrganizationRoutes", () => {
	let server: FastifyInstance
	const mockOrg = createOrganizationFixture()

	beforeEach(async () => {
		jest.clearAllMocks()
		server = await buildServer()
	})

	describe("List Organizations", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		})

		it("should return a list of organizations", async () => {
			mockOryService.listOrganizations.mockResolvedValue([mockOrg])
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
			})
			console.log("response", rs.json())

			expect(rs.statusCode).toBe(200)
			expect(rs.json()).toEqual([mockOrg.toResponse()])
		})

		it("should return a list of organizations with pagination", async () => {
			mockOryService.listOrganizations.mockImplementation((offset, limit) => {
				expect(offset).toBe(0)
				expect(limit).toBe(20)
				return Promise.resolve([mockOrg])
			})
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations?offset=10&limit=20",
			})
			expect(rs.statusCode).toBe(200)
			expect(rs.json()).toEqual([mockOrg.toResponse()])
		})

		it("should handle internal server error", async () => {
			mockOryService.listOrganizations.mockResolvedValue([mockOrg])
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
			})
			expect(rs.statusCode).toBe(500)
			const response = rs.json()
			expect(response.status).toEqual(500)
			expect(response.detail).toEqual("Internal Server Error")
		})

		it("should handle bad request error", async () => {
			mockOryService.listOrganizations.mockResolvedValue([mockOrg])
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations?offset=invalid&limit=invalid",
			})
			expect(rs.statusCode).toBe(400)
			const response = rs.json()
			expect(response.status).toEqual(400)
			expect(response.detail).toEqual("querystring/offset must be number")
		})

		it("should handle unauthorized request error", async () => {
			mockOryService.listOrganizations.mockResolvedValue([mockOrg])
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: "Bearer token",
				},
				url: "/api/organizations?offset=10&limit=10",
			})
			expect(rs.statusCode).toBe(401)
			const response = rs.json()
			expect(response.status).toEqual(401)
			expect(response.detail).toEqual("Invalid token")
		})

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			})
			mockOryService.listOrganizations.mockResolvedValue([mockOrg])
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: "/api/organizations?offset=10&limit=10",
			})
			expect(rs.statusCode).toBe(403)
			const response = rs.json()
			expect(response.status).toEqual(403)
			expect(response.detail).toEqual(
				"One of: my:organization:read,organization:read; permissions is required"
			)
		})
	})

	describe("Get Organization", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		})

		it("should return a organization", async () => {
			mockOryService.getOrganization.mockImplementation(_id => {
				expect(id).toBe(mockOrg.id.toString())
				return Promise.resolve(mockOrg)
			})
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(200)
			expect(rs.json()).toEqual(mockOrg.toResponse())
		})

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/lgr_${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(400)
			const response = rs.json()
			expect(response.status).toEqual(400)
			expect(response.detail).toEqual('params/orgId must match pattern "^org_[0-9a-z]{26}$"')
		})

		it("should handle unauthorized request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: "Bearer token",
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(401)
			const response = rs.json()
			expect(response.status).toEqual(401)
			expect(response.detail).toEqual("Invalid token")
		})

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			})
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(403)
			const response = rs.json()
			expect(response.status).toEqual(403)
			expect(response.detail).toEqual(
				"One of: my:organization:read,organization:read; permissions is required"
			)
		})

		it("should handle not found error", async () => {
			mockOryService.getOrganization.mockImplementation(_id => {
				throw new NotFoundError(`Organization ${id} not found`)
			})
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(404)
			const response = rs.json()
			expect(response.status).toEqual(404)
			expect(response.detail).toEqual(`Organization ${mockOrg.id.toString()} not found`)
		})

		it("should handle internal server error", async () => {
			mockOryService.getOrganization.mockImplementation(_id => {
				throw new Error("Internal Server Error")
			})
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(500)
			const body = rs.json()
			expect(body.status).toEqual(500)
			expect(body.detail).toEqual("Internal Server Error")
		})
	})

	describe("Create Organization", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		})

		it("should create a organization", async () => {
			mockOryService.createOrganization.mockImplementation(_org => {
				expect(org.name).toBe("test")
				return Promise.resolve(mockOrg)
			})
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
				payload: {
					name: "test",
				},
			})
			expect(rs.statusCode).toBe(200)
			expect(rs.json()).toEqual(mockOrg.toResponse())
		})

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
			})
			expect(rs.statusCode).toBe(400)
			const response = rs.json()
			expect(response.status).toEqual(400)
			expect(response.detail).toEqual("body must have required property 'name'")
		})

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
			})
			expect(rs.statusCode).toBe(401)
			const response = rs.json()
			expect(response.status).toEqual(401)
			expect(response.detail).toEqual("Invalid token")
		})

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			})
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: "/api/organizations",
				payload: {
					name: "test",
				},
			})
			expect(rs.statusCode).toBe(403)
			const response = rs.json()
			expect(response.status).toEqual(403)
			expect(response.detail).toEqual(
				"One of: my:organization:write,organization:write; permissions is required"
			)
		})

		it("should handle a conflict error", async () => {
			mockOryService.createOrganization.mockImplementation(_org => {
				throw new ConflictError("Organization already exists")
			})
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
				payload: {
					name: "test",
				},
			})
			expect(rs.statusCode).toBe(409)
			const response = rs.json()
			expect(response.status).toEqual(409)
			expect(response.detail).toEqual("Organization already exists")
		})

		it("should handle internal server error", async () => {
			mockOryService.createOrganization.mockImplementation(_org => {
				throw new Error("Internal Server Error")
			})
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/organizations",
				payload: {
					name: "test",
				},
			})
			expect(rs.statusCode).toBe(500)
			const body = rs.json()
			expect(body.status).toEqual(500)
			expect(body.detail).toEqual("Internal Server Error")
		})
	})

	describe("Update Organization", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		})

		it("should update a organization", async () => {
			mockOryService.updateOrganization.mockImplementation((_id, _org) => {
				expect(id).toBe(mockOrg.id.toString())
				expect(org.name).toBe("test")
				return Promise.resolve(mockOrg)
			})
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			})
			expect(rs.statusCode).toBe(200)
			expect(rs.json()).toEqual(mockOrg.toResponse())
		})

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
			})
			expect(rs.statusCode).toBe(400)
			const response = rs.json()
			expect(response.status).toEqual(400)
			expect(response.detail).toEqual('params/orgId must match pattern "^org_[0-9a-z]{26}$"')
		})

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
			})
			expect(rs.statusCode).toBe(401)
			const response = rs.json()
			expect(response.status).toEqual(401)
			expect(response.detail).toEqual("Invalid token")
		})

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_admin"],
			})
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			})
			expect(rs.statusCode).toBe(403)
			const response = rs.json()
			expect(response.status).toEqual(403)
			expect(response.detail).toEqual(
				"One of: my:organization:write,organization:write; permissions is required"
			)
		})

		it("should handle not found error", async () => {
			mockOryService.updateOrganization.mockImplementation((_id, _org) => {
				throw new NotFoundError("Organization not found")
			})
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			})
			expect(rs.statusCode).toBe(404)
			const response = rs.json()
			expect(response.status).toEqual(404)
			expect(response.detail).toEqual("Organization not found")
		})

		it("should handle a conflict error", async () => {
			mockOryService.updateOrganization.mockImplementation((_id, _org) => {
				throw new ConflictError("Organization already exists")
			})
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			})
			expect(rs.statusCode).toBe(409)
			const response = rs.json()
			expect(response.status).toEqual(409)
			expect(response.detail).toEqual("Organization already exists")
		})

		it("should handle internal server error", async () => {
			mockOryService.updateOrganization.mockImplementation((_id, _org) => {
				throw new Error("Internal Server Error")
			})
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
				body: {
					name: "test",
				},
			})
			expect(rs.statusCode).toBe(500)
			const body = rs.json()
			expect(body.status).toEqual(500)
			expect(body.detail).toEqual("Internal Server Error")
		})
	})

	describe("Delete Organization", () => {
		const token = sighJWT({
			sub: mockOrg.id.toString(),
			scope: ["super_admin"],
		})

		it("should delete a organization", async () => {
			mockOryService.deleteOrganization.mockImplementation(_id => {
				expect(id).toBe(mockOrg.id.toString())
				return Promise.resolve()
			})
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(200)
		})

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/lgr_${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(400)
			const response = rs.json()
			expect(response.status).toEqual(400)
			expect(response.detail).toEqual('params/orgId must match pattern "^org_[0-9a-z]{26}$"')
		})

		it("should handle unauthorized request error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: "Bearer token",
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(401)
			const response = rs.json()
			expect(response.status).toEqual(401)
			expect(response.detail).toEqual("Invalid token")
		})

		it("should handle forbidden request error", async () => {
			const orgAdmin = sighJWT({
				sub: mockOrg.id.toString(),
				scope: ["org_user"],
			})
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${orgAdmin}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(403)
			const response = rs.json()
			expect(response.status).toEqual(403)
			expect(response.detail).toEqual(
				"One of: my:organization:delete,organization:delete; permissions is required"
			)
		})

		it("should handle not found error", async () => {
			mockOryService.deleteOrganization.mockImplementation(_id => {
				throw new NotFoundError("Organization not found")
			})
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(404)
			const response = rs.json()
			expect(response.status).toEqual(404)
			expect(response.detail).toEqual("Organization not found")
		})

		it("should handle a conflict error", async () => {
			mockOryService.deleteOrganization.mockImplementation(_id => {
				throw new ConflictError("Organization already exists")
			})
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			expect(rs.statusCode).toBe(409)
			const response = rs.json()
			expect(response.status).toEqual(409)
			expect(response.detail).toEqual("Organization already exists")
		})

		it("should handle internal server error", async () => {
			mockOryService.deleteOrganization.mockImplementation(_id => {
				throw new Error("Internal Server Error")
			})
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/organizations/${mockOrg.id.toString()}`,
			})
			const body = rs.json()
			console.log("body", body)

			expect(rs.statusCode).toBe(500)
			expect(body.status).toEqual(500)
			expect(body.detail).toEqual("Internal Server Error")
		})
	})
})
