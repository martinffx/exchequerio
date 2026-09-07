import { defineConfig } from "vitest/config";
import path from "node:path";

export default [
	defineConfig({
		test: {
			name: "repo",
			include: ["src/domains/**/*Repo.test.ts"],
			fileParallelism: false, // repo tests run sequentially to avoid FK conflicts
			globals: true,
			environment: "node",
			globalSetup: "./test.setup.ts",
		},
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
	}),
	defineConfig({
		test: {
			name: "unit",
			include: ["src/**/*.test.ts"],
			exclude: ["src/domains/**/*Repo.test.ts"],
			globals: true,
			environment: "node",
			globalSetup: "./test.setup.ts",
		},
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
	}),
];
