import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/errors";
import { LedgerAccountEntity } from "@/repo/entities/LedgerAccountEntity";
import { LedgerEntity } from "@/repo/entities/LedgerEntity";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import type { LedgerAccountRepo } from "@/repo/LedgerAccountRepo";
import type { LedgerRepo } from "@/repo/LedgerRepo";
import { LedgerAccountService } from "./LedgerAccountService";

describe("LedgerAccountService", () => {
	const orgId = new TypeID("org") as OrgID;
	const ledgerId = new TypeID("lgr") as LedgerID;
	const accountId = new TypeID("lat") as LedgerAccountID;

	const mockLedgerAccountRepo = vi.mocked<LedgerAccountRepo>({
		listLedgerAccounts: vi.fn(),
		getLedgerAccount: vi.fn(),
		upsertLedgerAccount: vi.fn(),
		deleteLedgerAccount: vi.fn(),
	} as unknown as LedgerAccountRepo);

	const mockLedgerRepo = vi.mocked<LedgerRepo>({
		getLedger: vi.fn(),
	} as unknown as LedgerRepo);

	const service = new LedgerAccountService(mockLedgerAccountRepo, mockLedgerRepo);

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("listLedgerAccounts", () => {
		it("should verify ledger exists then return list of accounts", async () => {
			const mockLedger = new LedgerEntity({
				id: ledgerId,
				organizationId: orgId,
				name: "Test Ledger",
				currency: "USD",
				currencyExponent: 2,
				created: new Date(),
				updated: new Date(),
			});

			const mockAccounts = [
				new LedgerAccountEntity({
					id: accountId,
					organizationId: orgId,
					ledgerId,
					name: "Cash Account",
					normalBalance: "debit",
					pendingAmount: 0,
					postedAmount: 10000,
					availableAmount: 10000,
					pendingCredits: 0,
					pendingDebits: 0,
					postedCredits: 0,
					postedDebits: 10000,
					availableCredits: 0,
					availableDebits: 10000,
					lockVersion: 1,
					created: new Date(),
					updated: new Date(),
				}),
			];

			mockLedgerRepo.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountRepo.listLedgerAccounts.mockResolvedValue(mockAccounts);

			const result = await service.listLedgerAccounts(orgId, ledgerId, 0, 50);

			expect(result).toEqual(mockAccounts);
			expect(mockLedgerRepo.getLedger).toHaveBeenCalledWith(orgId, ledgerId);
			expect(mockLedgerRepo.getLedger).toHaveBeenCalledTimes(1);
			expect(mockLedgerAccountRepo.listLedgerAccounts).toHaveBeenCalledWith(orgId, ledgerId, 0, 50);
			expect(mockLedgerAccountRepo.listLedgerAccounts).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError when ledger does not exist", async () => {
			const error = new NotFoundError(`Ledger not found: ${ledgerId.toString()}`);
			mockLedgerRepo.getLedger.mockRejectedValue(error);

			await expect(service.listLedgerAccounts(orgId, ledgerId, 0, 50)).rejects.toThrow(NotFoundError);

			expect(mockLedgerRepo.getLedger).toHaveBeenCalledWith(orgId, ledgerId);
			expect(mockLedgerAccountRepo.listLedgerAccounts).not.toHaveBeenCalled();
		});

		it("should handle pagination parameters", async () => {
			const mockLedger = new LedgerEntity({
				id: ledgerId,
				organizationId: orgId,
				name: "Test Ledger",
				currency: "USD",
				currencyExponent: 2,
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerRepo.getLedger.mockResolvedValue(mockLedger);
			mockLedgerAccountRepo.listLedgerAccounts.mockResolvedValue([]);

			await service.listLedgerAccounts(orgId, ledgerId, 10, 20);

			expect(mockLedgerRepo.getLedger).toHaveBeenCalledWith(orgId, ledgerId);
			expect(mockLedgerAccountRepo.listLedgerAccounts).toHaveBeenCalledWith(orgId, ledgerId, 10, 20);
		});
	});

	describe("getLedgerAccount", () => {
		it("should return account when found", async () => {
			const mockAccount = new LedgerAccountEntity({
				id: accountId,
				organizationId: orgId,
				ledgerId,
				name: "Cash Account",
				description: "Primary cash account",
				normalBalance: "debit",
				pendingAmount: 0,
				postedAmount: 10000,
				availableAmount: 10000,
				pendingCredits: 0,
				pendingDebits: 0,
				postedCredits: 0,
				postedDebits: 10000,
				availableCredits: 0,
				availableDebits: 10000,
				lockVersion: 1,
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerAccountRepo.getLedgerAccount.mockResolvedValue(mockAccount);

			const result = await service.getLedgerAccount(orgId, ledgerId, accountId);

			expect(result).toEqual(mockAccount);
			expect(mockLedgerAccountRepo.getLedgerAccount).toHaveBeenCalledWith(orgId, ledgerId, accountId);
			expect(mockLedgerAccountRepo.getLedgerAccount).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Account not found: ${accountId.toString()}`);
			mockLedgerAccountRepo.getLedgerAccount.mockRejectedValue(error);

			await expect(service.getLedgerAccount(orgId, ledgerId, accountId)).rejects.toThrow(
				NotFoundError
			);

			expect(mockLedgerAccountRepo.getLedgerAccount).toHaveBeenCalledWith(orgId, ledgerId, accountId);
		});
	});

	describe("createLedgerAccount", () => {
		it("should create account using upsert", async () => {
			const account = new LedgerAccountEntity({
				id: accountId,
				organizationId: orgId,
				ledgerId,
				name: "New Account",
				normalBalance: "debit",
				pendingAmount: 0,
				postedAmount: 0,
				availableAmount: 0,
				pendingCredits: 0,
				pendingDebits: 0,
				postedCredits: 0,
				postedDebits: 0,
				availableCredits: 0,
				availableDebits: 0,
				lockVersion: 0,
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerAccountRepo.upsertLedgerAccount.mockResolvedValue(account);

			const result = await service.createLedgerAccount(account);

			expect(result).toEqual(account);
			expect(mockLedgerAccountRepo.upsertLedgerAccount).toHaveBeenCalledWith(account);
			expect(mockLedgerAccountRepo.upsertLedgerAccount).toHaveBeenCalledTimes(1);
		});
	});

	describe("updateLedgerAccount", () => {
		it("should update account using upsert", async () => {
			const account = new LedgerAccountEntity({
				id: accountId,
				organizationId: orgId,
				ledgerId,
				name: "Updated Account",
				description: "Updated description",
				normalBalance: "debit",
				pendingAmount: 0,
				postedAmount: 5000,
				availableAmount: 5000,
				pendingCredits: 0,
				pendingDebits: 0,
				postedCredits: 0,
				postedDebits: 5000,
				availableCredits: 0,
				availableDebits: 5000,
				lockVersion: 2,
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerAccountRepo.upsertLedgerAccount.mockResolvedValue(account);

			const result = await service.updateLedgerAccount(account);

			expect(result).toEqual(account);
			expect(mockLedgerAccountRepo.upsertLedgerAccount).toHaveBeenCalledWith(account);
			expect(mockLedgerAccountRepo.upsertLedgerAccount).toHaveBeenCalledTimes(1);
		});
	});

	describe("deleteLedgerAccount", () => {
		it("should delete account", async () => {
			mockLedgerAccountRepo.deleteLedgerAccount.mockResolvedValue();

			await service.deleteLedgerAccount(orgId, ledgerId, accountId);

			expect(mockLedgerAccountRepo.deleteLedgerAccount).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				accountId
			);
			expect(mockLedgerAccountRepo.deleteLedgerAccount).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Account not found: ${accountId.toString()}`);
			mockLedgerAccountRepo.deleteLedgerAccount.mockRejectedValue(error);

			await expect(service.deleteLedgerAccount(orgId, ledgerId, accountId)).rejects.toThrow(
				NotFoundError
			);

			expect(mockLedgerAccountRepo.deleteLedgerAccount).toHaveBeenCalledWith(
				orgId,
				ledgerId,
				accountId
			);
		});
	});
});
