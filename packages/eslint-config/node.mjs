// @ts-check
import baseConfig from "./base.mjs";
import boundaries from "eslint-plugin-boundaries";

export default [
	...baseConfig,
	// Architectural boundaries for Node/API apps
	{
		settings: {
			"boundaries/elements": [
				{ type: "routes", pattern: "src/routes/**/*" },
				{ type: "services", pattern: "src/services/**/*" },
				{ type: "entities", pattern: "src/repo/entities/**/*" },
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
							allow: ["repo", "entities"],
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
];
