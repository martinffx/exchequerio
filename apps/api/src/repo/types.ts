import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { LedgerAccountBalanceMonitorRepo } from "./LedgerAccountBalanceMonitorRepo";
import type { LedgerAccountCategoryRepo } from "./LedgerAccountCategoryRepo";
import type { LedgerAccountSettlementRepo } from "./LedgerAccountSettlementRepo";
import type { LedgerAccountStatementRepo } from "./LedgerAccountStatementRepo";
import type * as schema from "./schema";

type Repos = {
	ledgerAccountCategoryRepo: LedgerAccountCategoryRepo;
	ledgerAccountSettlementRepo: LedgerAccountSettlementRepo;
	ledgerAccountStatementRepo: LedgerAccountStatementRepo;
	ledgerAccountBalanceMonitorRepo: LedgerAccountBalanceMonitorRepo;
};

type RepoPluginOptions = {
	db: DrizzleDB;
	repos?: Partial<Repos>;
};

type DrizzleDB = NodePgDatabase<typeof schema>;

export type { Repos, RepoPluginOptions, DrizzleDB };
