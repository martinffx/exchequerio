import { and, eq, inArray } from "drizzle-orm";
import { NotFoundError } from "@/lib/errors";
import { LedgerAccountEntity } from "@/repo/entities/LedgerAccountEntity";
import type { LedgerAccountID, LedgerID, OrgID } from "@/repo/entities/types";
import { LedgerAccountsTable } from "./schema";
import type { DrizzleDB } from "./types";

class LedgerAccountReader {
	constructor(private readonly db: DrizzleDB) {}

	public async getByIds(
		organizationId: OrgID,
		ledgerId: LedgerID,
		accountIds: readonly LedgerAccountID[]
	): Promise<LedgerAccountEntity[]> {
		if (accountIds.length === 0) return [];

		const ids = accountIds.map(accountId => accountId.toString());
		const records = await this.db
			.select()
			.from(LedgerAccountsTable)
			.where(
				and(
					inArray(LedgerAccountsTable.id, ids),
					eq(LedgerAccountsTable.organizationId, organizationId.toString()),
					eq(LedgerAccountsTable.ledgerId, ledgerId.toString())
				)
			);

		if (records.length !== ids.length) throw new NotFoundError("Account not found");
		return records.map(record => LedgerAccountEntity.fromRecord(record));
	}
}

export { LedgerAccountReader };
