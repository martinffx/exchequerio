import { eq } from "drizzle-orm";
import { NotFoundError } from "@/errors";
import { LedgerAccountStatementEntity } from "@/repo/entities/LedgerAccountStatementEntity";
import type { LedgerAccountStatementID } from "@/repo/entities/types";
import { LedgerAccountStatementsTable } from "./schema";
import type { DrizzleDB } from "./types";

/**
 * Repository for ledger account statement data access operations.
 * Handles statement creation and retrieval operations.
 */
class LedgerAccountStatementRepo {
	constructor(private readonly db: DrizzleDB) {}

	/**
	 * Retrieves a single statement by ID.
	 */
	public async getStatement(id: LedgerAccountStatementID): Promise<LedgerAccountStatementEntity> {
		const result = await this.db
			.select()
			.from(LedgerAccountStatementsTable)
			.where(eq(LedgerAccountStatementsTable.id, id.toString()))
			.limit(1);

		if (result.length === 0) {
			throw new NotFoundError(`Statement not found: ${id.toString()}`);
		}

		return LedgerAccountStatementEntity.fromRecord(result[0]);
	}

	/**
	 * Creates a new statement.
	 */
	public async createStatement(
		entity: LedgerAccountStatementEntity
	): Promise<LedgerAccountStatementEntity> {
		const record = entity.toRecord();

		const result = await this.db.insert(LedgerAccountStatementsTable).values(record).returning();

		return LedgerAccountStatementEntity.fromRecord(result[0]);
	}
}

export { LedgerAccountStatementRepo };
