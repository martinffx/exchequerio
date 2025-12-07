import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "@/errors";
import { LedgerAccountSettlementEntity } from "@/repo/entities/LedgerAccountSettlementEntity";
import { LedgerEntity } from "@/repo/entities/LedgerEntity";
import type {
	LedgerAccountID,
	LedgerAccountSettlementID,
	LedgerID,
	OrgID,
} from "@/repo/entities/types";
import type { LedgerAccountSettlementRepo } from "@/repo/LedgerAccountSettlementRepo";
import type { LedgerRepo } from "@/repo/LedgerRepo";
import type { SettlementStatus } from "@/routes/ledgers/schema";
import { LedgerAccountSettlementService } from "./LedgerAccountSettlementService";

describe("LedgerAccountSettlementService", () => {
	const orgId = new TypeID("org") as OrgID;
	const ledgerId = new TypeID("lgr") as LedgerID;
	const settlementId = new TypeID("las") as LedgerAccountSettlementID;
	const settledAccountId = new TypeID("lat") as LedgerAccountID;
	const contraAccountId = new TypeID("lat") as LedgerAccountID;

	const mockSettlementRepo = vi.mocked<LedgerAccountSettlementRepo>({
		listSettlements: vi.fn(),
		getSettlement: vi.fn(),
		createSettlement: vi.fn(),
		updateSettlement: vi.fn(),
		deleteSettlement: vi.fn(),
		addEntriesToSettlement: vi.fn(),
		removeEntriesFromSettlement: vi.fn(),
		updateStatus: vi.fn(),
		calculateAmount: vi.fn(),
	} as unknown as LedgerAccountSettlementRepo);
	const mockLedgerRepo = vi.mocked<LedgerRepo>({
		getLedger: vi.fn(),
	} as unknown as LedgerRepo);
	const service = new LedgerAccountSettlementService(mockSettlementRepo, mockLedgerRepo);

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("listLedgerAccountSettlements", () => {
		it("should verify ledger exists and return list of settlements", async () => {
			const mockLedger = new LedgerEntity({
				id: ledgerId,
				organizationId: orgId,
				name: "Test Ledger",
				currency: "USD",
				currencyExponent: 2,
				created: new Date(),
				updated: new Date(),
			});

			const mockSettlements = [
				new LedgerAccountSettlementEntity({
					id: settlementId,
					organizationId: orgId,
					settledAccountId: settledAccountId,
					contraAccountId: contraAccountId,
					normalBalance: "debit" as const,
					amount: 10000,
					currency: "USD",
					currencyExponent: 2,
					status: "drafting",
					created: new Date(),
					updated: new Date(),
				}),
			];

			mockLedgerRepo.getLedger.mockResolvedValue(mockLedger);
			mockSettlementRepo.listSettlements.mockResolvedValue(mockSettlements);

			const result = await service.listLedgerAccountSettlements(orgId, ledgerId, 0, 50);

			expect(result).toEqual(mockSettlements);
			expect(mockLedgerRepo.getLedger).toHaveBeenCalledWith(orgId, ledgerId);
			expect(mockSettlementRepo.listSettlements).toHaveBeenCalledWith(orgId, ledgerId, 0, 50);
		});

		it("should propagate NotFoundError if ledger does not exist", async () => {
			const error = new NotFoundError(`Ledger not found: ${ledgerId.toString()}`);
			mockLedgerRepo.getLedger.mockRejectedValue(error);

			await expect(service.listLedgerAccountSettlements(orgId, ledgerId, 0, 50)).rejects.toThrow(
				NotFoundError
			);
			expect(mockLedgerRepo.getLedger).toHaveBeenCalledWith(orgId, ledgerId);
			expect(mockSettlementRepo.listSettlements).not.toHaveBeenCalled();
		});
	});

	describe("getLedgerAccountSettlement", () => {
		it("should return settlement when found", async () => {
			const mockSettlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: orgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				normalBalance: "debit" as const,
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});

			mockSettlementRepo.getSettlement.mockResolvedValue(mockSettlement);

			const result = await service.getLedgerAccountSettlement(orgId, settlementId);

			expect(result).toEqual(mockSettlement);
			expect(mockSettlementRepo.getSettlement).toHaveBeenCalledWith(orgId, settlementId);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Settlement not found: ${settlementId.toString()}`);
			mockSettlementRepo.getSettlement.mockRejectedValue(error);

			await expect(service.getLedgerAccountSettlement(orgId, settlementId)).rejects.toThrow(
				NotFoundError
			);
		});
	});

	describe("createLedgerAccountSettlement", () => {
		it("should create settlement", async () => {
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: orgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				normalBalance: "debit" as const,
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});

			mockSettlementRepo.createSettlement.mockResolvedValue(settlement);

			const result = await service.createLedgerAccountSettlement(settlement);

			expect(result).toEqual(settlement);
			expect(mockSettlementRepo.createSettlement).toHaveBeenCalledWith(settlement);
		});
	});

	describe("updateLedgerAccountSettlement", () => {
		it("should verify settlement exists then update", async () => {
			const existingSettlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: orgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				normalBalance: "debit" as const,
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});

			const updatedSettlement = new LedgerAccountSettlementEntity({
				...existingSettlement,
				amount: 15000,
				description: "Updated description",
			});

			mockSettlementRepo.getSettlement.mockResolvedValue(existingSettlement);
			mockSettlementRepo.updateSettlement.mockResolvedValue(updatedSettlement);

			const result = await service.updateLedgerAccountSettlement(
				orgId,
				settlementId,
				updatedSettlement
			);

			expect(result).toEqual(updatedSettlement);
			expect(mockSettlementRepo.getSettlement).toHaveBeenCalledWith(orgId, settlementId);
			expect(mockSettlementRepo.updateSettlement).toHaveBeenCalledWith(updatedSettlement);
		});

		it("should propagate NotFoundError if settlement does not exist", async () => {
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: orgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				normalBalance: "debit" as const,
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});

			const error = new NotFoundError(`Settlement not found: ${settlementId.toString()}`);
			mockSettlementRepo.getSettlement.mockRejectedValue(error);

			await expect(
				service.updateLedgerAccountSettlement(orgId, settlementId, settlement)
			).rejects.toThrow(NotFoundError);
			expect(mockSettlementRepo.updateSettlement).not.toHaveBeenCalled();
		});
	});

	describe("deleteLedgerAccountSettlement", () => {
		it("should delete settlement", async () => {
			mockSettlementRepo.deleteSettlement.mockResolvedValue();

			await service.deleteLedgerAccountSettlement(orgId, settlementId);

			expect(mockSettlementRepo.deleteSettlement).toHaveBeenCalledWith(orgId, settlementId);
		});
	});

	describe("addLedgerAccountSettlementEntries", () => {
		it("should add entries to settlement", async () => {
			const entries = ["lte_123", "lte_456"];
			mockSettlementRepo.addEntriesToSettlement.mockResolvedValue();

			await service.addLedgerAccountSettlementEntries(orgId, settlementId, entries);

			expect(mockSettlementRepo.addEntriesToSettlement).toHaveBeenCalledWith(
				orgId,
				settlementId,
				entries
			);
		});
	});

	describe("removeLedgerAccountSettlementEntries", () => {
		it("should remove entries from settlement", async () => {
			const entries = ["lte_123", "lte_456"];
			mockSettlementRepo.removeEntriesFromSettlement.mockResolvedValue();

			await service.removeLedgerAccountSettlementEntries(orgId, settlementId, entries);

			expect(mockSettlementRepo.removeEntriesFromSettlement).toHaveBeenCalledWith(
				orgId,
				settlementId,
				entries
			);
		});
	});

	describe("transitionSettlementStatus", () => {
		it("should transition from drafting to processing", async () => {
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: orgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				normalBalance: "debit" as const,
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});

			const updatedSettlement = new LedgerAccountSettlementEntity({
				...settlement,
				status: "processing",
			});

			mockSettlementRepo.getSettlement.mockResolvedValue(settlement);
			mockSettlementRepo.updateStatus.mockResolvedValue(updatedSettlement);

			const result = await service.transitionSettlementStatus(orgId, settlementId, "processing");

			expect(result.status).toBe("processing");
			expect(mockSettlementRepo.getSettlement).toHaveBeenCalledWith(orgId, settlementId);
			expect(mockSettlementRepo.updateStatus).toHaveBeenCalledWith(orgId, settlementId, "processing");
		});

		it("should calculate amount when transitioning from processing to pending", async () => {
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: orgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				normalBalance: "debit" as const,
				amount: 0,
				currency: "USD",
				currencyExponent: 2,
				status: "processing",
				created: new Date(),
				updated: new Date(),
			});

			const calculatedAmount = 25000;
			const updatedSettlement = new LedgerAccountSettlementEntity({
				...settlement,
				amount: calculatedAmount,
			});

			const finalSettlement = new LedgerAccountSettlementEntity({
				...updatedSettlement,
				status: "pending",
			});

			mockSettlementRepo.getSettlement.mockResolvedValue(settlement);
			mockSettlementRepo.calculateAmount.mockResolvedValue(calculatedAmount);
			mockSettlementRepo.updateSettlement.mockResolvedValue(updatedSettlement);
			mockSettlementRepo.updateStatus.mockResolvedValue(finalSettlement);

			const result = await service.transitionSettlementStatus(orgId, settlementId, "pending");

			expect(result.status).toBe("pending");
			expect(mockSettlementRepo.calculateAmount).toHaveBeenCalledWith(settlementId);
			expect(mockSettlementRepo.updateSettlement).toHaveBeenCalled();
		});

		it("should reject invalid status transition", async () => {
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: orgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				normalBalance: "debit" as const,
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "drafting",
				created: new Date(),
				updated: new Date(),
			});

			mockSettlementRepo.getSettlement.mockResolvedValue(settlement);

			await expect(
				service.transitionSettlementStatus(orgId, settlementId, "posted" as SettlementStatus)
			).rejects.toThrow(ConflictError);
			expect(mockSettlementRepo.updateStatus).not.toHaveBeenCalled();
		});

		it("should reject transition from archived status", async () => {
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: orgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				normalBalance: "debit" as const,
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "archived",
				created: new Date(),
				updated: new Date(),
			});

			mockSettlementRepo.getSettlement.mockResolvedValue(settlement);

			await expect(
				service.transitionSettlementStatus(orgId, settlementId, "drafting" as SettlementStatus)
			).rejects.toThrow(ConflictError);
		});

		it("should allow valid multi-step transitions", async () => {
			// Test processing → drafting (rollback)
			const settlement = new LedgerAccountSettlementEntity({
				id: settlementId,
				organizationId: orgId,
				settledAccountId: settledAccountId,
				contraAccountId: contraAccountId,
				normalBalance: "debit" as const,
				amount: 10000,
				currency: "USD",
				currencyExponent: 2,
				status: "processing",
				created: new Date(),
				updated: new Date(),
			});

			const updatedSettlement = new LedgerAccountSettlementEntity({
				...settlement,
				status: "drafting",
			});

			mockSettlementRepo.getSettlement.mockResolvedValue(settlement);
			mockSettlementRepo.updateStatus.mockResolvedValue(updatedSettlement);

			const result = await service.transitionSettlementStatus(orgId, settlementId, "drafting");

			expect(result.status).toBe("drafting");
		});
	});
});
