// @ts-check
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import unicorn from "eslint-plugin-unicorn";

export default [
  // TypeScript base (type-aware only)
  ...tseslint.configs.recommendedTypeChecked,

  // Global TypeScript config
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow unused variables with _ prefix (common convention)
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Disable require-await rule
      "@typescript-eslint/require-await": "off",
    },
  },

  // Unicorn rules (high-value ones not in Biome)
  {
    plugins: { unicorn },
    rules: {
      // Critical unicorn rules missing from Biome
      "unicorn/no-array-reduce": "error",
      "unicorn/no-null": "error",
      "unicorn/prefer-spread": "error",
      "unicorn/prefer-module": "error",
      "unicorn/prefer-set-has": "error",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/catch-error-name": "error",
      "unicorn/consistent-destructuring": "error",
      "unicorn/no-array-callback-reference": "error",
      "unicorn/prefer-export-from": "error",
      "unicorn/no-for-loop": "error",
      "unicorn/prefer-includes": "error",
      "unicorn/better-regex": "error",
      "unicorn/consistent-function-scoping": "error",
      "unicorn/no-useless-spread": "error",
      "unicorn/prefer-top-level-await": "error",
      "unicorn/prefer-object-from-entries": "error",
      "unicorn/prefer-array-find": "error",
    },
  },

  // Architectural boundaries (preserve existing rules)
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

  // TypeScript strictness (preserve existing)
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Explicitly prohibit any type assertions
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    ignores: ["node_modules/", "dist/", "coverage/", "*.js", "jest.config.js"],
  },
];
