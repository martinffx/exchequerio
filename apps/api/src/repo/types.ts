import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { schemaRelations } from "./schema";

type Repos = Record<string, never>;

type RepoPluginOptions = {
	db: DrizzleDB;
	repos?: Partial<Repos>;
};

type DrizzleDB = NodePgDatabase<typeof schemaRelations>;

export type { Repos, RepoPluginOptions, DrizzleDB };
