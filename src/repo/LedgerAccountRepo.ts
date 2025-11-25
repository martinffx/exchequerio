import { TypeID } from "typeid-js"
import { LedgerAccountsTable, LedgersTable, LedgerTransactionEntriesTable } from "./schema"
import { eq, and, desc, like, count, sum } from "drizzle-orm"
import type { DrizzleDB } from "./types"
import { LedgerAccountEntity } from "@/services/entities/LedgerAccountEntity"
import type {
	LedgerAccountID,
	LedgerID,
	BalanceData,
} from "@/services/entities/LedgerAccountEntity"
import type { OrgID } from "@/services/entities/types"
import { NotFoundError, ConflictError, BadRequestError } from "@/errors"

class LedgerAccountRepo {
	constructor(private readonly db: DrizzleDB) {}

	/**
	 * List accounts by ledger with filtering and pagination
	 */
	public async listAccounts(
		ledgerId: LedgerID,
		offset: number,
		limit: number,
		nameFilter?: string
	): Promise<LedgerAccountEntity[]> {
		// Build where conditions
		const whereConditions = [eq(LedgerAccountsTable.ledgerId, ledgerId.toString())]

		if (nameFilter) {
			whereConditions.push(like(LedgerAccountsTable.name, nameFilter))
		}

		const results = await this.db
			.select()
			.from(LedgerAccountsTable)
			.where(and(...whereConditions))
			.orderBy(desc(LedgerAccountsTable.created))
			.limit(limit)
			.offset(offset)

		return results.map(record => LedgerAccountEntity.fromRecord(record))
	}

	/**
	 * Get single account by ID with optional balance calculation
	 */
	public async getAccount(
		ledgerId: LedgerID,
		accountId: LedgerAccountID,
		includeBalance = false
	): Promise<LedgerAccountEntity> {
		const result = await this.db
			.select()
			.from(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.id, accountId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			)
			.limit(1)

		if (result.length === 0) {
			throw new NotFoundError(`Account not found: ${accountId.toString()}`)
		}

		const record = result[0]

		if (includeBalance) {
			const balanceData = await this.calculateBalance(ledgerId, accountId)
			return LedgerAccountEntity.fromRecordWithBalances(record, balanceData)
		}

		return LedgerAccountEntity.fromRecord(record)
	}

	/**
	 * Create new account with validation
	 */
	public async createAccount(entity: LedgerAccountEntity): Promise<LedgerAccountEntity> {
		const record = entity.toRecord()

		const insertResult = await this.db.insert(LedgerAccountsTable).values(record).returning()

		return LedgerAccountEntity.fromRecord(insertResult[0])
	}

