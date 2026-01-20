import type { FastifyInstance } from "fastify";
import { createLocalJWKSet } from "jose";
import { TypeID } from "typeid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "@/errors";
import type { LedgerAccountID, LedgerAccountStatementID, OrgID } from "@/repo/entities/types";
import { buildServer } from "@/server";
import type { LedgerAccountStatementService } from "@/services";
import { getTestJWKS, signTestJWT } from "@/test-utils/jwt";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "../schema";
import { createLedgerAccountStatementFixture } from "./fixtures";

const mockLedgerAccountStatementService = vi.mocked<LedgerAccountStatementService>({
	getLedgerAccountStatement: vi.fn(),
	createLedgerAccountStatement: vi.fn(),
} as unknown as LedgerAccountStatementService);

describe("LedgerAccountStatementRoutes", () => {
	let server: FastifyInstance;
	const orgId = TypeID.fromString("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
	const ledgerId = TypeID.fromString("lgr_01h2x3y4z5a6b7c8d9e0f1g2h4");
	const statementId = TypeID.fromString(
		"lst_01h2x3y4z5a6b7c8d9e0f1g2h5"
	) as LedgerAccountStatementID;
	const accountId = TypeID.fromString("lat_01h2x3y4z5a6b7c8d9e0f1g2h6") as LedgerAccountID;
	const ledgerIdStr = ledgerId.toString();
	const statementIdStr = statementId.toString();
	const accountIdStr = accountId.toString();
	const fixedDate = new Date("2025-01-01T00:00:00.000Z");

	const mockStatement = createLedgerAccountStatementFixture({
		id: statementId,
		accountId,
		statementDate: fixedDate,
		created: fixedDate,
		updated: fixedDate,
	});

	let token: string;
	let tokenReadOnly: string;

	beforeAll(async () => {
		const testJWKS = await getTestJWKS();
		server = await buildServer({
			authOpts: { jwks: createLocalJWKSet(testJWKS) },
			servicePluginOpts: {
				services: { ledgerAccountStatementService: mockLedgerAccountStatementService },
			},
		});
		token = await signTestJWT({ org_id: orgId.toString(), role: "admin" });
		tokenReadOnly = await signTestJWT({ org_id: orgId.toString(), role: "viewer" });
	});

	afterAll(async () => {
		await server.close();
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("GET /:ledgerAccountStatementId", () => {
		it("should return a statement", async () => {
			mockLedgerAccountStatementService.getLedgerAccountStatement.mockResolvedValue(mockStatement);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements/${statementIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountStatementService.getLedgerAccountStatement).toHaveBeenCalledWith(
				statementIdStr
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountStatementService.getLedgerAccountStatement.mockRejectedValue(
				new NotFoundError("Statement not found")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements/${statementIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements/${statementIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements/invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountStatementService.getLedgerAccountStatement.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements/${statementIdStr}`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("POST /", () => {
		it("should create a statement", async () => {
			mockLedgerAccountStatementService.createLedgerAccountStatement.mockResolvedValue(mockStatement);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements`,
				payload: {
					ledgerId: new TypeID("lgr").toString(),
					accountId: accountIdStr,
					startDatetime: fixedDate.toISOString(),
					endDatetime: fixedDate.toISOString(),
					description: "Test statement",
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerAccountStatementService.createLedgerAccountStatement).toHaveBeenCalled();
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements`,
				payload: {
					ledgerId: new TypeID("lgr").toString(),
					accountId: accountIdStr,
					startDatetime: fixedDate.toISOString(),
					endDatetime: fixedDate.toISOString(),
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
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements`,
				payload: {
					ledgerId: new TypeID("lgr").toString(),
					accountId: accountIdStr,
					startDatetime: fixedDate.toISOString(),
					endDatetime: fixedDate.toISOString(),
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
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerAccountStatementService.createLedgerAccountStatement.mockRejectedValue(
				new ConflictError({ message: "Statement already exists" })
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements`,
				payload: {
					ledgerId: new TypeID("lgr").toString(),
					accountId: accountIdStr,
					startDatetime: fixedDate.toISOString(),
					endDatetime: fixedDate.toISOString(),
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountStatementService.createLedgerAccountStatement.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/statements`,
				payload: {
					ledgerId: new TypeID("lgr").toString(),
					accountId: accountIdStr,
					startDatetime: fixedDate.toISOString(),
					endDatetime: fixedDate.toISOString(),
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});
});
