import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["test/bench/**/*.bench.ts"],
		globalSetup: "./test.setup.ts",
		testTimeout: 120000, // 2 minutes per test (benchmarks take longer)
		hookTimeout: 60000, // 1 minute for setup/teardown
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
});
