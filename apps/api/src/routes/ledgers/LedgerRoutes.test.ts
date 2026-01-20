import type { FastifyInstance } from "fastify";
import { createLocalJWKSet } from "jose";
import { vi } from "vitest";
import { ConflictError, NotFoundError } from "@/errors";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "@/routes/schema";
import { buildServer } from "@/server";
import type { LedgerService } from "@/services/LedgerService";
import { getTestJWKS, signTestJWT } from "@/test-utils/jwt";
import { createLedgerFixture, createOrganizationFixture } from "./fixtures";

const mockLedgerService = vi.mocked<LedgerService>({
	listLedgers: vi.fn(),
	getLedger: vi.fn(),
	createLedger: vi.fn(),
	updateLedger: vi.fn(),
	deleteLedger: vi.fn(),
} as unknown as LedgerService);

describe("LedgerRoutes", () => {
	let server: FastifyInstance;
	const org = createOrganizationFixture();
	const ledger = createLedgerFixture();
	let token: string;

	beforeAll(async () => {
		const testJWKS = await getTestJWKS();
		server = await buildServer({
			authOpts: { jwks: createLocalJWKSet(testJWKS) },
			servicePluginOpts: {
				services: { ledgerService: mockLedgerService },
			},
		});
		token = await signTestJWT({ org_id: org.id.toString(), role: "admin" });
	});

	afterAll(async () => {
		await server.close();
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("List Ledgers", () => {
		it("should return a list of ledgers", async () => {
			mockLedgerService.listLedgers.mockResolvedValue([ledger]);

			const rs = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([ledger.toResponse()]);
			expect(mockLedgerService.listLedgers).toHaveBeenCalledWith(org.id, 0, 20);
		});

		it("should return a list of ledgers with pagination", async () => {
			mockLedgerService.listLedgers.mockResolvedValue([ledger]);

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers?offset=10&limit=20",
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([ledger.toResponse()]);
			expect(mockLedgerService.listLedgers).toHaveBeenCalledWith(org.id, 10, 20);
		});

		it("should handle unauthorized error", async () => {
			mockLedgerService.listLedgers.mockResolvedValue([ledger]);

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: "Bearer invalid_token",
				},
				url: "/api/ledgers",
			});
			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toContain("Invalid token signature");
		});

		it("should allow org_readonly to list ledgers", async () => {
			const orgReadonly = await signTestJWT({
				org_id: org.id.toString(),
				role: "viewer",
			});
			mockLedgerService.listLedgers.mockResolvedValue([ledger]);

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${orgReadonly}`,
				},
				url: "/api/ledgers",
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([ledger.toResponse()]);
		});
	});

	describe("Get Ledger", () => {
		it("should return a ledger", async () => {
			mockLedgerService.getLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
		});

		it("should handle unauthorized error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: "Bearer invalid_token",
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toContain("Invalid token signature");
		});

		it("should allow org_user to get ledger", async () => {
			const orgUser = await signTestJWT({
				org_id: org.id.toString(),
				role: "member",
			});
			mockLedgerService.getLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${orgUser}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
		});

		it("should handle not found error", async () => {
			mockLedgerService.getLedger.mockImplementation(async () => {
				throw new NotFoundError(`Ledger not found: ${ledger.id.toString()}`);
			});

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
			expect(response.detail).toEqual(`Ledger not found: ${ledger.id.toString()}`);
		});

		it("should handle internal server error", async () => {
			mockLedgerService.getLedger.mockImplementation(async () => {
				throw new Error("Internal Server Error");
			});

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
			expect(response.detail).toEqual("Internal Server Error");
		});
	});

	describe("Create Ledger", () => {
		const request = {
			name: ledger.name,
			description: ledger.description,
			currency: ledger.currency,
			currencyExponent: ledger.currencyExponent,
		};

		it("should create a ledger", async () => {
			mockLedgerService.createLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
				payload: request,
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
		});

		it("should handle conflict error", async () => {
			mockLedgerService.createLedger.mockImplementation(async () => {
				throw new ConflictError({ message: `Ledger already exists: ${ledger.name}` });
			});

			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
				payload: request,
			});
			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
			expect(response.detail).toEqual(`Ledger already exists: ${ledger.name}`);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
				payload: {},
			});
			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should allow org_user to create ledger", async () => {
			const orgUser = await signTestJWT({
				org_id: org.id.toString(),
				role: "member",
			});
			mockLedgerService.createLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgUser}`,
				},
				url: "/api/ledgers",
				payload: request,
			});
			expect(rs.statusCode).toBe(200);
		});

		it("should not allow org_readonly to create ledger", async () => {
			const orgReadonly = await signTestJWT({
				org_id: org.id.toString(),
				role: "viewer",
			});
			mockLedgerService.createLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgReadonly}`,
				},
				url: "/api/ledgers",
				payload: request,
			});
			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});

	describe("Update Ledger", () => {
		const request = {
			name: ledger.name,
			description: ledger.description,
			currency: ledger.currency,
			currencyExponent: ledger.currencyExponent,
		};

		it("should update a ledger", async () => {
			mockLedgerService.updateLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: request,
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
		});

		it("should handle not found error", async () => {
			mockLedgerService.updateLedger.mockImplementation(async () => {
				throw new NotFoundError(`Ledger not found: ${ledger.id.toString()}`);
			});

			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: request,
			});
			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
			expect(response.detail).toEqual(`Ledger not found: ${ledger.id.toString()}`);
		});

		it("should allow org_user to update ledger", async () => {
			const orgUser = await signTestJWT({
				org_id: org.id.toString(),
				role: "member",
			});
			mockLedgerService.updateLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${orgUser}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: request,
			});
			expect(rs.statusCode).toBe(200);
		});

		it("should not allow org_readonly to update ledger", async () => {
			const orgReadonly = await signTestJWT({
				org_id: org.id.toString(),
				role: "viewer",
			});
			mockLedgerService.updateLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${orgReadonly}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: request,
			});
			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});

	describe("Delete Ledger", () => {
		it("should delete a ledger", async () => {
			mockLedgerService.deleteLedger.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(200);
		});

		it("should handle not found error", async () => {
			mockLedgerService.deleteLedger.mockImplementation(async () => {
				throw new NotFoundError(`Ledger not found: ${ledger.id.toString()}`);
			});

			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
			expect(response.detail).toEqual(`Ledger not found: ${ledger.id.toString()}`);
		});

		it("should allow org_user to delete ledger", async () => {
			const orgUser = await signTestJWT({
				org_id: org.id.toString(),
				role: "member",
			});
			mockLedgerService.deleteLedger.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${orgUser}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should not allow org_readonly to delete ledger", async () => {
			const orgReadonly = await signTestJWT({
				org_id: org.id.toString(),
				role: "viewer",
			});
			mockLedgerService.deleteLedger.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${orgReadonly}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});
});
