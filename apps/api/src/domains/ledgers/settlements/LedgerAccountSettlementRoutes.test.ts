import type { FastifyInstance } from "fastify";
import { Effect, Layer } from "effect";
import { TypeID } from "typeid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signJWT } from "@/auth";
import { Config } from "@/config";
import { makeDatabaseLive } from "@/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type {
	LedgerAccountID,
	LedgerAccountSettlementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import { buildServer } from "@/server";
import { ServerConfigTag, type ServerRuntimeLayer } from "@/runtime";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "@/lib/errors";
import { LedgerAccountSettlementEntity } from "./LedgerAccountSettlementEntity";
import {
	type LedgerAccountSettlementService,
	LedgerAccountSettlementServiceTag,
} from "./LedgerAccountSettlementService";

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
	const differentLedgerIdStr = new TypeID("lgr").toString();
	const settlementIdStr = settlementId.toString();
	const fixedDate = new Date("2025-01-01T00:00:00.000Z");
	const mockSettlement = new LedgerAccountSettlementEntity({
		id: settlementId,
		organizationId: orgId,
		transactionId: undefined,
		settledAccountId: settledAccountId,
		contraAccountId: contraAccountId,
		amount: 0,
		normalBalance: "debit",
		currency: "USD",
		status: "drafting",
		description: "Test settlement",
		externalReference: undefined,
		effectiveAtUpperBound: undefined,
		metadata: undefined,
		created: fixedDate,
		updated: fixedDate,
	});

	const token = signJWT({ sub: orgId.toString(), scope: ["org_admin"] });
	const tokenReadOnly = signJWT({
		sub: orgId.toString(),
		scope: ["org_readonly"],
	});

	beforeAll(async () => {
		const config = new Config();
		server = await buildServer({
			runtimeLayer: Layer.mergeAll(
				Layer.succeed(ServerConfigTag, config),
				makeDatabaseLive(config.databaseUrl),
				Layer.succeed(LedgerAccountSettlementServiceTag, mockLedgerAccountSettlementService)
			) as ServerRuntimeLayer,
		});
	});

	afterAll(async () => {
		await server.close();
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("List Ledger Account Settlements", () => {
		it("should return a list of settlements", async () => {
			mockLedgerAccountSettlementService.listLedgerAccountSettlements.mockReturnValue(
				Effect.succeed([mockSettlement])
			);

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
			mockLedgerAccountSettlementService.listLedgerAccountSettlements.mockReturnValue(
				Effect.succeed([mockSettlement])
			);

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

		it.each(["offset=-1", "offset=10001", "limit=0", "limit=101", "offset=1.5"])(
			"rejects invalid pagination: %s",
			async query => {
				const rs = await server.inject({
					method: "GET",
					headers: { Authorization: `Bearer ${token}` },
					url: `/api/ledgers/${ledgerIdStr}/settlements?${query}`,
				});

				expect(rs.statusCode).toBe(400);
				expect(mockLedgerAccountSettlementService.listLedgerAccountSettlements).not.toHaveBeenCalled();
			}
		);

		it("should handle internal server error", async () => {
			mockLedgerAccountSettlementService.listLedgerAccountSettlements.mockReturnValue(
				Effect.die(new Error("Internal Server Error"))
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
			mockLedgerAccountSettlementService.getLedgerAccountSettlement.mockReturnValue(
				Effect.succeed(mockSettlement)
			);

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

		it("does not scope the lookup to the path Ledger", async () => {
			mockLedgerAccountSettlementService.getLedgerAccountSettlement.mockReturnValue(
				Effect.succeed(mockSettlement)
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${differentLedgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountSettlementService.getLedgerAccountSettlement).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "las" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.getLedgerAccountSettlement.mockReturnValue(
				Effect.fail(new NotFoundError("Settlement not found"))
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
			mockLedgerAccountSettlementService.getLedgerAccountSettlement.mockReturnValue(
				Effect.die(new Error("Internal Server Error"))
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
			mockLedgerAccountSettlementService.createLedgerAccountSettlement.mockReturnValue(
				Effect.succeed(mockSettlement)
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
					description: "Test settlement",
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountSettlementService.createLedgerAccountSettlement).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
				})
			);
		});

		it("rejects accounts with a different currency", async () => {
			mockLedgerAccountSettlementService.createLedgerAccountSettlement.mockReturnValue(
				Effect.fail(new ConflictError("Settlement accounts must use the same currency"))
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(409);
			expect(mockLedgerAccountSettlementService.createLedgerAccountSettlement).toHaveBeenCalledOnce();
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
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
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
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
			mockLedgerAccountSettlementService.createLedgerAccountSettlement.mockReturnValue(
				Effect.fail(new ConflictError("Settlement already exists"))
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountSettlementService.createLedgerAccountSettlement.mockReturnValue(
				Effect.die(new Error("Internal Server Error"))
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements`,
				payload: {
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Update Ledger Account Settlement", () => {
		it("should update a settlement", async () => {
			mockLedgerAccountSettlementService.updateLedgerAccountSettlement.mockReturnValue(
				Effect.succeed(mockSettlement)
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
					description: "Updated settlement",
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountSettlementService.updateLedgerAccountSettlement).toHaveBeenCalled();
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.updateLedgerAccountSettlement.mockReturnValue(
				Effect.fail(new NotFoundError("Settlement not found"))
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
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
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
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
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
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
			mockLedgerAccountSettlementService.updateLedgerAccountSettlement.mockReturnValue(
				Effect.fail(new ConflictError("Cannot update posted settlement"))
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountSettlementService.updateLedgerAccountSettlement.mockReturnValue(
				Effect.die(new Error("Internal Server Error"))
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/settlements/${settlementIdStr}`,
				payload: {
					transactionId: new TypeID("ltr").toString(),
					status: "drafting",
					settledAccountId: settledAccountId.toString(),
					contraAccountId: contraAccountId.toString(),
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Delete Ledger Account Settlement", () => {
		it("should delete a settlement", async () => {
			mockLedgerAccountSettlementService.deleteLedgerAccountSettlement.mockReturnValue(Effect.void);

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

		it("does not scope the deletion to the path Ledger", async () => {
			mockLedgerAccountSettlementService.deleteLedgerAccountSettlement.mockReturnValue(Effect.void);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${differentLedgerIdStr}/settlements/${settlementIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountSettlementService.deleteLedgerAccountSettlement).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "las" })
			);
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
			mockLedgerAccountSettlementService.deleteLedgerAccountSettlement.mockReturnValue(
				Effect.fail(new ConflictError("Cannot delete posted settlement"))
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
			mockLedgerAccountSettlementService.deleteLedgerAccountSettlement.mockReturnValue(
				Effect.die(new Error("Internal Server Error"))
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
			mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries.mockReturnValue(
				Effect.void
			);

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

		it("does not scope the Entry addition to the path Ledger", async () => {
			mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries.mockReturnValue(
				Effect.void
			);
			const entryId = new TypeID("lte").toString();

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${differentLedgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: { entries: [entryId] },
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries
			).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "las" }),
				[entryId]
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries.mockReturnValue(
				Effect.fail(new NotFoundError("Settlement not found"))
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
			mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries.mockReturnValue(
				Effect.fail(new ConflictError("Cannot add entries to posted settlement"))
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
			mockLedgerAccountSettlementService.addLedgerAccountSettlementEntries.mockReturnValue(
				Effect.die(new Error("Internal Server Error"))
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
			mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries.mockReturnValue(
				Effect.void
			);

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

		it("does not scope the Entry removal to the path Ledger", async () => {
			mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries.mockReturnValue(
				Effect.void
			);
			const entryId = new TypeID("lte").toString();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${differentLedgerIdStr}/settlements/${settlementIdStr}/entries`,
				payload: { entries: [entryId] },
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries
			).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "las" }),
				[entryId]
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries.mockReturnValue(
				Effect.fail(new NotFoundError("Settlement not found"))
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
			mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries.mockReturnValue(
				Effect.fail(new ConflictError("Cannot remove entries from posted settlement"))
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
			mockLedgerAccountSettlementService.removeLedgerAccountSettlementEntries.mockReturnValue(
				Effect.die(new Error("Internal Server Error"))
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
			const processingSettlement = new LedgerAccountSettlementEntity({
				...mockSettlement,
				status: "processing",
			});
			mockLedgerAccountSettlementService.transitionSettlementStatus.mockReturnValue(
				Effect.succeed(processingSettlement)
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
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "las" }),
				"processing"
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountSettlementService.transitionSettlementStatus.mockReturnValue(
				Effect.fail(new NotFoundError("Settlement not found"))
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
			mockLedgerAccountSettlementService.transitionSettlementStatus.mockReturnValue(
				Effect.fail(new ConflictError("Invalid transition from posted to drafting"))
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
			mockLedgerAccountSettlementService.transitionSettlementStatus.mockReturnValue(
				Effect.die(new Error("Internal Server Error"))
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
