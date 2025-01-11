/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
	testEnvironment: "node",
	moduleNameMapper: {
		// Map your path aliases
		"^@/(.*)$": "<rootDir>/src/$1",
	},
	transform: {
		"^.+.tsx?$": ["ts-jest", {}],
	},
	testMatch: ["<rootDir>/src/**/*.test.ts"],
	collectCoverageFrom: [
		"src/**/*.{js,ts}",
		"!src/**/*.d.ts",
		"!src/**/*.test.ts",
	],
	coverageDirectory: "coverage",
};
