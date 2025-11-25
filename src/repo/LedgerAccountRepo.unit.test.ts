import { LedgerAccountRepo } from "./LedgerAccountRepo"
import { LedgerAccountEntity } from "@/services/entities/LedgerAccountEntity"
import { TypeID } from "typeid-js"
import type { LedgerAccountID, LedgerID } from "@/services/entities/LedgerAccountEntity"

// Mock DrizzleDB for unit testing
const mockDb = {
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
	transaction: jest.fn(),
} as any

describe("LedgerAccountRepo Unit Tests", () => {
	let ledgerAccountRepo: LedgerAccountRepo
	let testOrgId: string
	let testLedgerId: LedgerID
	let testAccountId: LedgerAccountID

	beforeEach(() => {
		ledgerAccountRepo = new LedgerAccountRepo(mockDb)
		testOrgId = new TypeID("org").toString()
		testLedgerId = new TypeID("lgr") as LedgerID
		testAccountId = new TypeID("lat") as LedgerAccountID

		// Reset all mocks
		jest.clearAllMocks()
	})

	describe("getLedgerAccount", () => {
		it("should return account when found with organization tenancy", async () => {
			// Arrange
			const mockRecord = {
				id: testAccountId.toString(),
				ledgerId: testLedgerId.toString(),
				name: "Test Account",
				description: "Test Description",
				normalBalance: "debit" as const,
				balanceAmount: "100.00",
				lockVersion: 0,
				metadata: null,
				created: new Date(),
				updated: new Date(),
			}

			mockDb.select.mockReturnValue({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue([mockRecord]),
						}),
					}),
				}),
			})

			// Act
			const result = await ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, testAccountId)

			// Assert
			expect(result).toBeInstanceOf(LedgerAccountEntity)
			expect(result.id.toString()).toBe(testAccountId.toString())
			expect(result.name).toBe("Test Account")
		})

		it("should throw error when account not found", async () => {
			// Arrange
			mockDb.select.mockReturnValue({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue([]),
						}),
					}),
				}),
			})

			// Act & Assert
			await expect(
				ledgerAccountRepo.getLedgerAccount(testOrgId, testLedgerId, testAccountId)
			).rejects.toThrow(`Account not found: ${testAccountId.toString()}`)
		})
	})

	describe("listLedgerAccounts", () => {
		it("should return empty array when no accounts exist", async () => {
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
			})

			// Act
			const result = await ledgerAccountRepo.listLedgerAccounts(testOrgId, testLedgerId, 0, 10)

			// Assert
			expect(result).toEqual([])
		})

		it("should return accounts when found", async () => {
			// Arrange
			const mockRecords = [
				{
					id: testAccountId.toString(),
					ledgerId: testLedgerId.toString(),
					name: "Test Account",
					description: "Test Description",
					normalBalance: "debit" as const,
					balanceAmount: "100.00",
					lockVersion: 0,
					metadata: null,
					created: new Date(),
					updated: new Date(),
				},
			]

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
			})

			// Act
			const result = await ledgerAccountRepo.listLedgerAccounts(testOrgId, testLedgerId, 0, 10)

			// Assert
			expect(result).toHaveLength(1)
			expect(result[0]).toBeInstanceOf(LedgerAccountEntity)
			expect(result[0].name).toBe("Test Account")
		})
	})

	describe("createLedgerAccount", () => {
		it("should create account when ledger belongs to organization", async () => {
			// Arrange
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "New Account", description: "Test account" },
				testLedgerId,
				"debit",
				testAccountId.toString()
			)

			const mockLedgerValidation = [{ id: testLedgerId.toString() }]
			const mockInsertResult = [entity.toRecord()]

			// Mock ledger validation query
			mockDb.select.mockReturnValueOnce({
				from: jest.fn().mockReturnValue({
					where: jest.fn().mockReturnValue({
						limit: jest.fn().mockResolvedValue(mockLedgerValidation),
					}),
				}),
			})

			// Mock insert query
			mockDb.insert.mockReturnValueOnce({
				values: jest.fn().mockReturnValue({
					returning: jest.fn().mockResolvedValue(mockInsertResult),
				}),
			})

			// Act
			const result = await ledgerAccountRepo.createLedgerAccount(testOrgId, entity)

			// Assert
			expect(result).toBeInstanceOf(LedgerAccountEntity)
			expect(result.id.toString()).toBe(testAccountId.toString())
			expect(result.name).toBe("New Account")
		})

		it("should throw error when ledger does not belong to organization", async () => {
			// Arrange
			const entity = LedgerAccountEntity.fromRequest({ name: "New Account" }, testLedgerId, "debit")

			mockDb.select.mockReturnValue({
				from: jest.fn().mockReturnValue({
					where: jest.fn().mockReturnValue({
						limit: jest.fn().mockResolvedValue([]),
					}),
				}),
			})

			// Act & Assert
			await expect(ledgerAccountRepo.createLedgerAccount(testOrgId, entity)).rejects.toThrow(
				`Ledger not found or does not belong to organization: ${testLedgerId.toString()}`
			)
		})
	})

	describe("updateLedgerAccount", () => {
		it("should update account when found with organization tenancy", async () => {
			// Arrange
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Updated Account", description: "Updated" },
				testLedgerId,
				"debit",
				testAccountId.toString()
			)

			const mockValidation = [{ id: testAccountId.toString() }]
			const mockUpdateResult = [entity.toRecord()]

			// Mock validation query
			mockDb.select.mockReturnValueOnce({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue(mockValidation),
						}),
					}),
				}),
			})

			// Mock update query
			mockDb.update.mockReturnValueOnce({
				set: jest.fn().mockReturnValue({
					where: jest.fn().mockReturnValue({
						returning: jest.fn().mockResolvedValue(mockUpdateResult),
					}),
				}),
			})

			// Act
			const result = await ledgerAccountRepo.updateLedgerAccount(testOrgId, testLedgerId, entity)

			// Assert
			expect(result).toBeInstanceOf(LedgerAccountEntity)
			expect(result.name).toBe("Updated Account")
		})

		it("should throw error when account not found", async () => {
			// Arrange
			const entity = LedgerAccountEntity.fromRequest(
				{ name: "Updated Account" },
				testLedgerId,
				"debit",
				testAccountId.toString()
			)

			mockDb.select.mockReturnValue({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue([]),
						}),
					}),
				}),
			})

			// Act & Assert
			await expect(
				ledgerAccountRepo.updateLedgerAccount(testOrgId, testLedgerId, entity)
			).rejects.toThrow(`Account not found: ${testAccountId.toString()}`)
		})
	})

	describe("deleteLedgerAccount", () => {
		it("should delete account when found with no dependencies", async () => {
			// Arrange
			const mockValidation = [{ id: testAccountId.toString() }]
			const mockEntryCheck: { id: string }[] = []
			const mockDeleteResult = [{ id: testAccountId.toString() }]

			// Mock validation query
			mockDb.select.mockReturnValueOnce({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue(mockValidation),
						}),
					}),
				}),
			})

			// Mock entry check query
			mockDb.select.mockReturnValueOnce({
				from: jest.fn().mockReturnValue({
					where: jest.fn().mockReturnValue({
						limit: jest.fn().mockResolvedValue(mockEntryCheck),
					}),
				}),
			})

			// Mock delete query
			mockDb.delete.mockReturnValueOnce({
				where: jest.fn().mockReturnValue({
					returning: jest.fn().mockResolvedValue(mockDeleteResult),
				}),
			})

			// Act & Assert
			await expect(
				ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, testAccountId)
			).resolves.not.toThrow()
		})

		it("should throw error when account has transaction entries", async () => {
			// Arrange
			const mockValidation = [{ id: testAccountId.toString() }]
			const mockEntryCheck = [{ id: "entry-id" }]

			// Mock validation query
			mockDb.select.mockReturnValueOnce({
				from: jest.fn().mockReturnValue({
					innerJoin: jest.fn().mockReturnValue({
						where: jest.fn().mockReturnValue({
							limit: jest.fn().mockResolvedValue(mockValidation),
						}),
					}),
				}),
			})

			// Mock entry check query
			mockDb.select.mockReturnValueOnce({
				from: jest.fn().mockReturnValue({
					where: jest.fn().mockReturnValue({
						limit: jest.fn().mockResolvedValue(mockEntryCheck),
					}),
				}),
			})

			// Act & Assert
			await expect(
				ledgerAccountRepo.deleteLedgerAccount(testOrgId, testLedgerId, testAccountId)
			).rejects.toThrow("Cannot delete account with existing transaction entries")
		})
	})
})
