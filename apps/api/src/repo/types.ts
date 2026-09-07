import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { schemaRelations } from "./schema";

type DrizzleDB = NodePgDatabase<typeof schemaRelations>;

export type { DrizzleDB };
