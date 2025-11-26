import { and, desc, eq } from "drizzle-orm"
import { TypeID } from "typeid-js"
import type { LedgerID, OrgID } from "@/services"
import { LedgerEntity } from "@/services"
import { LedgerAccountsTable, LedgersTable } from "./schema"
import type { DrizzleDB } from "./types"

class LedgerRepo {
	constructor(private readonly db: DrizzleDB) {}

	public async getLedger(orgId: OrgID, id: LedgerID): Promise<LedgerEntity> {
		const result = await this.db
			.select()
			.from(LedgersTable)
			.where(
				and(eq(LedgersTable.id, id.toString()), eq(LedgersTable.organizationId, orgId.toString()))
			)
			.limit(1)

		if (result.length === 0) {
			throw new Error(`Ledger not found: ${id.toString()}`)
		}

		return LedgerEntity.fromRecord(result[0])
	}

	public async listLedgers(orgId: OrgID, offset: number, limit: number): Promise<LedgerEntity[]> {
		const results = await this.db
			.select()
			.from(LedgersTable)
			.where(eq(LedgersTable.organizationId, orgId.toString()))
			.orderBy(desc(LedgersTable.created))
			.limit(limit)
			.offset(offset)

		return results.map(row => LedgerEntity.fromRecord(row))
	}

	public async createLedger(entity: LedgerEntity): Promise<LedgerEntity> {
		const insertResult = await this.db.insert(LedgersTable).values(entity.toRecord()).returning()

		return LedgerEntity.fromRecord(insertResult[0])
	}

	public async updateLedger(orgId: OrgID, entity: LedgerEntity): Promise<LedgerEntity> {
		const record = entity.toRecord()
		const now = new Date()

		const updateResult = await this.db
			.update(LedgersTable)
			.set({
				...record,
				updated: now,
			})
			.where(
				and(
					eq(LedgersTable.id, entity.id.toString()),
					eq(LedgersTable.organizationId, orgId.toString())
				)
			)
			.returning()

		if (updateResult.length === 0) {
			throw new Error(`Ledger not found: ${entity.id.toString()}`)
		}

		return LedgerEntity.fromRecord(updateResult[0])
	}

	public async deleteLedger(orgId: OrgID, id: LedgerID): Promise<void> {
		// Check if ledger has any accounts - prevent deletion if it has data
		const accountCount = await this.db
			.select({ count: LedgerAccountsTable.id })
			.from(LedgerAccountsTable)
			.where(eq(LedgerAccountsTable.ledgerId, id.toString()))

		if (accountCount.length > 0) {
			throw new Error("Cannot delete ledger with existing accounts")
		}

		const deleteResult = await this.db
			.delete(LedgersTable)
			.where(
				and(eq(LedgersTable.id, id.toString()), eq(LedgersTable.organizationId, orgId.toString()))
			)
			.returning({ id: LedgersTable.id })

		if (deleteResult.length === 0) {
			throw new Error(`Ledger not found: ${id.toString()}`)
		}
	}

	// Wrapper methods for transaction operations (simplified implementations for now)
	public createTransactionWithEntries(
		ledgerId: string,
		description: string | null,
		entries: {
			accountId: string
			direction: "debit" | "credit"
			amount: string
		}[]
	) {
		// TODO: Implement proper delegation to LedgerTransactionRepo
		// For now, return a mock response to satisfy type checking
		return {
			id: new TypeID("ltr").toString(),
			ledgerId,
			description,
			status: "pending",
			entries: entries.map(e => ({
				...e,
				id: new TypeID("lte").toString(),
				status: "pending",
			})),
		}
	}

	// Post transaction method
	public postTransaction(transactionId: string) {
		// TODO: Implement proper delegation to LedgerTransactionRepo
		return {
			id: transactionId,
			status: "posted",
			postedAt: new Date().toISOString(),
		}
	}

	// Wrapper methods for account balance operations (simplified implementations for now)
	public getAccountBalance(accountId: string) {
		// TODO: Implement proper delegation to LedgerAccountRepo
		return {
			accountId,
			balanceAmount: "0",
			normalBalance: "debit",
			availableBalance: "0",
			lockVersion: 1,
		}
	}

	public getAccountBalances(accountId: string, ledgerId: string) {
		// TODO: Implement proper delegation to LedgerAccountRepo
		return {
			accountId,
			ledgerId,
			balances: {
				pending: "0",
				posted: "0",
				available: "0",
			},
		}
	}
}

export { LedgerRepo }
