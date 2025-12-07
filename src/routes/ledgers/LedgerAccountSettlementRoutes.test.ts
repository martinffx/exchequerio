import type { FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signJWT } from "@/auth";
import { ConflictError, NotFoundError } from "@/errors";
import type {
	LedgerAccountID,
	LedgerAccountSettlementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import { buildServer } from "@/server";
import type {
	LedgerAccountService,
	LedgerAccountSettlementService,
	LedgerService,
} from "@/services";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "../schema";
import {
	createLedgerAccountFixture,
	createLedgerAccountSettlementFixture,
	createLedgerFixture,
} from "./fixtures";

const mockLedgerService = vi.mocked<LedgerService>({
	getLedger: vi.fn(),
} as unknown as LedgerService);

const mockLedgerAccountService = vi.mocked<LedgerAccountService>({
	getLedgerAccount: vi.fn(),
} as unknown as LedgerAccountService);

const mockLedgerAccountSettlementService = vi.mocked<LedgerAccountSettlementService>({
	listLedgerAccountSettlements: vi.fn(),
	getLedgerAccountSettlement: vi.fn(),
	createLedgerAccountSettlement: vi.fn(),
	updateLedgerAccountSettlement: vi.fn(),
	deleteLedgerAccountSettlement: vi.fn(),
	addLedgerAccountSettlementEntries: vi.fn(),
	removeLedgerAccountSettlementEntries: vi.fn(),
	transitionSettlementStatus: vi.fn(),
} as unknown as LedgerAccountSettlementService);

describe("LedgerAccountSettlementRoutes", () => {
	let server: FastifyInstance;
	const orgId = TypeID.fromString("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
	const ledgerId = TypeID.fromString("lgr_01h2x3y4z5a6b7c8d9e0f1g2h4") as LedgerID;
	const settlementId = TypeID.fromString(
		"las_01h2x3y4z5a6b7c8d9e0f1g2h7"
	) as LedgerAccountSettlementID;
	const settledAccountId = TypeID.fromString("lat_01h2x3y4z5a6b7c8d9e0f1g2h6") as LedgerAccountID;
	const contraAccountId = TypeID.fromString("lat_01h2x3y4z5a6b7c8d9e0f1g2h8") as LedgerAccountID;
	const ledgerIdStr = ledgerId.toString();
	const settlementIdStr = settlementId.toString();
	const fixedDate = new Date("2025-01-01T00:00:00.000Z");

	const mockLedger = createLedgerFixture();
	const mockSettledAccount = createLedgerAccountFixture({
		id: settledAccountId,
		organizationId: orgId,
		ledgerId,
		created: fixedDate,
		updated: fixedDate,
	});
	const mockSettlement = createLedgerAccountSettlementFixture({
		id: settlementId,
		organizationId: orgId,
		settledLedgerAccountId: settledAccountId,
		contraLedgerAccountId: contraAccountId,
		description: "Test settlement",
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
					ledgerAccountSettlementService: mockLedgerAccountSettlementService,
				},
			},
		});
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("List Ledger Account Settlements", () => {
		it("should return a list of settlements", async () => {
			mockLedgerAccountSettlementService.listLedgerAccountSettlements.mockResolvedValue([
				mockSettlement,
			]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountSettlementService.listLedgerAccountSettlements).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				0,
				20
			);
		});

		it("should return a list with pagination", async () => {
			mockLedgerAccountSettlementService.listLedgerAccountSettlements.mockResolvedValue([
				mockSettlement,
			]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements?offset=10&limit=5`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountSettlementService.listLedgerAccountSettlements).toHaveBeenCalledWith(
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
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
			expect(response.detail).toEqual("Invalid token");
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements?offset=invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountSettlementService.listLedgerAccountSettlements.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Get Ledger Account Settlement", () => {
		it("should return a settlement", async () => {
			mockLedgerAccountSettlementService.getLedgerAccountSettlement.mockResolvedValue(mockSettlement);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountSettlementService.getLedgerAccountSettlement).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "las" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.getLedgerAccountSettlement.mockRejectedValue(
				new NotFoundError("Settlement not found")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountSettlementService.getLedgerAccountSettlement.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Create Ledger Account Settlement", () => {
		it("should create a settlement", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockSettledAccount);
			mockLedgerAccountSettlementService.createLedgerAccountSettlement.mockResolvedValue(
				mockSettlement
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
					description: "Test settlement",
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountSettlementService.createLedgerAccountSettlement).toHaveBeenCalled();
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockSettledAccount);
			mockLedgerAccountSettlementService.createLedgerAccountSettlement.mockRejectedValue(
				new ConflictError({ message: "Settlement already exists" })
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockSettledAccount);
			mockLedgerAccountSettlementService.createLedgerAccountSettlement.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Update Ledger Account Settlement", () => {
		it("should update a settlement", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockSettledAccount);
			mockLedgerAccountSettlementService.updateLedgerAccountSettlement.mockResolvedValue(
				mockSettlement
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
					description: "Updated settlement",
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountSettlementService.updateLedgerAccountSettlement).toHaveBeenCalled();
		});

		it("should handle not found error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockSettledAccount);
			mockLedgerAccountSettlementService.updateLedgerAccountSettlement.mockRejectedValue(
				new NotFoundError("Settlement not found")
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockSettledAccount);
			mockLedgerAccountSettlementService.updateLedgerAccountSettlement.mockRejectedValue(
				new ConflictError({ message: "Cannot update posted settlement" })
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerService.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountService.getLedgerAccount.mockResolvedValue(mockSettledAccount);
			mockLedgerAccountSettlementService.updateLedgerAccountSettlement.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					ledgerTransactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledLedgerAccountId: settledAccountId.toString(),
					contraLedgerAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Delete Ledger Account Settlement", () => {
		it("should delete a settlement", async () => {
			mockLedgerAccountSettlementService.deleteLedgerAccountSettlement.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountSettlementService.deleteLedgerAccountSettlement).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "las" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.deleteLedgerAccountSettlement.mockRejectedValue(
				new NotFoundError("Settlement not found")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle conflict error", async () => {
			mockLedgerAccountSettlementService.deleteLedgerAccountSettlement.mockRejectedValue(
				new ConflictError({ message: "Cannot delete posted settlement" })
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountSettlementService.deleteLedgerAccountSettlement.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Add Settlement Entries", () => {
		it("should add entries to a settlement", async () => {
			mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries.mockResolvedValue();

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString(), new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries
			).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "las" }),
				expect.any(Array)
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries.mockRejectedValue(
				new NotFoundError("Settlement not found")
			);

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries.mockRejectedValue(
				new ConflictError({ message: "Cannot add entries to posted settlement" })
			);

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Remove Settlement Entries", () => {
		it("should remove entries from a settlement", async () => {
			mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString(), new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries
			).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "las" }),
				expect.any(Array)
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries.mockRejectedValue(
				new NotFoundError("Settlement not found")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries.mockRejectedValue(
				new ConflictError({ message: "Cannot remove entries from posted settlement" })
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: {
					entries: [new TypeID("lte").toString()],
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Transition Settlement Status", () => {
		it("should transition settlement status to processing", async () => {
			const processingSettlement = createLedgerAccountSettlementFixture({
				id: settlementId,
				organizationId: orgId,
				settledLedgerAccountId: settledAccountId,
				contraLedgerAccountId: contraAccountId,
				status: "processing",
				description: "Test settlement",
				created: fixedDate,
				updated: fixedDate,
			});
			mockLedgerAccountSettlementService.transitionSettlementStatus.mockResolvedValue(
				processingSettlement
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/processing`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountSettlementService.transitionSettlementStatus).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "las" }),
				"processing"
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.transitionSettlementStatus.mockRejectedValue(
				new NotFoundError("Settlement not found")
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/processing`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/processing`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/processing`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle bad request error with invalid status", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/invalid_status`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error for invalid transition", async () => {
			mockLedgerAccountSettlementService.transitionSettlementStatus.mockRejectedValue(
				new ConflictError({ message: "Invalid transition from posted to drafting" })
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/drafting`,
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountSettlementService.transitionSettlementStatus.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}/processing`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});
});
