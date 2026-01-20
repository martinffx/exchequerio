import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
	plugins: [react()],
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./test.setup.ts"],
		include: ["**/*.test.{ts,tsx}"],
		env: {
			WORKOS_COOKIE_PASSWORD: "test-password-at-least-32-characters-long-for-security",
			NODE_ENV: "test",
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/",
				"test.setup.ts",
				"**/*.config.{ts,js}",
				"**/*.d.ts",
			],
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./app"),
			"~": path.resolve(__dirname, "./app"),
		},
	},
});
