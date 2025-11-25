import { LedgerTransactionRepo } from "./LedgerTransactionRepo";
import {
	LedgerTransactionEntity,
	LedgerTransactionEntryEntity,
} from "@/services/entities";
import { TypeID } from "typeid-js";

// Define types locally since they're not exported
type LedgerTransactionID = TypeID<"ltr">;
type LedgerID = TypeID<"lgr">;

// Mock DrizzleDB for unit testing
const mockDb = {
	transaction: jest.fn(),
	select: jest.fn().mockReturnThis(),
	from: jest.fn().mockReturnThis(),
	innerJoin: jest.fn().mockReturnThis(),
	where: jest.fn().mockReturnThis(),
	orderBy: jest.fn().mockReturnThis(),
	limit: jest.fn().mockReturnThis(),
	offset: jest.fn().mockReturnThis(),
	insert: jest.fn().mockReturnThis(),
	values: jest.fn().mockReturnThis(),
	returning: jest.fn().mockReturnThis(),
	update: jest.fn().mockReturnThis(),
	set: jest.fn().mockReturnThis(),
	delete: jest.fn().mockReturnThis(),
} as any;

describe("LedgerTransactionRepo Unit Tests", () => {
	let ledgerTransactionRepo: LedgerTransactionRepo;
	let testOrgId: string;
	let testLedgerId: LedgerID;
	let testTransactionId: LedgerTransactionID;

	beforeEach(() => {
		ledgerTransactionRepo = new LedgerTransactionRepo(mockDb);
		testOrgId = new TypeID("org").toString();
		testLedgerId = new TypeID("lgr") as LedgerID;
		testTransactionId = new TypeID("ltr") as LedgerTransactionID;

		// Reset all mocks
		jest.clearAllMocks();
	});

	describe("withTransaction", () => {
		it("should execute function within database transaction", async () => {
			// Arrange
			const mockTransactionFn = jest.fn().mockResolvedValue("result");
			mockDb.transaction.mockResolvedValue("result");

			// Act
			const result =
				await ledgerTransactionRepo.withTransaction(mockTransactionFn);

			// Assert
			expect(mockDb.transaction).toHaveBeenCalledWith(mockTransactionFn);
			expect(result).toBe("result");
		});

		it("should propagate transaction errors", async () => {
			// Arrange
			const mockError = new Error("Transaction failed");
			const mockTransactionFn = jest.fn().mockRejectedValue(mockError);
			mockDb.transaction.mockRejectedValue(mockError);

			// Act & Assert
			await expect(
				ledgerTransactionRepo.withTransaction(mockTransactionFn),
			).rejects.toThrow("Transaction failed");
		});
	});

	describe("getLedgerTransaction", () => {
		it("should return transaction when found with organization tenancy", async () => {
			// Arrange
			const mockRecord = {
				id: testTransactionId.toString(),
				ledgerId: testLedgerId.toString(),
				description: "Test Transaction",
				status: "posted" as const,
				metadata: null,
				created: new Date(),
				updated: new Date(),
			};

			mockDb.select.mockReturnValue({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue([mockRecord]),
						}),
					}),
				}),
			});

			// Act
			const result = await ledgerTransactionRepo.getLedgerTransaction(
				testOrgId,
				testLedgerId.toString(),
				testTransactionId.toString(),
			);

			// Assert
			expect(result).toBeInstanceOf(LedgerTransactionEntity);
			expect(result.id.toString()).toBe(testTransactionId.toString());
			expect(result.description).toBe("Test Transaction");
		});

		it("should throw error when transaction not found", async () => {
			// Arrange
			mockDb.select.mockReturnValue({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue([]),
						}),
					}),
				}),
			});

			// Act & Assert
			await expect(
				ledgerTransactionRepo.getLedgerTransaction(
					testOrgId,
					testLedgerId.toString(),
					testTransactionId.toString(),
				),
			).rejects.toThrow(
				`Transaction not found: ${testTransactionId.toString()}`,
			);
		});
	});

	describe("listLedgerTransactions", () => {
		it("should return empty array when no transactions exist", async () => {
			// Arrange
			mockDb.select.mockReturnValue({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							orderBy: jest.fn().mockReturnValue({
								limit: jest.fn().mockReturnValue({
									offset: jest.fn().mockResolvedValue([]),
								}),
							}),
						}),
					}),
				}),
			});

			// Act
			const result = await ledgerTransactionRepo.listLedgerTransactions(
				testOrgId,
				testLedgerId.toString(),
				0,
				10,
			);

			// Assert
			expect(result).toEqual([]);
		});

		it("should return transactions when found", async () => {
			// Arrange
			const mockRecords = [
				{
					id: testTransactionId.toString(),
					ledgerId: testLedgerId.toString(),
					description: "Test Transaction",
					status: "posted" as const,
					metadata: null,
					created: new Date(),
					updated: new Date(),
				},
			];

			mockDb.select.mockReturnValue({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							orderBy: jest.fn().mockReturnValue({
								limit: jest.fn().mockReturnValue({
									offset: jest.fn().mockResolvedValue(mockRecords),
								}),
							}),
						}),
					}),
				}),
			});

			// Act
			const result = await ledgerTransactionRepo.listLedgerTransactions(
				testOrgId,
				testLedgerId.toString(),
				0,
				10,
			);

			// Assert
			expect(result).toHaveLength(1);
			expect(result[0]).toBeInstanceOf(LedgerTransactionEntity);
			expect(result[0].description).toBe("Test Transaction");
		});
	});

	describe("createTransactionWithEntries", () => {
		it("should create transaction with entries when double-entry validation passes", async () => {
			// Arrange
			const transactionEntity = new LedgerTransactionEntity({
				id: testTransactionId,
				ledgerId: testLedgerId,
				description: "Test Transaction",
				status: "posted",
				metadata: null,
				created: new Date(),
				updated: new Date(),
			});

			const entryEntities = [
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as any,
					transactionId: testTransactionId,
					accountId: new TypeID("lat") as any,
					direction: "debit" as const,
					amount: "100.00",
					status: "posted" as const,
					metadata: null,
					created: new Date(),
					updated: new Date(),
				}),
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as any,
					transactionId: testTransactionId,
					accountId: new TypeID("lat") as any,
					direction: "credit" as const,
					amount: "100.00",
					status: "posted" as const,
					metadata: null,
					created: new Date(),
					updated: new Date(),
				}),
			];

			const mockLedgerValidation = [{ id: testLedgerId.toString() }];
			const mockTransactionResult = [transactionEntity.toRecord()];

			// Mock transaction execution
			const mockTx = {
				insert: jest.fn().mockReturnValue({
					values: jest.fn().mockReturnValue({
						returning: jest.fn().mockResolvedValue(mockTransactionResult),
					}),
				}),
				select: jest.fn().mockReturnValue({
					from: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue(mockLedgerValidation),
						}),
					}),
				}),
			};

			mockDb.transaction.mockImplementation(async (fn) => {
				return await fn(mockTx as any);
			});

			// Act
			const result = await ledgerTransactionRepo.createTransactionWithEntries(
				testOrgId,
				transactionEntity,
				entryEntities,
			);

			// Assert
			expect(result).toBeInstanceOf(LedgerTransactionEntity);
			expect(result.id.toString()).toBe(testTransactionId.toString());
		});

		it("should throw error when double-entry validation fails", async () => {
			// Arrange
			const transactionEntity = new LedgerTransactionEntity({
				id: testTransactionId,
				ledgerId: testLedgerId,
				description: "Test Transaction",
				status: "posted",
				metadata: undefined,
				created: new Date(),
				updated: new Date(),
			});

			// Invalid entries - debits don't equal credits
			const entryEntities = [
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as any,
					transactionId: testTransactionId,
					accountId: new TypeID("lat") as any,
					direction: "debit" as const,
					amount: "100.00",
					status: "posted" as const,
					metadata: null,
					created: new Date(),
					updated: new Date(),
				}),
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as any,
					transactionId: testTransactionId,
					accountId: new TypeID("lat") as any,
					direction: "credit" as const,
					amount: "50.00", // Doesn't match debit
					status: "posted" as const,
					metadata: null,
					created: new Date(),
					updated: new Date(),
				}),
			];

			// Act & Assert
			await expect(
				ledgerTransactionRepo.createTransactionWithEntries(
					testOrgId,
					transactionEntity,
					entryEntities,
				),
			).rejects.toThrow(
				"Double-entry validation failed: total debits must equal total credits",
			);
		});

		it("should throw error when ledger does not belong to organization", async () => {
			// Arrange
			const transactionEntity = new LedgerTransactionEntity({
				id: testTransactionId,
				ledgerId: testLedgerId,
				description: "Test Transaction",
				status: "posted",
				metadata: null,
				created: new Date(),
				updated: new Date(),
			});

			const entryEntities = [
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as any,
					transactionId: testTransactionId,
					accountId: new TypeID("lat") as any,
					direction: "debit" as const,
					amount: "100.00",
					status: "posted" as const,
					metadata: null,
					created: new Date(),
					updated: new Date(),
				}),
				new LedgerTransactionEntryEntity({
					id: new TypeID("lte") as any,
					transactionId: testTransactionId,
					accountId: new TypeID("lat") as any,
					direction: "credit" as const,
					amount: "100.00",
					status: "posted" as const,
					metadata: null,
					created: new Date(),
					updated: new Date(),
				}),
			];

			// Mock transaction that returns empty validation
			const mockTx = {
				select: jest.fn().mockReturnValue({
					from: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue([]), // Ledger not found
						}),
					}),
				}),
			};

			mockDb.transaction.mockImplementation(async (fn) => {
				return await fn(mockTx as any);
			});

			// Act & Assert
			await expect(
				ledgerTransactionRepo.createTransactionWithEntries(
					testOrgId,
					transactionEntity,
					entryEntities,
				),
			).rejects.toThrow(
				`Ledger not found or does not belong to organization: ${testLedgerId.toString()}`,
			);
		});
	});
});
