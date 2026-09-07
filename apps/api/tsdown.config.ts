import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/worker.ts", "src/monitor-jobs.ts"],
	platform: "node",
	target: "node24",
	format: "esm",
	outDir: "dist",
	sourcemap: true,
	deps: {
		neverBundle: true,
	},
});
