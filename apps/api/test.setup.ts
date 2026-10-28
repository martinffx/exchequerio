import { execSync } from "node:child_process";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		databaseUrl?: string;
		valkeyUrl?: string;
	}
}

/**
 * Global setup for Vitest - runs once before all test suites.
 * Starts throwaway Postgres and Valkey containers (in parallel) and migrates Postgres,
 * so every run (and every worktree) tests against its own services. `test.env.ts`
 * hands the URLs to the workers.
 */
export default async function setup(project: TestProject) {
	console.log("\n🔄 Starting test database and Valkey...");
	const [postgres, valkey] = await Promise.all([
		new PostgreSqlContainer("postgres:17-alpine").start(),
		new GenericContainer("valkey/valkey:8-alpine")
			.withExposedPorts(6379)
			.withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
			.start(),
	]);
	const stopAll = () => Promise.allSettled([postgres.stop(), valkey.stop()]);
	const databaseUrl = postgres.getConnectionUri();
	const valkeyUrl = `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`;

	try {
		execSync("drizzle-kit migrate", {
			stdio: "inherit",
			env: { ...process.env, DATABASE_URL: databaseUrl },
		});
		console.log("✅ Migrations complete\n");
	} catch (error) {
		await stopAll();
		console.error("❌ Migration failed:", error);
		throw error;
	}

	project.provide("databaseUrl", databaseUrl);
	project.provide("valkeyUrl", valkeyUrl);
	return async () => {
		await stopAll();
	};
}
