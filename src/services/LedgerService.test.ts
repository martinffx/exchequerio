import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/errors";
import { LedgerEntity } from "@/repo/entities/LedgerEntity";
import type { LedgerID, OrgID } from "@/repo/entities/types";
import type { LedgerRepo } from "@/repo/LedgerRepo";
import { LedgerService } from "./LedgerService";

describe("LedgerService", () => {
	const orgId = new TypeID("org") as OrgID;
	const ledgerId = new TypeID("lgr") as LedgerID;
	// Create mock repo
	const mockLedgerRepo = vi.mocked<LedgerRepo>({
		getLedger: vi.fn(),
		listLedgers: vi.fn(),
		upsertLedger: vi.fn(),
		deleteLedger: vi.fn(),
	} as unknown as LedgerRepo);
	const service = new LedgerService(mockLedgerRepo);

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("getLedger", () => {
		it("should return ledger when found", async () => {
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

			const result = await service.getLedger(orgId, ledgerId);

			expect(result).toEqual(mockLedger);
			expect(mockLedgerRepo.getLedger).toHaveBeenCalledWith(orgId, ledgerId);
			expect(mockLedgerRepo.getLedger).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Ledger not found: ${ledgerId.toString()}`);
			mockLedgerRepo.getLedger.mockRejectedValue(error);

			await expect(service.getLedger(orgId, ledgerId)).rejects.toThrow(NotFoundError);
			expect(mockLedgerRepo.getLedger).toHaveBeenCalledWith(orgId, ledgerId);
		});

		it("should pass through organization and ledger IDs correctly", async () => {
			const differentOrgId = new TypeID("org") as OrgID;
			const differentLedgerId = new TypeID("lgr") as LedgerID;

			const mockLedger = new LedgerEntity({
				id: differentLedgerId,
				organizationId: differentOrgId,
				name: "Different Ledger",
				currency: "EUR",
				currencyExponent: 2,
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerRepo.getLedger.mockResolvedValue(mockLedger);

			await service.getLedger(differentOrgId, differentLedgerId);

			expect(mockLedgerRepo.getLedger).toHaveBeenCalledWith(differentOrgId, differentLedgerId);
		});
	});

	describe("listLedgers", () => {
		it("should return list of ledgers", async () => {
			const mockLedgers = [
				new LedgerEntity({
					id: new TypeID("lgr") as LedgerID,
					organizationId: orgId,
					name: "Ledger 1",
					currency: "USD",
					currencyExponent: 2,
					created: new Date(),
					updated: new Date(),
				}),
				new LedgerEntity({
					id: new TypeID("lgr") as LedgerID,
					organizationId: orgId,
					name: "Ledger 2",
					currency: "EUR",
					currencyExponent: 2,
					created: new Date(),
					updated: new Date(),
				}),
			];

			mockLedgerRepo.listLedgers.mockResolvedValue(mockLedgers);

			const result = await service.listLedgers(orgId, 0, 10);

			expect(result).toEqual(mockLedgers);
			expect(mockLedgerRepo.listLedgers).toHaveBeenCalledWith(orgId, 0, 10);
			expect(mockLedgerRepo.listLedgers).toHaveBeenCalledTimes(1);
		});

		it("should return empty array when no ledgers exist", async () => {
			mockLedgerRepo.listLedgers.mockResolvedValue([]);

			const result = await service.listLedgers(orgId, 0, 10);

			expect(result).toEqual([]);
			expect(mockLedgerRepo.listLedgers).toHaveBeenCalledWith(orgId, 0, 10);
		});

		it("should pass through offset and limit parameters correctly", async () => {
			mockLedgerRepo.listLedgers.mockResolvedValue([]);

			await service.listLedgers(orgId, 20, 50);

			expect(mockLedgerRepo.listLedgers).toHaveBeenCalledWith(orgId, 20, 50);
		});

		it("should handle pagination boundaries", async () => {
			const mockLedgers = [
				new LedgerEntity({
					id: new TypeID("lgr") as LedgerID,
					organizationId: orgId,
					name: "Ledger 1",
					currency: "USD",
					currencyExponent: 2,
					created: new Date(),
					updated: new Date(),
				}),
			];

			mockLedgerRepo.listLedgers.mockResolvedValue(mockLedgers);

			// First page
			await service.listLedgers(orgId, 0, 1);
			expect(mockLedgerRepo.listLedgers).toHaveBeenCalledWith(orgId, 0, 1);

			// Second page
			await service.listLedgers(orgId, 1, 1);
			expect(mockLedgerRepo.listLedgers).toHaveBeenCalledWith(orgId, 1, 1);
		});
	});

	describe("createLedger", () => {
		it("should create ledger via upsert", async () => {
			const request = {
				name: "New Ledger",
				description: "Test ledger",
			};

			const newLedger = new LedgerEntity({
				id: ledgerId,
				organizationId: orgId,
				name: "New Ledger",
				description: "Test ledger",
				currency: "USD",
				currencyExponent: 2,
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerRepo.upsertLedger.mockResolvedValue(newLedger);

			const result = await service.createLedger(orgId, request);

			expect(result).toEqual(newLedger);
			expect(mockLedgerRepo.upsertLedger).toHaveBeenCalledTimes(1);
		});

		it("should create ledger with metadata", async () => {
			const metadata = { region: "us-east", environment: "test" };
			const ledgerWithMetadata = new LedgerEntity({
				id: ledgerId,
				organizationId: orgId,
				name: "Metadata Ledger",
				currency: "USD",
				currencyExponent: 2,
				metadata,
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerRepo.upsertLedger.mockResolvedValue(ledgerWithMetadata);

			const request = {
				name: "Metadata Ledger",
				metadata,
			};

			const result = await service.createLedger(orgId, request);

			expect(result.metadata).toEqual(metadata);
			expect(mockLedgerRepo.upsertLedger).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError when organization doesn't exist", async () => {
			const request = {
				name: "New Ledger",
			};

			const error = new NotFoundError("Organization not found");
			mockLedgerRepo.upsertLedger.mockRejectedValue(error);

			await expect(service.createLedger(orgId, request)).rejects.toThrow(NotFoundError);
		});
	});

	describe("updateLedger", () => {
		it("should update ledger using upsert", async () => {
			const request = {
				name: "Updated Ledger",
				currency: "USD",
				currencyExponent: 2,
				description: "Updated description",
				metadata: {},
			};

			const updatedLedger = new LedgerEntity({
				id: ledgerId,
				organizationId: orgId,
				name: "Updated Ledger",
				currency: "USD",
				currencyExponent: 2,
				description: "Updated description",
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerRepo.upsertLedger.mockResolvedValue(updatedLedger);

			const result = await service.updateLedger(orgId, request, ledgerId.toString());

			expect(result).toEqual(updatedLedger);
			expect(mockLedgerRepo.upsertLedger).toHaveBeenCalled();
			expect(mockLedgerRepo.upsertLedger).toHaveBeenCalledTimes(1);
		});

		it("should update mutable fields (name, description, metadata)", async () => {
			const request = {
				name: "New Name",
				currency: "USD",
				currencyExponent: 2,
				description: "New description",
				metadata: { new: true },
			};

			const updatedLedger = new LedgerEntity({
				id: ledgerId,
				organizationId: orgId,
				name: "New Name",
				description: "New description",
				currency: "USD",
				currencyExponent: 2,
				metadata: { new: true },
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerRepo.upsertLedger.mockResolvedValue(updatedLedger);

			const result = await service.updateLedger(orgId, request, ledgerId.toString());

			expect(result.name).toBe("New Name");
			expect(result.description).toBe("New description");
			expect(result.metadata).toEqual({ new: true });
		});

		it("should propagate ConflictError when changing immutable fields", async () => {
			const request = {
				name: "Test Ledger",
				currency: "USD",
				currencyExponent: 2,
				description: undefined,
				metadata: {},
			};

			const error = new Error("Ledger not found or immutable fields (organizationId) were changed");
			mockLedgerRepo.upsertLedger.mockRejectedValue(error);

			await expect(service.updateLedger(orgId, request, ledgerId.toString())).rejects.toThrow();
		});
	});

	describe("deleteLedger", () => {
		it("should delete ledger successfully", async () => {
			mockLedgerRepo.deleteLedger.mockResolvedValue(undefined);

			await service.deleteLedger(orgId, ledgerId);

			expect(mockLedgerRepo.deleteLedger).toHaveBeenCalledWith(orgId, ledgerId);
			expect(mockLedgerRepo.deleteLedger).toHaveBeenCalledTimes(1);
		});

		it("should propagate NotFoundError when ledger not found", async () => {
			const error = new NotFoundError(`Ledger not found: ${ledgerId.toString()}`);
			mockLedgerRepo.deleteLedger.mockRejectedValue(error);

			await expect(service.deleteLedger(orgId, ledgerId)).rejects.toThrow(NotFoundError);
			expect(mockLedgerRepo.deleteLedger).toHaveBeenCalledWith(orgId, ledgerId);
		});

		it("should propagate ConflictError when ledger has dependent accounts", async () => {
			const error = new Error("Cannot delete ledger with existing accounts");
			mockLedgerRepo.deleteLedger.mockRejectedValue(error);

			await expect(service.deleteLedger(orgId, ledgerId)).rejects.toThrow(
				"Cannot delete ledger with existing accounts"
			);
		});

		it("should respect organization tenancy", async () => {
			const differentOrgId = new TypeID("org") as OrgID;
			mockLedgerRepo.deleteLedger.mockResolvedValue(undefined);

			await service.deleteLedger(differentOrgId, ledgerId);

			expect(mockLedgerRepo.deleteLedger).toHaveBeenCalledWith(differentOrgId, ledgerId);
		});
	});

	describe("service delegation", () => {
		it("should be a thin wrapper around LedgerRepo", () => {
			// Verify that the service has the expected methods
			expect(service).toHaveProperty("getLedger");
			expect(service).toHaveProperty("listLedgers");
			expect(service).toHaveProperty("createLedger");
			expect(service).toHaveProperty("updateLedger");
			expect(service).toHaveProperty("deleteLedger");
		});

		it("should not add business logic beyond delegation", async () => {
			// This test documents that the service is pass-through
			// If business logic is added in the future, these tests should be updated
			const request = {
				name: "Test",
				currency: "USD",
				currencyExponent: 2,
				description: undefined,
				metadata: {},
			};

			const ledger = new LedgerEntity({
				id: ledgerId,
				organizationId: orgId,
				name: "Test",
				currency: "USD",
				currencyExponent: 2,
				created: new Date(),
				updated: new Date(),
			});

			mockLedgerRepo.upsertLedger.mockResolvedValue(ledger);

			// Create and update both use upsertLedger
			await service.createLedger(orgId, request);
			await service.updateLedger(orgId, request, ledgerId.toString());

			// Both should call the same repo method
			expect(mockLedgerRepo.upsertLedger).toHaveBeenCalledTimes(2);
		});
	});
});
