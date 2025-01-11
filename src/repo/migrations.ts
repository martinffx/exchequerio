import { join } from "node:path";
import type { DrizzleDB } from "./types";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const runMigrations = async (db: DrizzleDB) => {
	try {
		// Path to your migrations folder
		await migrate(db, {
			migrationsFolder: join(__dirname, "../../", "migrations"),
		});

		console.log("Migrations completed");
	} catch (error) {
		console.error("Migration failed:", error);
		throw error;
	}
};

export { runMigrations };
