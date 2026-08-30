import fastify, { type FastifyInstance } from "fastify";
import { Effect, Layer } from "effect";
import { TypeID } from "typeid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signJWT } from "@/auth";
import { LedgerNotFound } from "@/domains/ledgers/LedgerErrors";
import { ConflictError, globalErrorHandler, NotFoundError } from "@/lib/errors";
import {
	CategoryPersistenceFailure,
	CategoryRepositoryUnavailable,
} from "@/repo/LedgerAccountCategoryErrors";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID } from "@/repo/entities/types";
import type { OrgID } from "@/repo/entities/types";
import { buildServer } from "@/server";
import { ServerRuntime } from "@/runtime";
import {
	type LedgerAccountCategoryService,
	LedgerAccountCategoryServiceTag,
} from "@/services/LedgerAccountCategoryService";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "@/lib/errors";
import { createLedgerAccountCategoryFixture } from "./fixtures";
import { LedgerAccountCategoryRoutes } from "./LedgerAccountCategoryRoutes";

const mockLedgerAccountCategoryService = vi.mocked<LedgerAccountCategoryService>({
	listLedgerAccountCategories: vi.fn(),
	getLedgerAccountCategory: vi.fn(),
	createLedgerAccountCategory: vi.fn(),
	updateLedgerAccountCategory: vi.fn(),
	deleteLedgerAccountCategory: vi.fn(),
	linkLedgerAccountToCategory: vi.fn(),
	unlinkLedgerAccountToCategory: vi.fn(),
	linkLedgerAccountCategoryToCategory: vi.fn(),
	unlinkLedgerAccountCategoryToCategory: vi.fn(),
} as unknown as LedgerAccountCategoryService);

