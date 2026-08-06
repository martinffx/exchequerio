import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { LedgerAccountBalanceMonitorRepo } from "./LedgerAccountBalanceMonitorRepo";
import type { LedgerAccountCategoryRepo } from "./LedgerAccountCategoryRepo";
import type { LedgerAccountRepo } from "./LedgerAccountRepo";
import type { LedgerAccountSettlementRepo } from "./LedgerAccountSettlementRepo";
import type { LedgerAccountStatementRepo } from "./LedgerAccountStatementRepo";
import type { LedgerRepo } from "./LedgerRepo";
import type { LedgerTransactionRepo } from "./LedgerTransactionRepo";
import type * as schema from "./schema";

type Repos = {
	ledgerRepo: LedgerRepo;
	ledgerAccountRepo: LedgerAccountRepo;
	ledgerAccountCategoryRepo: LedgerAccountCategoryRepo;
	ledgerAccountSettlementRepo: LedgerAccountSettlementRepo;
	ledgerAccountStatementRepo: LedgerAccountStatementRepo;
	ledgerAccountBalanceMonitorRepo: LedgerAccountBalanceMonitorRepo;
	ledgerTransactionRepo: LedgerTransactionRepo;
};

type RepoPluginOptions = {
	db: DrizzleDB;
	repos?: Partial<Repos>;
};

type DrizzleDB = NodePgDatabase<typeof schema>;

export type { Repos, RepoPluginOptions, DrizzleDB };
