import type { FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signJWT } from "@/auth";
import { ConflictError, NotFoundError } from "@/errors";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID } from "@/repo/entities/types";
import { buildServer } from "@/server";
import type { LedgerAccountCategoryService } from "@/services";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	ForbiddenErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
	UnauthorizedErrorResponse,
} from "../schema";
import { createLedgerAccountCategoryFixture } from "./fixtures";

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
	const ledgerId = new TypeID("lgr") as LedgerID;
	const ledgerIdStr = ledgerId.toString();
	const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
	const categoryIdStr = categoryId.toString();
	const mockCategory = createLedgerAccountCategoryFixture({ ledgerId, id: categoryId });
	const orgId = "org_01h2x9z3y5k8m6n4p0q1r2s3t4";
	const token = signJWT({ sub: orgId, scope: ["super_admin"] });
	const tokenReadOnly = signJWT({ sub: orgId, scope: ["org_readonly"] });

	beforeAll(async () => {
		server = await buildServer({
			servicePluginOpts: {
				services: { ledgerAccountCategoryService: mockLedgerAccountCategoryService },
			},
		});
	});

	afterAll(async () => {
		await server.close();
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("List Ledger Account Categories", () => {
		it("should return a list of categories", async () => {
			mockLedgerAccountCategoryService.listLedgerAccountCategories.mockResolvedValue([mockCategory]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([mockCategory.toResponse()]);
			expect(mockLedgerAccountCategoryService.listLedgerAccountCategories).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				0,
				20
			);
		});

		it("should return a list with pagination", async () => {
			mockLedgerAccountCategoryService.listLedgerAccountCategories.mockResolvedValue([mockCategory]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories?offset=10&limit=5`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountCategoryService.listLedgerAccountCategories).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				10,
				5
			);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountCategoryService.listLedgerAccountCategories.mockRejectedValue(
				new Error("Internal Server Error")
			);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
			});

			expect(rs.statusCode).toBe(500);
			const response: InternalServerErrorResponse = rs.json();
			expect(response.status).toEqual(500);
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
			const rs = await server.inject({
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
			mockLedgerAccountCategoryService.getLedgerAccountCategory.mockResolvedValue(mockCategory);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(mockCategory.toResponse());
			expect(mockLedgerAccountCategoryService.getLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.getLedgerAccountCategory.mockRejectedValue(
				new NotFoundError("Category not found")
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
			const rs = await server.inject({
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
			mockLedgerAccountCategoryService.createLedgerAccountCategory.mockResolvedValue(mockCategory);

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
				ledgerIdStr,
				expect.objectContaining({
					name: "Assets",
					description: "Asset accounts",
					normalBalance: "debit",
				})
			);
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
			mockLedgerAccountCategoryService.createLedgerAccountCategory.mockRejectedValue(
				new ConflictError({ message: "Category already exists" })
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
			const rs = await server.inject({
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
			const rs = await server.inject({
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
			mockLedgerAccountCategoryService.updateLedgerAccountCategory.mockResolvedValue(updatedCategory);

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
				ledgerIdStr,
				categoryIdStr,
				expect.objectContaining({
					name: "Updated Assets",
					description: "Updated description",
					normalBalance: "debit",
				})
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.updateLedgerAccountCategory.mockRejectedValue(
				new NotFoundError("Category not found")
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
			const rs = await server.inject({
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
			const rs = await server.inject({
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
			mockLedgerAccountCategoryService.deleteLedgerAccountCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountCategoryService.deleteLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.deleteLedgerAccountCategory.mockRejectedValue(
				new NotFoundError("Category not found")
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
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await server.inject({
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
			mockLedgerAccountCategoryService.linkLedgerAccountToCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountCategoryService.linkLedgerAccountToCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lat" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.linkLedgerAccountToCategory.mockRejectedValue(
				new NotFoundError("Account not found")
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
			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await server.inject({
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
			mockLedgerAccountCategoryService.unlinkLedgerAccountToCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountCategoryService.unlinkLedgerAccountToCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lat" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.unlinkLedgerAccountToCategory.mockRejectedValue(
				new NotFoundError("Link not found")
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
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await server.inject({
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
			mockLedgerAccountCategoryService.linkLedgerAccountCategoryToCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountCategoryService.linkLedgerAccountCategoryToCategory
			).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.linkLedgerAccountCategoryToCategory.mockRejectedValue(
				new NotFoundError("Parent category not found")
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
			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await server.inject({
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
			mockLedgerAccountCategoryService.unlinkLedgerAccountCategoryToCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(
				mockLedgerAccountCategoryService.unlinkLedgerAccountCategoryToCategory
			).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountCategoryService.unlinkLedgerAccountCategoryToCategory.mockRejectedValue(
				new NotFoundError("Link not found")
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
			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: "Bearer invalid_token" },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(401);
			const response: UnauthorizedErrorResponse = rs.json();
			expect(response.status).toEqual(401);
		});

		it("should return 403 for insufficient permissions", async () => {
			const rs = await server.inject({
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
