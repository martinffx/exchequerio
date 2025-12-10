import type { FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signJWT } from "@/auth";
import { ConflictError, NotFoundError } from "@/errors";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { buildServer } from "@/server";
import type { LedgerAccountService, LedgerService } from "@/services";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "../schema";
import { createLedgerAccountFixture, createLedgerFixture } from "./fixtures";

const mockLedgerService = vi.mocked<LedgerService>({
	getLedger: vi.fn(),
} as unknown as LedgerService);

const mockLedgerAccountService = vi.mocked<LedgerAccountService>({
	listLedgerAccounts: vi.fn(),
	getLedgerAccount: vi.fn(),
	createLedgerAccount: vi.fn(),
	updateLedgerAccount: vi.fn(),
	deleteLedgerAccount: vi.fn(),
} as unknown as LedgerAccountService);

describe("LedgerAccountRoutes", () => {
	let server: FastifyInstance;
	const orgId = TypeID.fromString("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
	const ledgerId = TypeID.fromString("lgr_01h2x3y4z5a6b7c8d9e0f1g2h4") as LedgerID;
	const accountId = TypeID.fromString("lat_01h2x3y4z5a6b7c8d9e0f1g2h6") as LedgerAccountID;
	const ledgerIdStr = ledgerId.toString();
	const accountIdStr = accountId.toString();
	const fixedDate = new Date("2025-01-01T00:00:00.000Z");

	const mockLedger = createLedgerFixture();
	const mockAccount = createLedgerAccountFixture({
		id: accountId,
		organizationId: orgId,
		ledgerId,
		name: "Test Account",
		description: "Test account description",
		created: fixedDate,
		updated: fixedDate,
	});

	const token = signJWT({ sub: orgId.toString(), scope: ["org_admin"] });
	const tokenReadOnly = signJWT({
		sub: orgId.toString(),
		scope: ["org_readonly"],
	});

	beforeAll(async () => {
		server = await buildServer({
			servicePluginOpts: {
				services: {
					ledgerService: mockLedgerService,
					ledgerAccountService: mockLedgerAccountService,
				},
			},
		});
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("List Ledger Accounts", () => {
		it("should return a list of ledger accounts", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.listLedgerAccounts.mockResolvedValue([mockAccount]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountService.listLedgerAccounts).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				0,
				20
			);
		});

		it("should return a list with pagination", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.listLedgerAccounts.mockResolvedValue([mockAccount]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts?offset=10&limit=5`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountService.listLedgerAccounts).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				10,
				5
			);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toEqual("Invalid token");
		});

		it("should allow org_readonly to list ledger accounts", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.listLedgerAccounts.mockResolvedValue([mockAccount]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
			});

			expect(rs.statusCode).toBe(200);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts?offset=invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle internal server error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.listLedgerAccounts.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Get Ledger Account", () => {
		it("should return a ledger account", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockAccount);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountService.getLedgerAccount).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lat" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockRejectedValue(
				new NotFoundError("Account not found")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should allow org_readonly to get ledger account", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockAccount);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle internal server error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockRejectedValue(new Error("Internal Server Error"));

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Create Ledger Account", () => {
		it("should create a ledger account", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.createLedgerAccount.mockResolvedValue(mockAccount);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
				payload: {
					name: "Test Account",
					description: "Test description",
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountService.createLedgerAccount).toHaveBeenCalledWith(
				expect.any(Object), // orgId
				ledgerIdStr,
				"debit",
				expect.objectContaining({
					name: "Test Account",
					description: "Test description",
				})
			);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
				payload: { name: "Test Account" },
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
				payload: { name: "Test Account" },
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.createLedgerAccount.mockRejectedValue(
				new ConflictError({ message: "Account already exists" })
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
				payload: { name: "Test Account" },
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.createLedgerAccount.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts`,
				payload: { name: "Test Account" },
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Update Ledger Account", () => {
		it("should update a ledger account", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockAccount);
			mockLedgerAccountService.updateLedgerAccount.mockResolvedValue(mockAccount);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
				payload: {
					name: "Updated Account",
					description: "Updated description",
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountService.updateLedgerAccount).toHaveBeenCalledWith(
				expect.any(Object), // orgId
				ledgerIdStr,
				accountIdStr,
				"debit",
				expect.objectContaining({
					name: "Updated Account",
					description: "Updated description",
				})
			);
		});

		it("should handle not found error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockRejectedValue(
				new NotFoundError("Account not found")
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
				payload: { name: "Updated Account" },
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
				payload: { name: "Updated Account" },
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
				payload: { name: "Updated Account" },
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockAccount);
			mockLedgerAccountService.updateLedgerAccount.mockRejectedValue(
				new ConflictError({ message: "Account conflict" })
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
				payload: { name: "Updated Account" },
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockAccount);
			mockLedgerAccountService.updateLedgerAccount.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
				payload: { name: "Updated Account" },
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Delete Ledger Account", () => {
		it("should delete a ledger account", async () => {
			mockLedgerAccountService.deleteLedgerAccount.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountService.deleteLedgerAccount).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lat" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountService.deleteLedgerAccount.mockRejectedValue(
				new NotFoundError("Account not found")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle conflict error", async () => {
			mockLedgerAccountService.deleteLedgerAccount.mockRejectedValue(
				new ConflictError({
					message: "Cannot delete account with transactions",
				})
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountService.deleteLedgerAccount.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});
});
