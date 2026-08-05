import { Context } from "effect";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../repo/schema";

type DrizzleDatabase = NodePgDatabase<typeof schema>;

interface DatabaseShape {
	readonly db: DrizzleDatabase;
}

class Database extends Context.Tag("Database")<Database, DatabaseShape>() {}

export type { DatabaseShape, DrizzleDatabase };
export { Database };