	/**
	 * Update existing account with optimistic locking
	 */
	public async updateAccount(
		ledgerId: LedgerID,
		entity: LedgerAccountEntity
	): Promise<LedgerAccountEntity> {
		const record = entity.toRecord()
		const now = new Date()

		const updateResult = await this.db
			.update(LedgerAccountsTable)
			.set({
				name: record.name,
				description: record.description,
				// normalBalance is immutable - don't update it
				metadata: record.metadata,
				lockVersion: entity.lockVersion + 1,
				updated: now,
			})
			.where(
				and(
					eq(LedgerAccountsTable.id, entity.id.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					eq(LedgerAccountsTable.lockVersion, entity.lockVersion)
				)
			)
			.returning()

		if (updateResult.length === 0) {
			// Check if account exists
			const existsResult = await this.db
				.select({ id: LedgerAccountsTable.id })
				.from(LedgerAccountsTable)
				.where(
					and(
						eq(LedgerAccountsTable.id, entity.id.toString()),
						eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
					)
				)
				.limit(1)

			if (existsResult.length === 0) {
				throw new NotFoundError(`Account not found: ${entity.id.toString()}`)
			} else {
				throw new ConflictError(
					"Optimistic locking failure - account was modified by another transaction"
				)
			}
		}

		return LedgerAccountEntity.fromRecord(updateResult[0])
	}

	/**
	 * Delete account with dependency checks
	 */
	public async deleteAccount(ledgerId: LedgerID, accountId: LedgerAccountID): Promise<void> {
		// Check if account has transaction entries - prevent deletion if it has data
		const entryCount = await this.db
			.select({ id: LedgerTransactionEntriesTable.id })
			.from(LedgerTransactionEntriesTable)
			.where(eq(LedgerTransactionEntriesTable.accountId, accountId.toString()))
			.limit(1)

		if (entryCount.length > 0) {
			throw new ConflictError("Cannot delete account with existing transaction entries")
		}

		const deleteResult = await this.db
			.delete(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.id, accountId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			)
			.returning({ id: LedgerAccountsTable.id })

		if (deleteResult.length === 0) {
			throw new Error(`Account not found: ${accountId.toString()}`)
		}
	}

	/**
	 * Real-time balance calculation with transaction entries
	 */
	public async calculateBalance(
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Promise<BalanceData> {
		// Get account info for normal balance type
		const accountResult = await this.db
			.select({
				normalBalance: LedgerAccountsTable.normalBalance,
			})
			.from(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.id, accountId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			)
			.limit(1)

		if (accountResult.length === 0) {
			throw new NotFoundError(`Account not found: ${accountId.toString()}`)
		}

		const account = accountResult[0]

		// Get ledger for currency info
		const ledgerResult = await this.db
			.select({
				currency: LedgersTable.currency,
				currencyExponent: LedgersTable.currencyExponent,
			})
			.from(LedgersTable)
			.where(eq(LedgersTable.id, ledgerId.toString()))
			.limit(1)

		if (ledgerResult.length === 0) {
			throw new NotFoundError(`Ledger not found: ${ledgerId.toString()}`)
		}

		const ledger = ledgerResult[0]

		// Calculate balances by aggregating transaction entries
		const entries = await this.db
			.select({
				direction: LedgerTransactionEntriesTable.direction,
				amount: LedgerTransactionEntriesTable.amount,
				status: LedgerTransactionEntriesTable.status,
			})
			.from(LedgerTransactionEntriesTable)
			.where(eq(LedgerTransactionEntriesTable.accountId, accountId.toString()))

		let postedCredits = 0
		let postedDebits = 0
		let pendingCredits = 0
		let pendingDebits = 0

		for (const entry of entries) {
			const amount = Number.parseFloat(entry.amount)

			if (entry.status === "posted") {
				if (entry.direction === "credit") {
					postedCredits += amount
				} else {
					postedDebits += amount
				}
			} else if (entry.status === "pending") {
				if (entry.direction === "credit") {
					pendingCredits += amount
				} else {
					pendingDebits += amount
				}
			}
		}

		// Calculate balances based on normal balance type
		const isDebitNormal = account.normalBalance === "debit"

		// Posted balance (confirmed transactions only)
		const postedAmount = isDebitNormal ? postedDebits - postedCredits : postedCredits - postedDebits

		// Pending balance (all transactions including pending)
		const totalCredits = postedCredits + pendingCredits
		const totalDebits = postedDebits + pendingDebits
		const pendingAmount = isDebitNormal ? totalDebits - totalCredits : totalCredits - totalDebits

		// Available balance (posted + pending inbound - pending outbound)
		// For debit accounts: available = posted + pending debits - pending credits
		// For credit accounts: available = posted + pending credits - pending debits
		const availableAmount = isDebitNormal
			? postedAmount + pendingDebits - pendingCredits
			: postedAmount + pendingCredits - pendingDebits

		return {
			pendingAmount,
			postedAmount,
			availableAmount,
			pendingCredits,
			pendingDebits,
			postedCredits,
			postedDebits,
			availableCredits: isDebitNormal ? postedCredits : postedCredits + pendingCredits,
			availableDebits: isDebitNormal ? postedDebits + pendingDebits : postedDebits,
			currency: ledger.currency,
			currencyExponent: ledger.currencyExponent,
		}
	}

	// Legacy methods for backward compatibility with existing transaction processing

	/**
	 * Get account with SELECT ... FOR UPDATE for transaction processing
	 */
	public async getAccountWithLock(accountId: string, tx: DrizzleDB) {
		// Use SELECT ... FOR UPDATE to prevent race conditions
		const result = await tx
			.select()
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.id, accountId))
			.for("update")
			.limit(1)

		if (result.length === 0) {
			throw new NotFoundError(`Account not found: ${accountId}`)
		}

		return result[0]
	}

	/**
	 * Update account balance for transaction processing
	 */
	public async updateAccountBalance(
		accountId: string,
		newBalance: string,
		lockVersion: number,
		tx: DrizzleDB
	) {
		const updateResult = await tx
			.update(LedgerAccountsTable)
			.set({
				balanceAmount: newBalance,
				lockVersion: lockVersion + 1,
				updated: new Date(),
			})
			.where(
				and(eq(LedgerAccountsTable.id, accountId), eq(LedgerAccountsTable.lockVersion, lockVersion))
			)
			.returning()

		if (updateResult.length === 0) {
			throw new Error("Optimistic locking failure - account was modified by another transaction")
		}

		return updateResult[0]
	}

