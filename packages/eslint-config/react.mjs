// @ts-check
import baseConfig from "./base.mjs";

export default [
	...baseConfig,
	// React-specific rules can be added here
	{
		files: ["**/*.tsx", "**/*.jsx"],
		rules: {
			// Add React-specific rules if needed
		},
	},
];
