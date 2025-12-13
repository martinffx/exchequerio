import { execSync } from "node:child_process";

/**
 * Global setup for Vitest - runs once before all test suites
 * Executes database migrations on the test database
 */
export default async function setup() {
	console.log("\n🔄 Running database migrations on test database...");

	try {
		execSync("drizzle-kit migrate", {
			stdio: "inherit",
			env: process.env, // .env.test is already loaded by dotenvx in package.json
		});
		console.log("✅ Migrations complete\n");
	} catch (error) {
		console.error("❌ Migration failed:", error);
		throw error;
	}
}
