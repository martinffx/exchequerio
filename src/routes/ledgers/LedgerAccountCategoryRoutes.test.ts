import type { FastifyInstance } from "fastify";
import { TypeID } from "typeid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signJWT } from "@/auth";
import { ConflictError, NotFoundError } from "@/errors";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID } from "@/repo/entities/types";
import { buildServer } from "@/server";
import { LedgerAccountCategoryEntity, type LedgerAccountService } from "@/services";
import type {
	BadRequestErrorResponse,
	ConflictErrorResponse,
	InternalServerErrorResponse,
	NotFoundErrorResponse,
} from "../schema";
import { createLedgerAccountCategoryFixture } from "./fixtures";

const mockLedgerAccountService = vi.mocked<LedgerAccountService>({
	listLedgerAccountCategories: vi.fn(),
	getLedgerAccountCategory: vi.fn(),
	createLedgerAccountCategory: vi.fn(),
	updateLedgerAccountCategory: vi.fn(),
	deleteLedgerAccountCategory: vi.fn(),
	linkLedgerAccountToCategory: vi.fn(),
	unlinkLedgerAccountToCategory: vi.fn(),
	linkLedgerAccountCategoryToCategory: vi.fn(),
	unlinkLedgerAccountCategoryToCategory: vi.fn(),
} as unknown as LedgerAccountService);

describe("LedgerAccountCategoryRoutes", () => {
	let server: FastifyInstance;
	const ledgerId = new TypeID("lgr") as LedgerID;
	const ledgerIdStr = ledgerId.toString();
	const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
	const categoryIdStr = categoryId.toString();
	const mockCategory = createLedgerAccountCategoryFixture({ ledgerId, id: categoryId });
	const token = signJWT({ sub: "org_01h2x9z3y5k8m6n4p0q1r2s3t4", scope: ["super_admin"] });

	beforeAll(async () => {
		server = await buildServer({
			servicePluginOpts: {
				services: { ledgerAccountService: mockLedgerAccountService },
			},
		});
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("List Ledger Account Categories", () => {
		it("should return a list of categories", async () => {
			mockLedgerAccountService.listLedgerAccountCategories.mockResolvedValue([mockCategory]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual([mockCategory.toResponse()]);
			expect(mockLedgerAccountService.listLedgerAccountCategories).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				0,
				20
			);
		});

		it("should return a list with pagination", async () => {
			mockLedgerAccountService.listLedgerAccountCategories.mockResolvedValue([mockCategory]);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories?offset=10&limit=5`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountService.listLedgerAccountCategories).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				10,
				5
			);
		});

		it("should handle internal server error", async () => {
			mockLedgerAccountService.listLedgerAccountCategories.mockRejectedValue(
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
	});

	describe("Get Ledger Account Category", () => {
		it("should return a category", async () => {
			mockLedgerAccountService.getLedgerAccountCategory.mockResolvedValue(mockCategory);

			const rs = await server.inject({
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(rs.json()).toEqual(mockCategory.toResponse());
			expect(mockLedgerAccountService.getLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountService.getLedgerAccountCategory.mockRejectedValue(
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
	});

	describe("Create Ledger Account Category", () => {
		it("should create a category", async () => {
			mockLedgerAccountService.createLedgerAccountCategory.mockResolvedValue(mockCategory);

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
			expect(mockLedgerAccountService.createLedgerAccountCategory).toHaveBeenCalledWith(
				expect.any(LedgerAccountCategoryEntity)
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
			mockLedgerAccountService.createLedgerAccountCategory.mockRejectedValue(
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
	});

	describe("Update Ledger Account Category", () => {
		it("should update a category", async () => {
			const updatedCategory = createLedgerAccountCategoryFixture({
				ledgerId,
				id: categoryId,
				name: "Updated Assets",
			});
			mockLedgerAccountService.updateLedgerAccountCategory.mockResolvedValue(updatedCategory);

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
			expect(mockLedgerAccountService.updateLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.any(LedgerAccountCategoryEntity)
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountService.updateLedgerAccountCategory.mockRejectedValue(
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
	});

	describe("Delete Ledger Account Category", () => {
		it("should delete a category", async () => {
			mockLedgerAccountService.deleteLedgerAccountCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountService.deleteLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountService.deleteLedgerAccountCategory.mockRejectedValue(
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
	});

	describe("Link Ledger Account to Category", () => {
		const accountId = new TypeID("lat") as LedgerAccountID;
		const accountIdStr = accountId.toString();

		it("should link an account to a category", async () => {
			mockLedgerAccountService.linkLedgerAccountToCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountService.linkLedgerAccountToCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lat" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountService.linkLedgerAccountToCategory.mockRejectedValue(
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
	});

	describe("Unlink Ledger Account from Category", () => {
		const accountId = new TypeID("lat") as LedgerAccountID;
		const accountIdStr = accountId.toString();

		it("should unlink an account from a category", async () => {
			mockLedgerAccountService.unlinkLedgerAccountToCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/accounts/${accountIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountService.unlinkLedgerAccountToCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lat" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountService.unlinkLedgerAccountToCategory.mockRejectedValue(
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
	});

	describe("Link Ledger Account Category to Category", () => {
		const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
		const parentCategoryIdStr = parentCategoryId.toString();

		it("should link a category to a parent category", async () => {
			mockLedgerAccountService.linkLedgerAccountCategoryToCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountService.linkLedgerAccountCategoryToCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountService.linkLedgerAccountCategoryToCategory.mockRejectedValue(
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
	});

	describe("Unlink Ledger Account Category from Category", () => {
		const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
		const parentCategoryIdStr = parentCategoryId.toString();

		it("should unlink a category from a parent category", async () => {
			mockLedgerAccountService.unlinkLedgerAccountCategoryToCategory.mockResolvedValue();

			const rs = await server.inject({
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
				url: `/api/ledgers/${ledgerIdStr}/accounts/categories/${categoryIdStr}/categories/${parentCategoryIdStr}`,
			});

			expect(rs.statusCode).toBe(200);
			expect(mockLedgerAccountService.unlinkLedgerAccountCategoryToCategory).toHaveBeenCalledWith(
				expect.objectContaining({ prefix: "lgr" }),
				expect.objectContaining({ prefix: "lac" }),
				expect.objectContaining({ prefix: "lac" })
			);
		});

		it("should handle not found error", async () => {
			mockLedgerAccountService.unlinkLedgerAccountCategoryToCategory.mockRejectedValue(
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
	});
});