	/**
	 * Get simple account balance for backward compatibility
	 */
	public async getAccountBalance(accountId: string) {
		const result = await this.db
			.select({
				id: LedgerAccountsTable.id,
				name: LedgerAccountsTable.name,
				normalBalance: LedgerAccountsTable.normalBalance,
				balanceAmount: LedgerAccountsTable.balanceAmount,
				lockVersion: LedgerAccountsTable.lockVersion,
			})
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.id, accountId))
			.limit(1)

		if (result.length === 0) {
			throw new NotFoundError(`Account not found: ${accountId}`)
		}

		return result[0]
	}

	/**
	 * Legacy advanced balance calculations for backward compatibility
	 */
	public async getAccountBalances(
		accountId: string,
		ledgerId: string
	): Promise<{
		pending: { amount: number; credits: number; debits: number }
		posted: { amount: number; credits: number; debits: number }
		available: { amount: number; credits: number; debits: number }
		currency: string
		currencyExponent: number
	}> {
		const balanceData = await this.calculateBalance(
			TypeID.fromString<"lgr">(ledgerId) as LedgerID,
			TypeID.fromString<"lat">(accountId) as LedgerAccountID
		)

		return {
			pending: {
				amount: balanceData.pendingAmount,
				credits: balanceData.pendingCredits,
				debits: balanceData.pendingDebits,
			},
			posted: {
				amount: balanceData.postedAmount,
				credits: balanceData.postedCredits,
				debits: balanceData.postedDebits,
			},
			available: {
				amount: balanceData.availableAmount,
				credits: balanceData.availableCredits,
				debits: balanceData.availableDebits,
			},
			currency: balanceData.currency,
			currencyExponent: balanceData.currencyExponent,
		}
	}

	// NEW CRUD METHODS WITH ORGANIZATION TENANCY

	/**
	 * Get single account by ID with organization tenancy validation
	 */
	public async getLedgerAccount(
		organizationId: string,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Promise<LedgerAccountEntity> {
		// Join with LedgersTable to validate organization tenancy
		const result = await this.db
			.select({
				id: LedgerAccountsTable.id,
				ledgerId: LedgerAccountsTable.ledgerId,
				name: LedgerAccountsTable.name,
				description: LedgerAccountsTable.description,
				normalBalance: LedgerAccountsTable.normalBalance,
				balanceAmount: LedgerAccountsTable.balanceAmount,
				lockVersion: LedgerAccountsTable.lockVersion,
				metadata: LedgerAccountsTable.metadata,
				created: LedgerAccountsTable.created,
				updated: LedgerAccountsTable.updated,
			})
			.from(LedgerAccountsTable)
			.innerJoin(LedgersTable, eq(LedgerAccountsTable.ledgerId, LedgersTable.id))
			.where(
				and(
					eq(LedgerAccountsTable.id, accountId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					eq(LedgersTable.organizationId, organizationId)
				)
			)
			.limit(1)

		if (result.length === 0) {
			throw new NotFoundError(`Account not found: ${accountId.toString()}`)
		}

		return LedgerAccountEntity.fromRecord(result[0])
	}

	/**
	 * List accounts by ledger with organization tenancy validation
	 */
	public async listLedgerAccounts(
		organizationId: string,
		ledgerId: LedgerID,
		offset: number,
		limit: number,
		nameFilter?: string
	): Promise<LedgerAccountEntity[]> {
		// First validate that the ledger belongs to the organization
		const ledgerValidation = await this.db
			.select({ id: LedgersTable.id })
			.from(LedgersTable)
			.where(
				and(eq(LedgersTable.id, ledgerId.toString()), eq(LedgersTable.organizationId, organizationId))
			)
			.limit(1)

		if (ledgerValidation.length === 0) {
			throw new NotFoundError(
				`Ledger not found or does not belong to organization: ${ledgerId.toString()}`
			)
		}

		// Build where conditions with organization tenancy
		const whereConditions = [
			eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
			eq(LedgersTable.organizationId, organizationId),
		]

		if (nameFilter) {
			whereConditions.push(like(LedgerAccountsTable.name, nameFilter))
		}

		const results = await this.db
			.select({
				id: LedgerAccountsTable.id,
				ledgerId: LedgerAccountsTable.ledgerId,
				name: LedgerAccountsTable.name,
				description: LedgerAccountsTable.description,
				normalBalance: LedgerAccountsTable.normalBalance,
				balanceAmount: LedgerAccountsTable.balanceAmount,
				lockVersion: LedgerAccountsTable.lockVersion,
				metadata: LedgerAccountsTable.metadata,
				created: LedgerAccountsTable.created,
				updated: LedgerAccountsTable.updated,
			})
			.from(LedgerAccountsTable)
			.innerJoin(LedgersTable, eq(LedgerAccountsTable.ledgerId, LedgersTable.id))
			.where(and(...whereConditions))
			.orderBy(desc(LedgerAccountsTable.created))
			.limit(limit)
			.offset(offset)

		return results.map(record => LedgerAccountEntity.fromRecord(record))
	}

	/**
	 * Create new account with organization tenancy validation
	 */
	public async createLedgerAccount(
		organizationId: string,
		entity: LedgerAccountEntity
	): Promise<LedgerAccountEntity> {
		// Validate that the ledger belongs to the organization
		const ledgerValidation = await this.db
			.select({ id: LedgersTable.id })
			.from(LedgersTable)
			.where(
				and(
					eq(LedgersTable.id, entity.ledgerId.toString()),
					eq(LedgersTable.organizationId, organizationId)
				)
			)
			.limit(1)

		if (ledgerValidation.length === 0) {
			throw new NotFoundError(
				`Ledger not found or does not belong to organization: ${entity.ledgerId.toString()}`
			)
		}

		const record = entity.toRecord()

		const insertResult = await this.db.insert(LedgerAccountsTable).values(record).returning()

		return LedgerAccountEntity.fromRecord(insertResult[0])
	}

	/**
	 * Update existing account with organization tenancy validation and optimistic locking
	 */
	public async updateLedgerAccount(
		organizationId: string,
		ledgerId: LedgerID,
		entity: LedgerAccountEntity
	): Promise<LedgerAccountEntity> {
		// Validate organization tenancy first
		const validation = await this.db
			.select({ id: LedgerAccountsTable.id })
			.from(LedgerAccountsTable)
			.innerJoin(LedgersTable, eq(LedgerAccountsTable.ledgerId, LedgersTable.id))
			.where(
				and(
					eq(LedgerAccountsTable.id, entity.id.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					eq(LedgersTable.organizationId, organizationId)
				)
			)
			.limit(1)

		if (validation.length === 0) {
			throw new NotFoundError(`Account not found: ${entity.id.toString()}`)
		}

		const record = entity.toRecord()
		const now = new Date()

		const updateResult = await this.db
			.update(LedgerAccountsTable)
			.set({
				name: record.name,
				description: record.description,
				// normalBalance is immutable - don't update it
				metadata: record.metadata,
				lockVersion: entity.lockVersion + 1,
				updated: now,
			})
			.where(
				and(
					eq(LedgerAccountsTable.id, entity.id.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					eq(LedgerAccountsTable.lockVersion, entity.lockVersion)
				)
			)
			.returning()

		if (updateResult.length === 0) {
			throw new ConflictError(
				"Optimistic locking failure - account was modified by another transaction"
			)
		}

		return LedgerAccountEntity.fromRecord(updateResult[0])
	}

	/**
	 * Delete account with organization tenancy validation and dependency checks
	 */
	public async deleteLedgerAccount(
		organizationId: string,
		ledgerId: LedgerID,
		accountId: LedgerAccountID
	): Promise<void> {
		// Validate organization tenancy first
		const validation = await this.db
			.select({ id: LedgerAccountsTable.id })
			.from(LedgerAccountsTable)
			.innerJoin(LedgersTable, eq(LedgerAccountsTable.ledgerId, LedgersTable.id))
			.where(
				and(
					eq(LedgerAccountsTable.id, accountId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString()),
					eq(LedgersTable.organizationId, organizationId)
				)
			)
			.limit(1)

		if (validation.length === 0) {
			throw new NotFoundError(`Account not found: ${accountId.toString()}`)
		}

		// Check if account has transaction entries - prevent deletion if it has data
		const entryCount = await this.db
			.select({ id: LedgerTransactionEntriesTable.id })
			.from(LedgerTransactionEntriesTable)
			.where(eq(LedgerTransactionEntriesTable.accountId, accountId.toString()))
			.limit(1)

		if (entryCount.length > 0) {
			throw new Error("Cannot delete account with existing transaction entries")
		}

		const deleteResult = await this.db
			.delete(LedgerAccountsTable)
			.where(
				and(
					eq(LedgerAccountsTable.id, accountId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			)
			.returning({ id: LedgerAccountsTable.id })

		if (deleteResult.length === 0) {
			throw new NotFoundError(`Account not found: ${accountId.toString()}`)
		}
	}
}

export { LedgerAccountRepo }
