import type { FastifyInstance } from "fastify";
import { vi } from "vitest";
import { signJWT } from "@/auth";
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
	const token = signJWT({ sub: org.id.toString(), scope: ["org_admin"] });

	beforeAll(async () => {
		server = await buildServer({
			servicePluginOpts: {
				services: { ledgerService: mockLedgerService },
			},
		});
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
			expect(response.detail).toEqual("Invalid token");
		});

		it("should allow org_readonly to list ledgers", async () => {
			const orgReadonly = signJWT({
				sub: org.id.toString(),
				scope: ["org_readonly"],
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

		it("should handle internal server error", async () => {
			mockLedgerService.listLedgers.mockImplementation(async () => {
				throw new Error("Internal Server Error");
			});

			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
			});
			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
			expect(response.detail).toEqual("Internal Server Error");
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers?offset=invalid&limit=invalid",
			});
			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toEqual("querystring/offset must be number");
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
			expect(mockLedgerService.getLedger).toHaveBeenCalledWith(org.id, ledger.id);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/org_${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toContain('params/ledgerId must match pattern "^lgr_');
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
			expect(response.detail).toEqual("Invalid token");
		});

		it("should allow org_user to get ledger", async () => {
			const orgUser = signJWT({
				sub: org.id.toString(),
				scope: ["org_user"],
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
		it("should create a ledger", async () => {
			mockLedgerService.createLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
			expect(mockLedgerService.createLedger).toHaveBeenCalled();
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
				payload: {
					foo: "bar",
				},
			});
			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toContain("body must have required property 'name'");
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: "Bearer invalid_token",
				},
				url: "/api/ledgers",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toEqual("Invalid token");
		});

		it("should allow org_user to create ledger", async () => {
			const orgUser = signJWT({
				sub: org.id.toString(),
				scope: ["org_user"],
			});
			mockLedgerService.createLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${orgUser}`,
				},
				url: "/api/ledgers",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
		});

		it("should handle conflict error", async () => {
			mockLedgerService.createLedger.mockImplementation(async () => {
				throw new ConflictError({ message: "Ledger already exists" });
			});

			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
			expect(response.detail).toEqual("Ledger already exists");
		});

		it("should handle internal server error", async () => {
			mockLedgerService.createLedger.mockImplementation(async () => {
				throw new Error("Internal Server Error");
			});

			const rs = await server.inject({
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
			expect(response.detail).toEqual("Internal Server Error");
		});
	});

	describe("Update Ledger", () => {
		it("should update a ledger", async () => {
			mockLedgerService.updateLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
			expect(mockLedgerService.updateLedger).toHaveBeenCalled();
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: {
					foo: "bar",
				},
			});
			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toContain("body must have required property 'name'");
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: "Bearer invalid_token",
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toEqual("Invalid token");
		});

		it("should allow org_user to update ledger", async () => {
			const orgUser = signJWT({
				sub: org.id.toString(),
				scope: ["org_user"],
			});
			mockLedgerService.updateLedger.mockResolvedValue(ledger);

			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${orgUser}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
		});

		it("should handle not found error", async () => {
			mockLedgerService.updateLedger.mockImplementation(async () => {
				throw new NotFoundError("Ledger not found");
			});

			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
			expect(response.detail).toEqual("Ledger not found");
		});

		it("should handle conflict error", async () => {
			mockLedgerService.updateLedger.mockImplementation(async () => {
				throw new ConflictError({ message: "Ledger conflict" });
			});

			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
			expect(response.detail).toEqual("Ledger conflict");
		});

		it("should handle internal server error", async () => {
			mockLedgerService.updateLedger.mockImplementation(async () => {
				throw new Error("Internal Server Error");
			});

			const rs = await server.inject({
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
				payload: {
					name: "test",
				},
			});
			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
			expect(response.detail).toEqual("Internal Server Error");
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
			expect(mockLedgerService.deleteLedger).toHaveBeenCalledWith(org.id, ledger.id);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/org_${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
			expect(response.detail).toContain('params/ledgerId must match pattern "^lgr_');
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: "Bearer invalid_token",
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toEqual("Invalid token");
		});

		it("should forbid org_user from deleting ledger", async () => {
			const orgUser = signJWT({
				sub: org.id.toString(),
				scope: ["org_user"],
			});

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
			expect(response.detail).toContain("permissions is required");
		});

		it("should handle not found error", async () => {
			mockLedgerService.deleteLedger.mockImplementation(async () => {
				throw new NotFoundError("Ledger not found");
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
			expect(response.detail).toEqual("Ledger not found");
		});

		it("should handle conflict error", async () => {
			mockLedgerService.deleteLedger.mockImplementation(async () => {
				throw new ConflictError({ message: "Cannot delete ledger with active accounts" });
			});

			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
			expect(response.detail).toEqual("Cannot delete ledger with active accounts");
		});

		it("should handle internal server error", async () => {
			mockLedgerService.deleteLedger.mockImplementation(async () => {
				throw new Error("Internal Server Error");
			});

			const rs = await server.inject({
				method: "DELETE",
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
});
