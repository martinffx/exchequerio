import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Config } from "./config";

describe("Config", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		// Save original environment
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv;
	});

	describe("workosClientId", () => {
		it("should read WORKOS_CLIENT_ID from process.env", () => {
			process.env.WORKOS_CLIENT_ID = "client_test_123";
			const config = new Config();
			expect(config.workosClientId).toBe("client_test_123");
		});

		it("should use provided workosClientId option", () => {
			const config = new Config({ workosClientId: "client_override" });
			expect(config.workosClientId).toBe("client_override");
		});

		it("should default to empty string if not provided", () => {
			process.env.WORKOS_CLIENT_ID = undefined;
			const config = new Config();
			expect(config.workosClientId).toBe("");
		});

		it("should prioritize constructor option over environment variable", () => {
			process.env.WORKOS_CLIENT_ID = "client_env";
			const config = new Config({ workosClientId: "client_override" });
			expect(config.workosClientId).toBe("client_override");
		});
	});

	describe("existing config properties", () => {
		it("should read DATABASE_URL from process.env", () => {
			process.env.DATABASE_URL = "postgres://test";
			const config = new Config();
			expect(config.databaseUrl).toBe("postgres://test");
		});

		it("should read NODE_ENV from process.env", () => {
			process.env.NODE_ENV = "production";
			const config = new Config();
			expect(config.environment).toBe("production");
		});
	});
});
