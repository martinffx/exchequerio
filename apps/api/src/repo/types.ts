import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { LedgerAccountStatementRepo } from "./LedgerAccountStatementRepo";
import { schemaRelations } from "./schema";

type Repos = {
	ledgerAccountStatementRepo: LedgerAccountStatementRepo;
};

type RepoPluginOptions = {
	db: DrizzleDB;
	repos?: Partial<Repos>;
};

type DrizzleDB = NodePgDatabase<typeof schemaRelations>;

export type { Repos, RepoPluginOptions, DrizzleDB };
