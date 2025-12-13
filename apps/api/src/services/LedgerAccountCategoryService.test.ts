import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/errors";
import { LedgerAccountCategoryEntity } from "@/repo/entities/LedgerAccountCategoryEntity";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID } from "@/repo/entities/types";
import type { LedgerAccountCategoryRepo } from "@/repo/LedgerAccountCategoryRepo";
import { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";

describe("LedgerAccountCategoryService", () => {
	const ledgerId = new TypeID("lgr") as LedgerID;
	const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
	const accountId = new TypeID("lat") as LedgerAccountID;
	const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
	const mockRepo = vi.mocked<LedgerAccountCategoryRepo>({
		listLedgerAccountCategories: vi.fn(),
		getLedgerAccountCategory: vi.fn(),
		upsertLedgerAccountCategory: vi.fn(),
		deleteLedgerAccountCategory: vi.fn(),
		linkAccountToCategory: vi.fn(),
		unlinkAccountFromCategory: vi.fn(),
		linkCategoryToParent: vi.fn(),
		unlinkCategoryFromParent: vi.fn(),
	} as unknown as LedgerAccountCategoryRepo);
	const service = new LedgerAccountCategoryService(mockRepo);

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("listLedgerAccountCategories", () => {
		it("should return list of categories", async () => {
			const mockCategories = [
				new LedgerAccountCategoryEntity({
					id: categoryId,
					ledgerId,
					name: "Assets",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				}),
			];

			mockRepo.listLedgerAccountCategories.mockResolvedValue(mockCategories);

			const result = await service.listLedgerAccountCategories(ledgerId, 0, 50);

			expect(result).toEqual(mockCategories);
			expect(mockRepo.listLedgerAccountCategories).toHaveBeenCalledWith(ledgerId, 0, 50);
			expect(mockRepo.listLedgerAccountCategories).toHaveBeenCalledTimes(1);
		});

		it("should handle pagination parameters", async () => {
			mockRepo.listLedgerAccountCategories.mockResolvedValue([]);

			await service.listLedgerAccountCategories(ledgerId, 10, 20);

			expect(mockRepo.listLedgerAccountCategories).toHaveBeenCalledWith(ledgerId, 10, 20);
		});
	});

	describe("getLedgerAccountCategory", () => {
		it("should return category when found", async () => {
			const mockCategory = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId,
				name: "Assets",
				normalBalance: "debit" as const,
				created: new Date(),
				updated: new Date(),
			});

			mockRepo.getLedgerAccountCategory.mockResolvedValue(mockCategory);

			const result = await service.getLedgerAccountCategory(ledgerId, categoryId);

			expect(result).toEqual(mockCategory);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledWith(ledgerId, categoryId);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Category not found: ${categoryId.toString()}`);
			mockRepo.getLedgerAccountCategory.mockRejectedValue(error);

			await expect(service.getLedgerAccountCategory(ledgerId, categoryId)).rejects.toThrow(
				NotFoundError
			);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledWith(ledgerId, categoryId);
		});
	});

	describe("createLedgerAccountCategory", () => {
		it("should create category", async () => {
			const request = {
				name: "Assets",
				normalBalance: "debit" as const,
				description: undefined,
				metadata: {},
			};

			const category = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId,
				name: "Assets",
				normalBalance: "debit" as const,
				created: new Date(),
				updated: new Date(),
			});

			mockRepo.upsertLedgerAccountCategory.mockResolvedValue(category);

			const result = await service.createLedgerAccountCategory(ledgerId.toString(), request);

			expect(result).toEqual(category);
			expect(mockRepo.upsertLedgerAccountCategory).toHaveBeenCalled();
			expect(mockRepo.upsertLedgerAccountCategory).toHaveBeenCalledTimes(1);
		});
	});

	describe("updateLedgerAccountCategory", () => {
		it("should verify category exists then update", async () => {
			const request = {
				name: "Updated Assets",
				normalBalance: "debit" as const,
				description: "Updated description",
				metadata: {},
			};

			const existingCategory = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId,
				name: "Assets",
				normalBalance: "debit" as const,
				created: new Date(),
				updated: new Date(),
			});

			const updatedCategory = new LedgerAccountCategoryEntity({
				id: categoryId,
				ledgerId,
				name: "Updated Assets",
				normalBalance: "debit" as const,
				description: "Updated description",
				created: existingCategory.created,
				updated: new Date(),
			});

			mockRepo.getLedgerAccountCategory.mockResolvedValue(existingCategory);
			mockRepo.upsertLedgerAccountCategory.mockResolvedValue(updatedCategory);

			const result = await service.updateLedgerAccountCategory(
				ledgerId.toString(),
				categoryId.toString(),
				request
			);

			expect(result).toEqual(updatedCategory);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalled();
			expect(mockRepo.upsertLedgerAccountCategory).toHaveBeenCalled();
		});

		it("should propagate NotFoundError if category does not exist", async () => {
			const request = {
				name: "Assets",
				normalBalance: "debit" as const,
				description: undefined,
				metadata: {},
			};

			const error = new NotFoundError(`Category not found: ${categoryId.toString()}`);
			mockRepo.getLedgerAccountCategory.mockRejectedValue(error);

			await expect(
				service.updateLedgerAccountCategory(ledgerId.toString(), categoryId.toString(), request)
			).rejects.toThrow(NotFoundError);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalled();
			expect(mockRepo.upsertLedgerAccountCategory).not.toHaveBeenCalled();
		});
	});

	describe("deleteLedgerAccountCategory", () => {
		it("should delete category", async () => {
			mockRepo.deleteLedgerAccountCategory.mockResolvedValue();

			await service.deleteLedgerAccountCategory(ledgerId, categoryId);

			expect(mockRepo.deleteLedgerAccountCategory).toHaveBeenCalledWith(ledgerId, categoryId);
			expect(mockRepo.deleteLedgerAccountCategory).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Category not found: ${categoryId.toString()}`);
			mockRepo.deleteLedgerAccountCategory.mockRejectedValue(error);

			await expect(service.deleteLedgerAccountCategory(ledgerId, categoryId)).rejects.toThrow(
				NotFoundError
			);
			expect(mockRepo.deleteLedgerAccountCategory).toHaveBeenCalledWith(ledgerId, categoryId);
		});
	});

	describe("linkLedgerAccountToCategory", () => {
		it("should link account to category", async () => {
			mockRepo.linkAccountToCategory.mockResolvedValue();

			await service.linkLedgerAccountToCategory(ledgerId, categoryId, accountId);

			expect(mockRepo.linkAccountToCategory).toHaveBeenCalledWith(ledgerId, categoryId, accountId);
			expect(mockRepo.linkAccountToCategory).toHaveBeenCalledTimes(1);
		});
	});

	describe("unlinkLedgerAccountToCategory", () => {
		it("should unlink account from category", async () => {
			mockRepo.unlinkAccountFromCategory.mockResolvedValue();

			await service.unlinkLedgerAccountToCategory(ledgerId, categoryId, accountId);

			expect(mockRepo.unlinkAccountFromCategory).toHaveBeenCalledWith(ledgerId, categoryId, accountId);
			expect(mockRepo.unlinkAccountFromCategory).toHaveBeenCalledTimes(1);
		});
	});

	describe("linkLedgerAccountCategoryToCategory", () => {
		it("should link category to parent category", async () => {
			mockRepo.linkCategoryToParent.mockResolvedValue();

			await service.linkLedgerAccountCategoryToCategory(ledgerId, categoryId, parentCategoryId);

			expect(mockRepo.linkCategoryToParent).toHaveBeenCalledWith(
				ledgerId,
				categoryId,
				parentCategoryId
			);
			expect(mockRepo.linkCategoryToParent).toHaveBeenCalledTimes(1);
		});
	});

	describe("unlinkLedgerAccountCategoryToCategory", () => {
		it("should unlink category from parent category", async () => {
			mockRepo.unlinkCategoryFromParent.mockResolvedValue();

			await service.unlinkLedgerAccountCategoryToCategory(ledgerId, categoryId, parentCategoryId);

			expect(mockRepo.unlinkCategoryFromParent).toHaveBeenCalledWith(
				ledgerId,
				categoryId,
				parentCategoryId
			);
			expect(mockRepo.unlinkCategoryFromParent).toHaveBeenCalledTimes(1);
		});
	});
});
