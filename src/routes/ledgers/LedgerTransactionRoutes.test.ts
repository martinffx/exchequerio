import type { FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signJWT } from "@/auth";
import { ConflictError, NotFoundError } from "@/errors";
import type { LedgerID, LedgerTransactionID, OrgID } from "@/repo/entities/types";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "@/routes/schema";
import { buildServer } from "@/server";
import type { LedgerTransactionService } from "@/services";
import { createLedgerTransactionFixture } from "./fixtures";

const mockLedgerTransactionService = vi.mocked<LedgerTransactionService>({
	listTransactions: vi.fn(),
	getLedgerTransaction: vi.fn(),
	createTransaction: vi.fn(),
	postTransaction: vi.fn(),
	deleteTransaction: vi.fn(),
} as unknown as LedgerTransactionService);

describe("LedgerTransactionRoutes", () => {
	let server: FastifyInstance;
	const orgId = TypeID.fromString("org_01h2x3y4z5a6b7c8d9e0f1g2h3") as OrgID;
	const ledgerId = TypeID.fromString("lgr_01h2x3y4z5a6b7c8d9e0f1g2h4") as LedgerID;
	const transactionId = TypeID.fromString("ltr_01h2x3y4z5a6b7c8d9e0f1g2h5") as LedgerTransactionID;
	const ledgerIdStr = ledgerId.toString();
	const transactionIdStr = transactionId.toString();
	const fixedDate = new Date("2025-01-01T00:00:00.000Z");

	const mockTransaction = createLedgerTransactionFixture({
		id: transactionId,
		organizationId: orgId,
		ledgerId,
		description: "Test transaction",
		created: fixedDate,
		updated: fixedDate,
		effectiveAt: fixedDate,
	});
	const token = signJWT({ sub: orgId.toString(), scope: ["org_admin"] });
	const tokenReadOnly = signJWT({ sub: orgId.toString(), scope: ["org_readonly"] });

	beforeAll(async () => {
		server = await buildServer({
			servicePluginOpts: {
				services: {
					ledgerTransactionService: mockLedgerTransactionService,
				},
			},
		});
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("List Ledger Transactions", () => {
		it("should return a list of ledger transactions", async () => {
			mockLedgerTransactionService.listTransactions.mockResolvedValue([mockTransaction]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerTransactionService.listTransactions).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				0,
				20
			);
		});

		it("should return a list with pagination", async () => {
			mockLedgerTransactionService.listTransactions.mockResolvedValue([mockTransaction]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions?offset=10&limit=5`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerTransactionService.listTransactions).toHaveBeenCalledWith(
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
				url: `/api/ledgers/${ledgerIdStr}/transactions`,
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
				url: `/api/ledgers/${ledgerIdStr}/transactions?offset=invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle internal server error", async () => {
			mockLedgerTransactionService.listTransactions.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Get Ledger Transaction", () => {
		it("should return a ledger transaction", async () => {
			mockLedgerTransactionService.getLedgerTransaction.mockResolvedValue(mockTransaction);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerTransactionService.getLedgerTransaction).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "ltr" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerTransactionService.getLedgerTransaction.mockRejectedValue(
				new NotFoundError("Transaction not found")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle internal server error", async () => {
			mockLedgerTransactionService.getLedgerTransaction.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Create Ledger Transaction", () => {
		it("should create a ledger transaction", async () => {
			mockLedgerTransactionService.createTransaction.mockResolvedValue(mockTransaction);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions`,
				payload: {
					description: "Test transaction",
					status: "pending",
					ledgerEntries: [
						{
							id: new TypeID("lte").toString(),
							accountId: new TypeID("lat").toString(),
							direction: "debit",
							amount: 10000,
							currency: "USD",
							currencyExponent: 2,
							status: "pending",
						},
						{
							id: new TypeID("lte").toString(),
							accountId: new TypeID("lat").toString(),
							direction: "credit",
							amount: 10000,
							currency: "USD",
							currencyExponent: 2,
							status: "pending",
						},
					],
					created: new Date().toISOString(),
					updated: new Date().toISOString(),
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerTransactionService.createTransaction).toHaveBeenCalled();
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/transactions`,
				payload: {
					description: "Test transaction",
					status: "pending",
					ledgerEntries: [],
					created: new Date().toISOString(),
					updated: new Date().toISOString(),
				},
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions`,
				payload: { foo: "bar" },
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerTransactionService.createTransaction.mockRejectedValue(
				new ConflictError({ message: "Transaction already exists" })
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions`,
				payload: {
					description: "Test transaction",
					status: "pending",
					ledgerEntries: [
						{
							id: new TypeID("lte").toString(),
							accountId: new TypeID("lat").toString(),
							direction: "debit",
							amount: 10000,
							currency: "USD",
							currencyExponent: 2,
							status: "pending",
						},
						{
							id: new TypeID("lte").toString(),
							accountId: new TypeID("lat").toString(),
							direction: "credit",
							amount: 10000,
							currency: "USD",
							currencyExponent: 2,
							status: "pending",
						},
					],
					created: new Date().toISOString(),
					updated: new Date().toISOString(),
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle forbidden error with readonly scope", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions`,
				payload: {
					description: "Test transaction",
					status: "pending",
					ledgerEntries: [
						{
							id: new TypeID("lte").toString(),
							accountId: new TypeID("lat").toString(),
							direction: "debit",
							amount: 10000,
							currency: "USD",
							currencyExponent: 2,
							status: "pending",
						},
						{
							id: new TypeID("lte").toString(),
							accountId: new TypeID("lat").toString(),
							direction: "credit",
							amount: 10000,
							currency: "USD",
							currencyExponent: 2,
							status: "pending",
						},
					],
					created: new Date().toISOString(),
					updated: new Date().toISOString(),
				},
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
			expect(response.detail).toEqual("One of: ledger:transaction:write; permissions is required");
		});

		it("should handle internal server error", async () => {
			mockLedgerTransactionService.createTransaction.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions`,
				payload: {
					description: "Test transaction",
					status: "pending",
					ledgerEntries: [
						{
							id: new TypeID("lte").toString(),
							accountId: new TypeID("lat").toString(),
							direction: "debit",
							amount: 10000,
							currency: "USD",
							currencyExponent: 2,
							status: "pending",
						},
						{
							id: new TypeID("lte").toString(),
							accountId: new TypeID("lat").toString(),
							direction: "credit",
							amount: 10000,
							currency: "USD",
							currencyExponent: 2,
							status: "pending",
						},
					],
					created: new Date().toISOString(),
					updated: new Date().toISOString(),
				},
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Post Ledger Transaction", () => {
		it("should post a pending transaction", async () => {
			const postedTransaction = createLedgerTransactionFixture({
				id: transactionId,
				organizationId: orgId,
				ledgerId,
				description: "Test transaction",
				status: "posted",
				created: fixedDate,
				updated: fixedDate,
				effectiveAt: fixedDate,
			});
			mockLedgerTransactionService.postTransaction.mockResolvedValue(postedTransaction);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}/post`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toMatchSnapshot();
			expect(mockLedgerTransactionService.postTransaction).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "ltr" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerTransactionService.postTransaction.mockRejectedValue(
				new NotFoundError("Transaction not found")
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}/post`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}/post`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle conflict error when transaction is archived", async () => {
			mockLedgerTransactionService.postTransaction.mockRejectedValue(
				new ConflictError({ message: "Cannot post an archived transaction" })
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}/post`,
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle forbidden error with readonly scope", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}/post`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
			expect(response.detail).toEqual("One of: ledger:transaction:write; permissions is required");
		});

		it("should handle internal server error", async () => {
			mockLedgerTransactionService.postTransaction.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}/post`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});

	describe("Delete Ledger Transaction", () => {
		it("should delete a ledger transaction", async () => {
			mockLedgerTransactionService.deleteTransaction.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerTransactionService.deleteTransaction).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "ltr" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerTransactionService.deleteTransaction.mockRejectedValue(
				new NotFoundError("Transaction not found")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle unauthorized error", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should handle conflict error for posted transactions in production", async () => {
			mockLedgerTransactionService.deleteTransaction.mockRejectedValue(
				new ConflictError({
					message: "Cannot delete a posted transaction outside of test environment",
				})
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should handle forbidden error with readonly scope", async () => {
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
			expect(response.detail).toEqual("One of: ledger:transaction:delete; permissions is required");
		});

		it("should handle internal server error", async () => {
			mockLedgerTransactionService.deleteTransaction.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/transactions/${transactionIdStr}`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
		});
	});
});
