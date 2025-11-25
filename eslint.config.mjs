// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import oxlint from "eslint-plugin-oxlint";
import boundaries from "eslint-plugin-boundaries";

export default [
	// Base JavaScript rules
	js.configs.recommended,

	// TypeScript rules with type-aware linting
	...tseslint.configs.recommendedTypeChecked,
	...tseslint.configs.stylisticTypeChecked,

	// Global TypeScript configuration
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},

	// oxlint integration (turns off overlapping rules)
	...oxlint.configs["flat/recommended"],

	// Architectural boundaries
	{
		settings: {
			"boundaries/elements": [
				{ type: "routes", pattern: "src/routes/**/*" },
				{ type: "services", pattern: "src/services/**/*" },
				{ type: "entities", pattern: "src/services/entities/**/*" },
				{ type: "repo", pattern: "src/repo/**/*" },
				{ type: "config", pattern: "src/config.ts" },
				{ type: "server", pattern: "src/server.ts" },
			],
		},
		plugins: {
			boundaries,
		},
		rules: {
			// jsboundaries rules for our architecture
			"boundaries/element-types": [
				"error",
				{
					default: "disallow",
					rules: [
						{
							from: ["routes"],
							allow: ["services"],
						},
						{
							from: ["services"],
							allow: ["services", "repo", "entities"],
						},
						{
							from: ["entities"],
							allow: ["entities"],
						},
						{
							from: ["repo"],
							allow: ["repo"],
						},
						{
							from: ["config"],
							disallow: ["*"],
						},
						{
							from: ["server"],
							allow: ["routes", "services", "config"],
						},
					],
				},
			],
		},
	},

	// Project-specific overrides
	{
		files: ["**/*.test.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"boundaries/element-types": "off",
		},
	},

	{
		ignores: ["node_modules/", "dist/", "coverage/", "*.js", "jest.config.js"],
	},
];
