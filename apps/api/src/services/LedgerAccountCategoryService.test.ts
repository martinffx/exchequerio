import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { LedgerAccountCategoryEntity } from "@/repo/entities/LedgerAccountCategoryEntity";
import type {
	LedgerAccountCategoryID,
	LedgerAccountID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import type { LedgerAccountCategoryRepo } from "@/repo/LedgerAccountCategoryRepo";
import { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";

describe("LedgerAccountCategoryService", () => {
	const organizationId = new TypeID("org") as OrgID;
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
	const ledgerOwnership = { getLedger: vi.fn().mockResolvedValue(undefined) };
	const service = new LedgerAccountCategoryService(mockRepo, ledgerOwnership);

	afterEach(() => {
		vi.clearAllMocks();
		ledgerOwnership.getLedger.mockResolvedValue(undefined);
	});

	describe("listLedgerAccountCategories", () => {
		it("should return list of categories", async () => {
			const mockCategories = [
				new LedgerAccountCategoryEntity({
					id: categoryId,
					organizationId,
					ledgerId,
					name: "Assets",
					normalBalance: "debit",
					created: new Date(),
					updated: new Date(),
				}),
			];

			mockRepo.listLedgerAccountCategories.mockResolvedValue(mockCategories);

			const result = await service.listLedgerAccountCategories(organizationId, ledgerId, 0, 50);

			expect(result).toEqual(mockCategories);
			expect(mockRepo.listLedgerAccountCategories).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				0,
				50
			);
			expect(mockRepo.listLedgerAccountCategories).toHaveBeenCalledTimes(1);
		});

		it("should handle pagination parameters", async () => {
			mockRepo.listLedgerAccountCategories.mockResolvedValue([]);

			await service.listLedgerAccountCategories(organizationId, ledgerId, 10, 20);

			expect(mockRepo.listLedgerAccountCategories).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				10,
				20
			);
		});
	});

	describe("getLedgerAccountCategory", () => {
		it("should return category when found", async () => {
			const mockCategory = new LedgerAccountCategoryEntity({
				id: categoryId,
				organizationId,
				ledgerId,
				name: "Assets",
				normalBalance: "debit" as const,
				created: new Date(),
				updated: new Date(),
			});

			mockRepo.getLedgerAccountCategory.mockResolvedValue(mockCategory);

			const result = await service.getLedgerAccountCategory(organizationId, ledgerId, categoryId);

			expect(result).toEqual(mockCategory);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId
			);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Category not found: ${categoryId.toString()}`);
			mockRepo.getLedgerAccountCategory.mockRejectedValue(error);

			await expect(
				service.getLedgerAccountCategory(organizationId, ledgerId, categoryId)
			).rejects.toThrow(NotFoundError);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId
			);
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
				organizationId,
				ledgerId,
				name: "Assets",
				normalBalance: "debit" as const,
				created: new Date(),
				updated: new Date(),
			});

			mockRepo.upsertLedgerAccountCategory.mockResolvedValue(category);

			const result = await service.createLedgerAccountCategory(
				organizationId,
				ledgerId.toString(),
				request
			);

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
				organizationId,
				ledgerId,
				name: "Assets",
				normalBalance: "debit" as const,
				created: new Date(),
				updated: new Date(),
			});

			const updatedCategory = new LedgerAccountCategoryEntity({
				id: categoryId,
				organizationId,
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
				organizationId,
				ledgerId.toString(),
				categoryId.toString(),
				request
			);

			expect(result).toEqual(updatedCategory);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledBefore(
				mockRepo.upsertLedgerAccountCategory
			);
			expect(mockRepo.upsertLedgerAccountCategory).toHaveBeenCalledWith(
				expect.objectContaining({
					id: categoryId,
					name: "Updated Assets",
					description: "Updated description",
				})
			);
		});

		it("should allow an update to recreate a category deleted after the existence read", async () => {
			const request = { name: "Recreated", normalBalance: "credit" as const };
			let stored: LedgerAccountCategoryEntity | undefined = new LedgerAccountCategoryEntity({
				id: categoryId,
				organizationId,
				ledgerId,
				name: "Existing",
				normalBalance: "debit",
				created: new Date(),
				updated: new Date(),
			});
			mockRepo.getLedgerAccountCategory.mockImplementation(async () => {
				const existing = stored as LedgerAccountCategoryEntity;
				stored = undefined;
				return existing;
			});
			mockRepo.upsertLedgerAccountCategory.mockImplementation(async entity => {
				stored = entity;
				return entity;
			});

			const result = await service.updateLedgerAccountCategory(
				organizationId,
				ledgerId.toString(),
				categoryId.toString(),
				request
			);

			expect(result).toBe(stored);
			expect(result.name).toBe("Recreated");
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledBefore(
				mockRepo.upsertLedgerAccountCategory
			);
		});

		it("should propagate the original upsert failure object", async () => {
			const failure = new Error("database unavailable");
			mockRepo.getLedgerAccountCategory.mockResolvedValue({} as LedgerAccountCategoryEntity);
			mockRepo.upsertLedgerAccountCategory.mockRejectedValue(failure);

			await expect(
				service.updateLedgerAccountCategory(
					organizationId,
					ledgerId.toString(),
					categoryId.toString(),
					{
						name: "Assets",
						normalBalance: "debit",
					}
				)
			).rejects.toBe(failure);
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
				service.updateLedgerAccountCategory(
					organizationId,
					ledgerId.toString(),
					categoryId.toString(),
					request
				)
			).rejects.toThrow(NotFoundError);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalled();
			expect(mockRepo.upsertLedgerAccountCategory).not.toHaveBeenCalled();
		});
	});

	describe("deleteLedgerAccountCategory", () => {
		it("should delete category", async () => {
			mockRepo.deleteLedgerAccountCategory.mockResolvedValue();

			await service.deleteLedgerAccountCategory(organizationId, ledgerId, categoryId);

			expect(mockRepo.deleteLedgerAccountCategory).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId
			);
			expect(mockRepo.deleteLedgerAccountCategory).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Category not found: ${categoryId.toString()}`);
			mockRepo.deleteLedgerAccountCategory.mockRejectedValue(error);

			await expect(
				service.deleteLedgerAccountCategory(organizationId, ledgerId, categoryId)
			).rejects.toThrow(NotFoundError);
			expect(mockRepo.deleteLedgerAccountCategory).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId
			);
		});
	});

	describe("linkLedgerAccountToCategory", () => {
		it("should link account to category", async () => {
			mockRepo.linkAccountToCategory.mockResolvedValue();

			await service.linkLedgerAccountToCategory(organizationId, ledgerId, categoryId, accountId);

			expect(mockRepo.linkAccountToCategory).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId,
				accountId
			);
			expect(mockRepo.linkAccountToCategory).toHaveBeenCalledTimes(1);
		});
	});

	describe("unlinkLedgerAccountToCategory", () => {
		it("should unlink account from category", async () => {
			mockRepo.unlinkAccountFromCategory.mockResolvedValue();

			await service.unlinkLedgerAccountToCategory(organizationId, ledgerId, categoryId, accountId);

			expect(mockRepo.unlinkAccountFromCategory).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId,
				accountId
			);
			expect(mockRepo.unlinkAccountFromCategory).toHaveBeenCalledTimes(1);
		});
	});

	describe("linkLedgerAccountCategoryToCategory", () => {
		it("should link category to parent category", async () => {
			mockRepo.linkCategoryToParent.mockResolvedValue();

			await service.linkLedgerAccountCategoryToCategory(
				organizationId,
				ledgerId,
				categoryId,
				parentCategoryId
			);

			expect(mockRepo.linkCategoryToParent).toHaveBeenCalledWith(
				organizationId,
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

			await service.unlinkLedgerAccountCategoryToCategory(
				organizationId,
				ledgerId,
				categoryId,
				parentCategoryId
			);

			expect(mockRepo.unlinkCategoryFromParent).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId,
				parentCategoryId
			);
			expect(mockRepo.unlinkCategoryFromParent).toHaveBeenCalledTimes(1);
		});
	});

	describe("Ledger ownership", () => {
		const operations = [
			() => service.listLedgerAccountCategories(organizationId, ledgerId, 0, 20),
			() => service.getLedgerAccountCategory(organizationId, ledgerId, categoryId),
			() =>
				service.createLedgerAccountCategory(organizationId, ledgerId.toString(), {
					name: "Assets",
					normalBalance: "debit",
				}),
			() =>
				service.updateLedgerAccountCategory(
					organizationId,
					ledgerId.toString(),
					categoryId.toString(),
					{ name: "Assets", normalBalance: "debit" }
				),
			() => service.deleteLedgerAccountCategory(organizationId, ledgerId, categoryId),
			() => service.linkLedgerAccountToCategory(organizationId, ledgerId, categoryId, accountId),
			() => service.unlinkLedgerAccountToCategory(organizationId, ledgerId, categoryId, accountId),
			() =>
				service.linkLedgerAccountCategoryToCategory(
					organizationId,
					ledgerId,
					categoryId,
					parentCategoryId
				),
			() =>
				service.unlinkLedgerAccountCategoryToCategory(
					organizationId,
					ledgerId,
					categoryId,
					parentCategoryId
				),
		] as const;

		it.each(operations)(
			"validates the Organization-owned Ledger before repository work",
			async operation => {
				const failure = new Error("Ledger not found");
				ledgerOwnership.getLedger.mockRejectedValueOnce(failure);

				await expect(operation()).rejects.toBe(failure);
				expect(mockRepo.listLedgerAccountCategories).not.toHaveBeenCalled();
				expect(mockRepo.getLedgerAccountCategory).not.toHaveBeenCalled();
				expect(mockRepo.upsertLedgerAccountCategory).not.toHaveBeenCalled();
				expect(mockRepo.deleteLedgerAccountCategory).not.toHaveBeenCalled();
				expect(mockRepo.linkAccountToCategory).not.toHaveBeenCalled();
				expect(mockRepo.unlinkAccountFromCategory).not.toHaveBeenCalled();
				expect(mockRepo.linkCategoryToParent).not.toHaveBeenCalled();
				expect(mockRepo.unlinkCategoryFromParent).not.toHaveBeenCalled();
			}
		);
	});
});