describe("LedgerAccountCategoryRoutes", () => {
	let server: FastifyInstance;
	let authServer: FastifyInstance;
	let runtime: ServerRuntime<LedgerAccountCategoryService, never>;
	const ledgerId = new TypeID("lgr") as LedgerID;
	const ledgerIdStr = ledgerId.toString();
	const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
	const categoryIdStr = categoryId.toString();
	const mockCategory = createLedgerAccountCategoryFixture({ ledgerId, id: categoryId });
	const orgId = "org_01h2x9z3y5k8m6n4p0q1r2s3t4";
	const token = signJWT({ sub: orgId, scope: ["super_admin"] });
	const tokenReadOnly = signJWT({ sub: orgId, scope: ["org_readonly"] });

	beforeAll(async () => {
		server = fastify();
		server.setErrorHandler(globalErrorHandler);
		runtime = new ServerRuntime(
			Layer.succeed(LedgerAccountCategoryServiceTag, mockLedgerAccountCategoryService)
		);
		server.decorate("runtime", runtime as never);
		server.decorateRequest("token");
		server.addHook("preHandler", async request => {
			request.token = {
				orgId: TypeID.fromString<"org">(orgId) as OrgID,
				organizationId: TypeID.fromString<"org">(orgId) as OrgID,
				permissions: new Set([
					"ledger:account:category:read",
					"ledger:account:category:write",
					"ledger:account:category:delete",
				]),
			} as never;
		});
		server.decorate("hasPermissions", () => async () => undefined);
		await server.register(LedgerAccountCategoryRoutes, {
			prefix: "/api/ledgers/:ledgerId/accounts/categories",
		});
		await server.ready();
		authServer = await buildServer();
	});

	afterAll(async () => {
		await server.close();
		await runtime.dispose();
		await authServer.close();
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("List Ledger Account Categories", () => {
		it("should return a list of categories", async () => {
			mockLedgerAccountCategoryService.listLedgerAccountCategories.mockReturnValue(
				Effect.succeed([mockCategory])
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([mockCategory.toResponse()]);
			expect(mockLedgerAccountCategoryService.listLedgerAccountCategories).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				0,
				20
			);
		});

		it("should return a list with pagination", async () => {
			mockLedgerAccountCategoryService.listLedgerAccountCategories.mockReturnValue(
				Effect.succeed([mockCategory])
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories?offset=10&limit=5`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountCategoryService.listLedgerAccountCategories).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				10,
				5
			);
		});

		it("should return service unavailable when the Category repository is unavailable", async () => {
			mockLedgerAccountCategoryService.listLedgerAccountCategories.mockReturnValue(
				Effect.fail(new CategoryRepositoryUnavailable(new Error("connect ECONNREFUSED")))
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
			});

			expect(rs.statusCode).toBe(503);
			expect(rs.json()).toMatchObject({ status: 503 });
		});

		it("should return an internal server error for a typed Category persistence failure", async () => {
			mockLedgerAccountCategoryService.listLedgerAccountCategories.mockReturnValue(
				Effect.fail(new CategoryPersistenceFailure(new Error("unexpected database failure")))
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
			});

			expect(rs.statusCode).toBe(500);
			expect(rs.json()).toMatchObject({ status: 500 });
		});

		it("should return 404 when the Ledger is not owned by the token Organization", async () => {
			mockLedgerAccountCategoryService.listLedgerAccountCategories.mockReturnValue(
				Effect.fail(new LedgerNotFound())
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
			});

			expect(rs.statusCode).toBe(404);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories?offset=invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should return 401 for invalid token", async () => {
			const rs = await authServer.inject({
				method: "GET",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});
	});

	describe("Get Ledger Account Category", () => {
		it("should return a category", async () => {
			mockLedgerAccountCategoryService.getLedgerAccountCategory.mockReturnValue(
				Effect.succeed(mockCategory)
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(mockCategory.toResponse());
			expect(mockLedgerAccountCategoryService.getLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.getLedgerAccountCategory.mockReturnValue(
				Effect.fail(new NotFoundError("Category not found"))
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should return 401 for invalid token", async () => {
			const rs = await authServer.inject({
				method: "GET",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});
	});

	describe("Create Ledger Account Category", () => {
		it("should create a category", async () => {
			mockLedgerAccountCategoryService.createLedgerAccountCategory.mockReturnValue(
				Effect.succeed(mockCategory)
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
				payload: {
					name: "Assets",
					description: "Asset accounts",
					normalBalance: "debit",
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(mockCategory.toResponse());
			expect(mockLedgerAccountCategoryService.createLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({
					name: "Assets",
					description: "Asset accounts",
					normalBalance: "debit",
				})
			);
		});

		it("should return 404 when the Ledger is not owned by the token Organization", async () => {
			mockLedgerAccountCategoryService.createLedgerAccountCategory.mockReturnValue(
				Effect.fail(new LedgerNotFound())
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
				payload: { name: "Assets", normalBalance: "debit" },
			});

			expect(rs.statusCode).toBe(404);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
				payload: {
					name: "Assets",
					// Missing normalBalance
				},
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should handle conflict error", async () => {
			mockLedgerAccountCategoryService.createLedgerAccountCategory.mockReturnValue(
				Effect.fail(new ConflictError("Category already exists"))
			);

			const rs = await server.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
				payload: {
					name: "Assets",
					normalBalance: "debit",
				},
			});

			expect(rs.statusCode).toBe(409);
			const response: ConflictErrorResponse = rs.json();
			expect(response.status).toEqual(409);
		});

		it("should return 401 for invalid token", async () => {
			const rs = await authServer.inject({
				method: "POST",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
				payload: {
					name: "Test",
					normalBalance: "debit",
				},
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await authServer.inject({
				method: "POST",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
				payload: {
					name: "Test",
					normalBalance: "debit",
				},
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});

	describe("Update Ledger Account Category", () => {
		it("should update a category", async () => {
			const updatedCategory = createLedgerAccountCategoryFixture({
				ledgerId,
				id: categoryId,
				name: "Updated Assets",
			});
			mockLedgerAccountCategoryService.updateLedgerAccountCategory.mockReturnValue(
				Effect.succeed(updatedCategory)
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
				payload: {
					name: "Updated Assets",
					description: "Updated description",
					normalBalance: "debit",
				},
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(updatedCategory.toResponse());
			expect(mockLedgerAccountCategoryService.updateLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({
					name: "Updated Assets",
					description: "Updated description",
					normalBalance: "debit",
				})
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.updateLedgerAccountCategory.mockReturnValue(
				Effect.fail(new NotFoundError("Category not found"))
			);

			const rs = await server.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
				payload: {
					name: "Updated Assets",
					normalBalance: "debit",
				},
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should return 401 for invalid token", async () => {
			const rs = await authServer.inject({
				method: "PUT",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
				payload: {
					name: "Test",
					normalBalance: "debit",
				},
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await authServer.inject({
				method: "PUT",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
				payload: {
					name: "Test",
					normalBalance: "debit",
				},
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});

	describe("Delete Ledger Account Category", () => {
		it("should delete a category", async () => {
			mockLedgerAccountCategoryService.deleteLedgerAccountCategory.mockReturnValue(Effect.void);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountCategoryService.deleteLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.deleteLedgerAccountCategory.mockReturnValue(
				Effect.fail(new NotFoundError("Category not found"))
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should return 401 for invalid token", async () => {
			const rs = await authServer.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await authServer.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});

	describe("Link Ledger Account to Category", () => {
		const accountId = new TypeID("lat") as LedgerAccountID;
		const accountIdStr = accountId.toString();

		it("should link an account to a category", async () => {
			mockLedgerAccountCategoryService.linkLedgerAccountToCategory.mockReturnValue(Effect.void);

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountCategoryService.linkLedgerAccountToCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lat" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.linkLedgerAccountToCategory.mockReturnValue(
				Effect.fail(new NotFoundError("Account not found"))
			);

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should handle bad request error", async () => {
			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/invalid`,
			});

			expect(rs.statusCode).toBe(400);
			const response: BadRequestErrorResponse = rs.json();
			expect(response.status).toEqual(400);
		});

		it("should return 401 for invalid token", async () => {
			const rs = await authServer.inject({
				method: "PATCH",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await authServer.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});

	describe("Unlink Ledger Account from Category", () => {
		const accountId = new TypeID("lat") as LedgerAccountID;
		const accountIdStr = accountId.toString();

		it("should unlink an account from a category", async () => {
			mockLedgerAccountCategoryService.unlinkLedgerAccountToCategory.mockReturnValue(Effect.void);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountCategoryService.unlinkLedgerAccountToCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lat" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.unlinkLedgerAccountToCategory.mockReturnValue(
				Effect.fail(new NotFoundError("Link not found"))
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should return 401 for invalid token", async () => {
			const rs = await authServer.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await authServer.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});

	describe("Link Ledger Account Category to Category", () => {
		const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
		const parentCategoryIdStr = parentCategoryId.toString();

		it("should link a category to a parent category", async () => {
			mockLedgerAccountCategoryService.linkLedgerAccountCategoryToCategory.mockReturnValue(
				Effect.void
			);

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountCategoryService.linkLedgerAccountCategoryToCategory
			).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.linkLedgerAccountCategoryToCategory.mockReturnValue(
				Effect.fail(new NotFoundError("Parent category not found"))
			);

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should return 401 for invalid token", async () => {
			const rs = await authServer.inject({
				method: "PATCH",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await authServer.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});

	describe("Unlink Ledger Account Category from Category", () => {
		const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
		const parentCategoryIdStr = parentCategoryId.toString();

		it("should unlink a category from a parent category", async () => {
			mockLedgerAccountCategoryService.unlinkLedgerAccountCategoryToCategory.mockReturnValue(
				Effect.void
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountCategoryService.unlinkLedgerAccountCategoryToCategory
			).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "org" }),
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.unlinkLedgerAccountCategoryToCategory.mockReturnValue(
				Effect.fail(new NotFoundError("Link not found"))
			);

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(404);
			const response: NotFoundErrorResponse = rs.json();
			expect(response.status).toEqual(404);
		});

		it("should return 401 for invalid token", async () => {
			const rs = await authServer.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await authServer.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${tokenReadOnly}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(403);
			const response: ForbiddenErrorResponse = rs.json();
			expect(response.status).toEqual(403);
		});
	});
});
