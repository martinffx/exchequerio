import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { DrizzleDB } from "./types";

const runMigrations = async (database: DrizzleDB) => {
	try {
		// Path to your migrations folder
		await migrate(database, {
			migrationsFolder: join(__dirname, "../../", "migrations"),
		});

		console.log("Migrations completed");
	} catch (error) {
		console.error("Migration failed:", error);
		throw error;
	}
};

export { runMigrations };
