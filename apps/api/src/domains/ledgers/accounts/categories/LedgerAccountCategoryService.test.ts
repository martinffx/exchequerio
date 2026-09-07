import { TypeID } from "typeid-js";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "@/domains/ledgers/Ledger";
import type { LedgerService } from "@/domains/ledgers/LedgerService";
import { LedgerNotFound } from "@/domains/ledgers/LedgerErrors";
import { LedgerAccountCategoryEntity } from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryEntity";
import {
	CategoryNotFound,
	CategoryPersistenceFailure,
} from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryErrors";
import type { LedgerAccountCategoryID, LedgerAccountID, LedgerID, OrgID } from "@/lib/ids";
import type { LedgerAccountCategoryRepo } from "@/domains/ledgers/accounts/categories/LedgerAccountCategoryRepo";
import { LedgerAccountCategoryService } from "./LedgerAccountCategoryService";

describe("LedgerAccountCategoryService", () => {
	const organizationId = new TypeID("org") as OrgID;
	const ledgerId = new TypeID("lgr") as LedgerID;
	const categoryId = new TypeID("lac") as LedgerAccountCategoryID;
	const accountId = new TypeID("lat") as LedgerAccountID;
	const parentCategoryId = new TypeID("lac") as LedgerAccountCategoryID;
	const ledger = new Ledger({
		id: ledgerId,
		organizationId,
		name: "Ledger",
		created: DateTime.utc(),
		updated: DateTime.utc(),
	});
	const mockRepo = {
		listLedgerAccountCategories: vi.fn<LedgerAccountCategoryRepo["listLedgerAccountCategories"]>(),
		getLedgerAccountCategory: vi.fn<LedgerAccountCategoryRepo["getLedgerAccountCategory"]>(),
		upsertLedgerAccountCategory: vi.fn<LedgerAccountCategoryRepo["upsertLedgerAccountCategory"]>(),
		deleteLedgerAccountCategory: vi.fn<LedgerAccountCategoryRepo["deleteLedgerAccountCategory"]>(),
		linkAccountToCategory: vi.fn<LedgerAccountCategoryRepo["linkAccountToCategory"]>(),
		unlinkAccountFromCategory: vi.fn<LedgerAccountCategoryRepo["unlinkAccountFromCategory"]>(),
		linkCategoryToParent: vi.fn<LedgerAccountCategoryRepo["linkCategoryToParent"]>(),
		unlinkCategoryFromParent: vi.fn<LedgerAccountCategoryRepo["unlinkCategoryFromParent"]>(),
	} satisfies LedgerAccountCategoryRepo;
	const ledgerGet = vi.fn<LedgerService["getLedger"]>(() => Effect.succeed(ledger));
	const service = new LedgerAccountCategoryService(mockRepo, { getLedger: ledgerGet });

	beforeEach(() => {
		vi.resetAllMocks();
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

			mockRepo.listLedgerAccountCategories.mockReturnValue(Effect.succeed(mockCategories));

			const result = await Effect.runPromise(
				service.listLedgerAccountCategories(organizationId, ledgerId, 0, 50)
			);

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
			mockRepo.listLedgerAccountCategories.mockReturnValue(Effect.succeed([]));

			await Effect.runPromise(service.listLedgerAccountCategories(organizationId, ledgerId, 10, 20));

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

			mockRepo.getLedgerAccountCategory.mockReturnValue(Effect.succeed(mockCategory));

			const result = await Effect.runPromise(
				service.getLedgerAccountCategory(organizationId, ledgerId, categoryId)
			);

			expect(result).toEqual(mockCategory);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId
			);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledTimes(1);
		});

		it("should propagate CategoryNotFound from repo", async () => {
			const error = new CategoryNotFound(`Category not found: ${categoryId.toString()}`);
			mockRepo.getLedgerAccountCategory.mockReturnValue(Effect.fail(error));

			await expect(
				Effect.runPromise(service.getLedgerAccountCategory(organizationId, ledgerId, categoryId))
			).rejects.toThrow(CategoryNotFound);
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

			mockRepo.upsertLedgerAccountCategory.mockReturnValue(Effect.succeed(category));

			const result = await Effect.runPromise(
				service.createLedgerAccountCategory(organizationId, ledgerId, request)
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

			mockRepo.getLedgerAccountCategory.mockReturnValue(Effect.succeed(existingCategory));
			mockRepo.upsertLedgerAccountCategory.mockReturnValue(Effect.succeed(updatedCategory));

			const result = await Effect.runPromise(
				service.updateLedgerAccountCategory(organizationId, ledgerId, categoryId, request)
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
			mockRepo.getLedgerAccountCategory.mockImplementation(() =>
				Effect.sync(() => {
					const existing = stored as LedgerAccountCategoryEntity;
					stored = undefined;
					return existing;
				})
			);
			mockRepo.upsertLedgerAccountCategory.mockImplementation(entity =>
				Effect.sync(() => {
					stored = entity;
					return entity;
				})
			);

			const result = await Effect.runPromise(
				service.updateLedgerAccountCategory(organizationId, ledgerId, categoryId, request)
			);

			expect(result).toBe(stored);
			expect(result.name).toBe("Recreated");
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalledBefore(
				mockRepo.upsertLedgerAccountCategory
			);
		});

		it("should propagate the original upsert failure object", async () => {
			const failure = new CategoryPersistenceFailure(new Error("database unavailable"));
			mockRepo.getLedgerAccountCategory.mockReturnValue(
				Effect.succeed({} as LedgerAccountCategoryEntity)
			);
			mockRepo.upsertLedgerAccountCategory.mockReturnValue(Effect.fail(failure));

			await expect(
				Effect.runPromise(
					service.updateLedgerAccountCategory(organizationId, ledgerId, categoryId, {
						name: "Assets",
						normalBalance: "debit",
					})
				)
			).rejects.toBe(failure);
		});

		it("should propagate CategoryNotFound if category does not exist", async () => {
			const request = {
				name: "Assets",
				normalBalance: "debit" as const,
				description: undefined,
				metadata: {},
			};

			const error = new CategoryNotFound(`Category not found: ${categoryId.toString()}`);
			mockRepo.getLedgerAccountCategory.mockReturnValue(Effect.fail(error));

			await expect(
				Effect.runPromise(
					service.updateLedgerAccountCategory(organizationId, ledgerId, categoryId, request)
				)
			).rejects.toThrow(CategoryNotFound);
			expect(mockRepo.getLedgerAccountCategory).toHaveBeenCalled();
			expect(mockRepo.upsertLedgerAccountCategory).not.toHaveBeenCalled();
		});
	});

	describe("deleteLedgerAccountCategory", () => {
		it("should delete category", async () => {
			mockRepo.deleteLedgerAccountCategory.mockReturnValue(Effect.void);

			await Effect.runPromise(
				service.deleteLedgerAccountCategory(organizationId, ledgerId, categoryId)
			);

			expect(mockRepo.deleteLedgerAccountCategory).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId
			);
			expect(mockRepo.deleteLedgerAccountCategory).toHaveBeenCalledTimes(1);
		});

		it("should propagate CategoryNotFound from repo", async () => {
			const error = new CategoryNotFound(`Category not found: ${categoryId.toString()}`);
			mockRepo.deleteLedgerAccountCategory.mockReturnValue(Effect.fail(error));

			await expect(
				Effect.runPromise(service.deleteLedgerAccountCategory(organizationId, ledgerId, categoryId))
			).rejects.toThrow(CategoryNotFound);
			expect(mockRepo.deleteLedgerAccountCategory).toHaveBeenCalledWith(
				organizationId,
				ledgerId,
				categoryId
			);
		});
	});

	describe("linkLedgerAccountToCategory", () => {
		it("should link account to category", async () => {
			mockRepo.linkAccountToCategory.mockReturnValue(Effect.void);

			await Effect.runPromise(
				service.linkLedgerAccountToCategory(organizationId, ledgerId, categoryId, accountId)
			);

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
			mockRepo.unlinkAccountFromCategory.mockReturnValue(Effect.void);

			await Effect.runPromise(
				service.unlinkLedgerAccountToCategory(organizationId, ledgerId, categoryId, accountId)
			);

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
			mockRepo.linkCategoryToParent.mockReturnValue(Effect.void);

			await Effect.runPromise(
				service.linkLedgerAccountCategoryToCategory(
					organizationId,
					ledgerId,
					categoryId,
					parentCategoryId
				)
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
			mockRepo.unlinkCategoryFromParent.mockReturnValue(Effect.void);

			await Effect.runPromise(
				service.unlinkLedgerAccountCategoryToCategory(
					organizationId,
					ledgerId,
					categoryId,
					parentCategoryId
				)
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
				service.createLedgerAccountCategory(organizationId, ledgerId, {
					name: "Assets",
					normalBalance: "debit",
				}),
			() =>
				service.updateLedgerAccountCategory(organizationId, ledgerId, categoryId, {
					name: "Assets",
					normalBalance: "debit",
				}),
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
				const failure = new LedgerNotFound();
				ledgerGet.mockReturnValueOnce(Effect.fail(failure));

				await expect(Effect.runPromise(operation())).rejects.toBe(failure);
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
