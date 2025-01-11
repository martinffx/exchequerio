import type { FastifyInstance } from "fastify";
import { buildServer } from "@/server";
import { sighJWT } from "@/auth";
import type { LedgerService } from "@/services/LedgerService";
import { createLedgerFixture, createOrganizationFixture } from "./fixtures";
import { de } from "@faker-js/faker";

const mockLedgerService = jest.mocked<LedgerService>({
	listLedgers: jest.fn(),
	getLedger: jest.fn(),
	updateLedger: jest.fn(),
	deleteLedger: jest.fn(),
	listLedger: jest.fn(),
} as unknown as LedgerService);

jest.mock("@/services/LedgerService", () => {
	const actual = jest.requireActual("@/services/LedgerService");
	return {
		__esModule: true,
		...actual,
		LedgerService: jest.fn().mockImplementation(() => mockLedgerService),
	};
});

describe("LedgerRoutes", () => {
	let server: FastifyInstance;
	const org = createOrganizationFixture();
	const ledger = createLedgerFixture();
	const token = sighJWT({ sub: org.id.toString(), scope: ["org_admin"] });

	beforeEach(async () => {
		jest.clearAllMocks();
		server = await buildServer();
	});

	describe("List Ledgers", () => {
		it("should return a list of ledgers", async () => {
			mockLedgerService.listLedgers.mockImplementation(
				async (orgId, offset, limit) => {
					expect(orgId).toEqual(org.id);
					expect(offset).toBe(0);
					expect(limit).toBe(20);
					return [ledger];
				},
			);

			const rs = await server.inject({
				method: "GET",
				url: "/api/ledgers",
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([ledger.toResponse()]);
		});

		it("should return a list of ledgers with pagination", async () => {
			mockLedgerService.listLedgers.mockImplementation(
				async (orgId, offset, limit) => {
					expect(orgId).toEqual(org.id);
					expect(offset).toBe(10);
					expect(limit).toBe(20);
					return [ledger];
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers?offset=10&limit=20",
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([ledger.toResponse()]);
		});

		it("should handle unauthorized error", async () => {
			mockLedgerService.listLedgers.mockImplementation(
				async (orgId, offset, limit) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
			});
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle forbidden error", async () => {
			mockLedgerService.listLedgers.mockImplementation(
				async (orgId, offset, limit) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
			});
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle internal server error", async () => {
			mockLedgerService.listLedgers.mockImplementation(
				async (orgId, offset, limit) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers",
			});
			expect(rs.statusCode).toBe(500);
			expect(rs.json().status).toEqual(500);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle bad request error", async () => {
			mockLedgerService.listLedgers.mockImplementation(
				async (orgId, offset, limit) => {
					return [ledger];
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: "/api/ledgers?offset=invalid&limit=invalid",
			});
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("querystring/offset must be number");
		});
	});

	describe("Get Ledger", () => {
		it("should return a ledger", async () => {
			mockLedgerService.getLedger.mockImplementation(
				async (orgId, ledgerId) => {
					expect(orgId).toEqual(org.id);
					expect(ledgerId).toEqual(ledger.id);
					return ledger;
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
		})

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/org_${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("path/ledgerId must be number");
		});

		it("should handle unauthorized error", async () => {
			mockLedgerService.getLedger.mockImplementation(
				async (orgId, ledgerId) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle forbidden error", async () => {
			mockLedgerService.getLedger.mockImplementation(
				async (orgId, ledgerId) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle not found error", async () => {
			mockLedgerService.getLedger.mockImplementation(
				async (orgId, ledgerId) => {
					throw new Error("Not Found");
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(404);
			expect(rs.json().status).toEqual(404);
			expect(rs.json().detail).toEqual("Not Found");
		});

		it("should handle internal server error", async () => {
			mockLedgerService.getLedger.mockImplementation(
				async (orgId, ledgerId) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(500);
			expect(rs.json().status).toEqual(500);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});
	});

	describe("Create Ledger", () => {
		it("should create a ledger", async () => {
			mockLedgerService.createLedger.mockImplementation(
				async (orgId, ledger) => {
					expect(orgId).toEqual(org.id);
					expect(ledger.name).toEqual("test");
					return ledger;
				},
			);
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
			expect(rs.statusCode).toBe(201);
			expect(rs.json()).toEqual(ledger.toResponse());
		});

		it("should handle bad request error", async () => {
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
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("body/name must be string");
		});

		it("should handle unauthorized error", async () => {
			mockLedgerService.createLedger.mockImplementation(
				async (orgId, ledger) => {
					throw new Error("Internal Server Error");
				},
			);
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
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle forbidden error", async () => {
			mockLedgerService.createLedger.mockImplementation(
				async (orgId, ledger) => {
					throw new Error("Internal Server Error");
				},
			);
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
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle conflict error", async () => {
			mockLedgerService.createLedger.mockImplementation(
				async (orgId, ledger) => {
					throw new Error("Conflict");
				},
			);
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
			expect(rs.json().status).toEqual(409);
			expect(rs.json().detail).toEqual("Conflict");
		});

		it("should handle internal server error", async () => {
			mockLedgerService.createLedger.mockImplementation(
				async (orgId, ledger) => {
					throw new Error("Internal Server Error");
				},
			);
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
			expect(rs.json().status).toEqual(500);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});
	});

	describe("Update Ledger", () => {
		it("should update a ledger", async () => {
			mockLedgerService.updateLedger.mockImplementation(
				async (orgId, ledger) => {
					expect(orgId).toEqual(org.id);
					expect(ledger.name).toEqual("test");
					return ledger;
				},
			);
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
		});

		it("should handle bad request error", async () => {
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
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("body/name must be string");
		});

		it("should handle unauthorized error", async () => {
			mockLedgerService.updateLedger.mockImplementation(
				async (orgId, ledger) => {
					throw new Error("Internal Server Error");
				},
			);
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
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle forbidden error", async () => {
			mockLedgerService.updateLedger.mockImplementation(
				async (orgId, ledger) => {
					throw new Error("Internal Server Error");
				},
			);
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
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle not found error", async () => {
			mockLedgerService.updateLedger.mockImplementation(
				async (orgId, ledger) => {
					throw new Error("Not Found");
				},
			);
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
			expect(rs.json().status).toEqual(404);
			expect(rs.json().detail).toEqual("Not Found");
		});

		it("should handle conflict error", async () => {
			mockLedgerService.updateLedger.mockImplementation(
				async (orgId, ledger) => {
					throw new Error("Conflict");
				},
			);
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
			expect(rs.json().status).toEqual(409);
			expect(rs.json().detail).toEqual("Conflict");
		});

		it("should handle internal server error", async () => {
			mockLedgerService.updateLedger.mockImplementation(
				async (orgId, ledger) => {
					throw new Error("Internal Server Error");
				},
			);
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
			expect(rs.json().status).toEqual(500);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});
	})

	describe("Delete Ledger", () => {
		it("should delete a ledger", async () => {
			mockLedgerService.deleteLedger.mockImplementation(
				async (orgId, ledgerId) => {
					expect(orgId).toEqual(org.id);
					expect(ledgerId).toEqual(ledger.id);
				},
			);
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(ledger.toResponse());
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(400);
			expect(rs.json().status).toEqual(400);
			expect(rs.json().detail).toEqual("path/ledgerId must be number");
		});

		it("should handle unauthorized error", async () => {
			mockLedgerService.deleteLedger.mockImplementation(
				async (orgId, ledgerId) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(401);
			expect(rs.json().status).toEqual(401);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle forbidden error", async () => {
			mockLedgerService.deleteLedger.mockImplementation(
				async (orgId, ledgerId) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(403);
			expect(rs.json().status).toEqual(403);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});

		it("should handle not found error", async () => {
			mockLedgerService.deleteLedger.mockImplementation(
				async (orgId, ledgerId) => {
					throw new Error("Not Found");
				},
			);
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(404);
			expect(rs.json().status).toEqual(404);
			expect(rs.json().detail).toEqual("Not Found");
		});

		it("should handle conflict error", async () => {
			mockLedgerService.deleteLedger.mockImplementation(
				async (orgId, ledgerId) => {
					throw new Error("Conflict");
				},
			);
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(409);
			expect(rs.json().status).toEqual(409);
			expect(rs.json().detail).toEqual("Conflict");
		});

		it("should handle internal server error", async () => {
			mockLedgerService.deleteLedger.mockImplementation(
				async (orgId, ledgerId) => {
					throw new Error("Internal Server Error");
				},
			);
			const rs = await server.inject({
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				url: `/api/ledgers/${ledger.id.toString()}`,
			});
			expect(rs.statusCode).toBe(500);
			expect(rs.json().status).toEqual(500);
			expect(rs.json().detail).toEqual("Internal Server Error");
		});
	})
});
