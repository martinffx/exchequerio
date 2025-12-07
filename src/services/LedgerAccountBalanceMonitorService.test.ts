import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/errors";
import { LedgerAccountBalanceMonitorEntity } from "@/repo/entities/LedgerAccountBalanceMonitorEntity";
import type { LedgerAccountBalanceMonitorID, LedgerAccountID } from "@/repo/entities/types";
import type { LedgerAccountBalanceMonitorRepo } from "@/repo/LedgerAccountBalanceMonitorRepo";
import { LedgerAccountBalanceMonitorService } from "./LedgerAccountBalanceMonitorService";

describe("LedgerAccountBalanceMonitorService", () => {
	const monitorId = new TypeID("lbm") as LedgerAccountBalanceMonitorID;
	const accountId = new TypeID("lat") as LedgerAccountID;
	const mockRepo = vi.mocked<LedgerAccountBalanceMonitorRepo>({
		listMonitors: vi.fn(),
		getMonitor: vi.fn(),
		createMonitor: vi.fn(),
		updateMonitor: vi.fn(),
		deleteMonitor: vi.fn(),
	} as unknown as LedgerAccountBalanceMonitorRepo);
	const service = new LedgerAccountBalanceMonitorService(mockRepo);

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("listLedgerAccountBalanceMonitors", () => {
		it("should return list of monitors", async () => {
			const mockMonitors = [
				new LedgerAccountBalanceMonitorEntity({
					id: monitorId,
					accountId,
					name: "Low Balance Alert",
					alertThreshold: 100000,
					isActive: true,
					created: new Date(),
					updated: new Date(),
				}),
			];

			mockRepo.listMonitors.mockResolvedValue(mockMonitors);

			const result = await service.listLedgerAccountBalanceMonitors(0, 50);

			expect(result).toEqual(mockMonitors);
			expect(mockRepo.listMonitors).toHaveBeenCalledWith(0, 50);
		});
	});

	describe("getLedgerAccountBalanceMonitor", () => {
		it("should return monitor when found", async () => {
			const mockMonitor = new LedgerAccountBalanceMonitorEntity({
				id: monitorId,
				accountId,
				name: "Low Balance Alert",
				alertThreshold: 100000,
				isActive: true,
				created: new Date(),
				updated: new Date(),
			});

			mockRepo.getMonitor.mockResolvedValue(mockMonitor);

			const result = await service.getLedgerAccountBalanceMonitor(monitorId.toString());

			expect(result).toEqual(mockMonitor);
			expect(mockRepo.getMonitor).toHaveBeenCalledWith(monitorId);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Monitor not found: ${monitorId.toString()}`);
			mockRepo.getMonitor.mockRejectedValue(error);

			await expect(service.getLedgerAccountBalanceMonitor(monitorId.toString())).rejects.toThrow(
				NotFoundError
			);
		});
	});

	describe("createLedgerAccountBalanceMonitor", () => {
		it("should create monitor", async () => {
			const monitor = new LedgerAccountBalanceMonitorEntity({
				id: monitorId,
				accountId,
				name: "Low Balance Alert",
				alertThreshold: 100000,
				isActive: true,
				created: new Date(),
				updated: new Date(),
			});

			mockRepo.createMonitor.mockResolvedValue(monitor);

			const result = await service.createLedgerAccountBalanceMonitor(monitor);

			expect(result).toEqual(monitor);
			expect(mockRepo.createMonitor).toHaveBeenCalledWith(monitor);
		});
	});

	describe("updateLedgerAccountBalanceMonitor", () => {
		it("should update monitor", async () => {
			const monitor = new LedgerAccountBalanceMonitorEntity({
				id: monitorId,
				accountId,
				name: "Updated Alert",
				alertThreshold: 200000,
				isActive: true,
				created: new Date(),
				updated: new Date(),
			});

			mockRepo.updateMonitor.mockResolvedValue(monitor);

			const result = await service.updateLedgerAccountBalanceMonitor(monitorId.toString(), monitor);

			expect(result).toEqual(monitor);
			expect(mockRepo.updateMonitor).toHaveBeenCalledWith(monitorId, monitor);
		});
	});

	describe("deleteLedgerAccountBalanceMonitor", () => {
		it("should delete monitor", async () => {
			mockRepo.deleteMonitor.mockResolvedValue();

			await service.deleteLedgerAccountBalanceMonitor(monitorId.toString());

			expect(mockRepo.deleteMonitor).toHaveBeenCalledWith(monitorId);
		});
	});
});
