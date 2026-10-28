import { execSync } from "node:child_process";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		databaseUrl?: string;
	}
}

/**
 * Global setup for Vitest - runs once before all test suites.
 * Starts a throwaway Postgres container and migrates it, so every run (and every
 * worktree) tests against its own database. `test.env.ts` hands the URL to the workers.
 */
export default async function setup(project: TestProject) {
	console.log("\n🔄 Starting test database...");
	const container = await new PostgreSqlContainer("postgres:17-alpine").start();
	const databaseUrl = container.getConnectionUri();

	try {
		execSync("drizzle-kit migrate", {
			stdio: "inherit",
			env: { ...process.env, DATABASE_URL: databaseUrl },
		});
		console.log("✅ Migrations complete\n");
	} catch (error) {
		await container.stop();
		console.error("❌ Migration failed:", error);
		throw error;
	}

	project.provide("databaseUrl", databaseUrl);
	return async () => {
		await container.stop();
	};
}
