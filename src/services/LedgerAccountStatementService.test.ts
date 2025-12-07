import { TypeID } from "typeid-js";
import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/errors";
import { LedgerAccountStatementEntity } from "@/repo/entities/LedgerAccountStatementEntity";
import type { LedgerAccountID, LedgerAccountStatementID } from "@/repo/entities/types";
import type { LedgerAccountStatementRepo } from "@/repo/LedgerAccountStatementRepo";
import { LedgerAccountStatementService } from "./LedgerAccountStatementService";

describe("LedgerAccountStatementService", () => {
	const statementId = new TypeID("lst") as LedgerAccountStatementID;
	const accountId = new TypeID("lat") as LedgerAccountID;
	const mockRepo = vi.mocked<LedgerAccountStatementRepo>({
		getStatement: vi.fn(),
		createStatement: vi.fn(),
	} as unknown as LedgerAccountStatementRepo);
	const service = new LedgerAccountStatementService(mockRepo);

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("getLedgerAccountStatement", () => {
		it("should return statement when found", async () => {
			const mockStatement = new LedgerAccountStatementEntity({
				id: statementId,
				accountId,
				statementDate: new Date("2025-01-31"),
				openingBalance: 0,
				closingBalance: 10000,
				totalCredits: 15000,
				totalDebits: 5000,
				transactionCount: 10,
				created: new Date(),
				updated: new Date(),
			});

			mockRepo.getStatement.mockResolvedValue(mockStatement);

			const result = await service.getLedgerAccountStatement(statementId.toString());

			expect(result).toEqual(mockStatement);
			expect(mockRepo.getStatement).toHaveBeenCalledWith(statementId);
		});

		it("should propagate NotFoundError from repo", async () => {
			const error = new NotFoundError(`Statement not found: ${statementId.toString()}`);
			mockRepo.getStatement.mockRejectedValue(error);

			await expect(service.getLedgerAccountStatement(statementId.toString())).rejects.toThrow(
				NotFoundError
			);
		});
	});

	describe("createLedgerAccountStatement", () => {
		it("should create statement", async () => {
			const statement = new LedgerAccountStatementEntity({
				id: statementId,
				accountId,
				statementDate: new Date("2025-01-31"),
				openingBalance: 0,
				closingBalance: 10000,
				totalCredits: 15000,
				totalDebits: 5000,
				transactionCount: 10,
				created: new Date(),
				updated: new Date(),
			});

			mockRepo.createStatement.mockResolvedValue(statement);

			const result = await service.createLedgerAccountStatement(statement);

			expect(result).toEqual(statement);
			expect(mockRepo.createStatement).toHaveBeenCalledWith(statement);
		});
	});
});
