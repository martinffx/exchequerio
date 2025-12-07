import type { FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signJWT } from "@/auth";
import { ConflictError, NotFoundError } from "@/errors";
import type { LedgerAccountBalanceMonitorID, LedgerAccountID, OrgID } from "@/repo/entities/types";
import { buildServer } from "@/server";
import type { LedgerAccountBalanceMonitorService } from "@/services";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "../schema";
import { createLedgerAccountBalanceMonitorFixture } from "./fixtures";

const mockLedgerAccountBalanceMonitorService = vi.mocked<LedgerAccountBalanceMonitorService>({
	listLedgerAccountBalanceMonitors: vi.fn(),
	getLedgerAccountBalanceMonitor: vi.fn(),
	createLedgerAccountBalanceMonitor: vi.fn(),
	updateLedgerAccountBalanceMonitor: vi.fn(),
	deleteLedgerAccountBalanceMonitor: vi.fn(),
} as unknown as LedgerAccountBalanceMonitorService);

describe("LedgerAccountBalanceMonitorRoutes", () => {
	let server: FastifyInstance;
	const orgId = TypeID.fromString("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
	const ledgerId = TypeID.fromString("lgr_01h2x3y4z5a6b7c8d9e0f1g2h4");
	const monitorId = TypeID.fromString(
		"lbm_01h2x3y4z5a6b7c8d9e0f1g2h5"
	) as LedgerAccountBalanceMonitorID;
	const accountId = TypeID.fromString("lat_01h2x3y4z5a6b7c8d9e0f1g2h6") as LedgerAccountID;
	const ledgerIdStr = ledgerId.toString();
	const monitorIdStr = monitorId.toString();
	const accountIdStr = accountId.toString();
	const fixedDate = new Date("2025-01-01T00:00:00.000Z");

	const mockMonitor = createLedgerAccountBalanceMonitorFixture({
		id: monitorId,
		accountId,
		name: "Test Monitor",
		description: "Test balance monitor",
		alertThreshold: 100000,
		isActive: true,
		created: fixedDate,
		updated: fixedDate,
	});

	const token = signJWT({ sub: orgId.toString(), scope: ["org_admin"] });
	const tokenReadOnly = signJWT({ sub: orgId.toString(), scope: ["org_readonly"] });

	beforeAll(async () => {
		server = await buildServer({
			servicePluginOpts: {
				services: {
					ledgerAccountBalanceMonitorService: mockLedgerAccountBalanceMonitorService,
				},
			},
		});
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("GET /", () => {
		it("should return a list of monitors", async () => {
			mockLedgerAccountBalanceMonitorService.listLedgerAccountBalanceMonitors.mockResolvedValue([
				mockMonitor,
			]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(
				mockLedgerAccountBalanceMonitorService.listLedgerAccountBalanceMonitors
			).toHaveBeenCalledWith(0, 20);
		});

		it("should return a list with pagination", async () => {
			mockLedgerAccountBalanceMonitorService.listLedgerAccountBalanceMonitors.mockResolvedValue([
				mockMonitor,
			]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors?offset=10&limit=5`,
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountBalanceMonitorService.listLedgerAccountBalanceMonitors
			).toHaveBeenCalledWith(10, 5);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors`,
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
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors?offset=invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountBalanceMonitorService.listLedgerAccountBalanceMonitors.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("GET /:ledgerAccountBalanceMonitorId", () => {
		it("should return a monitor", async () => {
			mockLedgerAccountBalanceMonitorService.getLedgerAccountBalanceMonitor.mockResolvedValue(
				mockMonitor
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(
				mockLedgerAccountBalanceMonitorService.getLedgerAccountBalanceMonitor
			).toHaveBeenCalledWith(monitorIdStr);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountBalanceMonitorService.getLedgerAccountBalanceMonitor.mockRejectedValue(
				new NotFoundError("Monitor not found")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountBalanceMonitorService.getLedgerAccountBalanceMonitor.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("POST /", () => {
		it("should create a monitor", async () => {
			mockLedgerAccountBalanceMonitorService.createLedgerAccountBalanceMonitor.mockResolvedValue(
				mockMonitor
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Test balance monitor",
					alertCondition: [],
					metadata: {},
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(
				mockLedgerAccountBalanceMonitorService.createLedgerAccountBalanceMonitor
			).toHaveBeenCalled();
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Test balance monitor",
					alertCondition: [],
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
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Test balance monitor",
					alertCondition: [],
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
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerAccountBalanceMonitorService.createLedgerAccountBalanceMonitor.mockRejectedValue(
				new ConflictError({ message: "Monitor already exists" })
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Test balance monitor",
					alertCondition: [],
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountBalanceMonitorService.createLedgerAccountBalanceMonitor.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Test balance monitor",
					alertCondition: [],
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("PUT /:ledgerAccountBalanceMonitorId", () => {
		it("should update a monitor", async () => {
			mockLedgerAccountBalanceMonitorService.updateLedgerAccountBalanceMonitor.mockResolvedValue(
				mockMonitor
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Updated monitor",
					alertCondition: [],
					metadata: {},
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(
				mockLedgerAccountBalanceMonitorService.updateLedgerAccountBalanceMonitor
			).toHaveBeenCalled();
		});

		it("should handle not found error", async () => {
			mockLedgerAccountBalanceMonitorService.updateLedgerAccountBalanceMonitor.mockRejectedValue(
				new NotFoundError("Monitor not found")
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Updated monitor",
					alertCondition: [],
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
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Updated monitor",
					alertCondition: [],
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
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Updated monitor",
					alertCondition: [],
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
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerAccountBalanceMonitorService.updateLedgerAccountBalanceMonitor.mockRejectedValue(
				new ConflictError({ message: "Cannot update active monitor" })
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Updated monitor",
					alertCondition: [],
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountBalanceMonitorService.updateLedgerAccountBalanceMonitor.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
				payload: {
					ledgerAccountId: accountIdStr,
					description: "Updated monitor",
					alertCondition: [],
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("DELETE /:ledgerAccountBalanceMonitorId", () => {
		it("should delete a monitor", async () => {
			mockLedgerAccountBalanceMonitorService.deleteLedgerAccountBalanceMonitor.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountBalanceMonitorService.deleteLedgerAccountBalanceMonitor
			).toHaveBeenCalledWith(monitorIdStr);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountBalanceMonitorService.deleteLedgerAccountBalanceMonitor.mockRejectedValue(
				new NotFoundError("Monitor not found")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle forbidden error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});

		it("should handle conflict error", async () => {
			mockLedgerAccountBalanceMonitorService.deleteLedgerAccountBalanceMonitor.mockRejectedValue(
				new ConflictError({ message: "Cannot delete active monitor" })
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountBalanceMonitorService.deleteLedgerAccountBalanceMonitor.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/${accountIdStr}/balance-monitors/${monitorIdStr}`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});
});
