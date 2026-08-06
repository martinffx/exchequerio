# Oxc Linting and Formatting

Use Oxlint for JavaScript and TypeScript linting and Oxfmt for formatting. They are separate tools built on the Oxc compiler stack, so configure and invoke both when replacing an integrated tool such as Biome.

## Installation and Scripts

```bash
pnpm add -D oxlint oxfmt
```

```json
{
  "scripts": {
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "format": "oxfmt",
    "format:check": "oxfmt --check"
  }
}
```

Use `oxlint --fix` for safe fixes. Suggestions and dangerous fixes may change behavior and should be reviewed separately rather than added to the default fix script.

## Oxlint

### Initialize and Run

```bash
pnpm exec oxlint --init
pnpm exec oxlint
pnpm exec oxlint src test
pnpm exec oxlint --fix
pnpm exec oxlint --report-unused-disable-directives
```

Oxlint discovers `.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts`, or `oxlint.config.mts`. Prefer JSON/JSONC unless the repository needs programmatic configuration; JavaScript and TypeScript configuration requires Node.js.

### Basic Configuration

```json
{
  "plugins": ["typescript", "vitest"],
  "categories": {
    "correctness": "error"
  },
  "rules": {
    "typescript/no-explicit-any": "warn",
    "vitest/no-focused-tests": "error"
  },
  "ignorePatterns": ["dist/**", "coverage/**", "**/*.gen.ts"]
}
```

Start with correctness rules and add stricter categories or individual rules in response to concrete project requirements. Avoid enabling every category at once on an established codebase.

### Overrides

```json
{
  "overrides": [
    {
      "files": ["test/**/*.ts", "**/*.test.ts"],
      "rules": {
        "typescript/no-explicit-any": "off"
      }
    },
    {
      "files": ["**/*.gen.ts"],
      "rules": {
        "eslint/no-unused-vars": "off"
      }
    }
  ]
}
```

Prefer an override when a rule differs for a file class. Use inline disable comments only for isolated exceptions, and include a reason when the exception is not obvious.

### Type-Aware Linting

Install the companion package before enabling rules that require TypeScript type information:

```bash
pnpm add -D oxlint-tsgolint
pnpm exec oxlint --type-aware
```

Enable it in the root configuration when the whole repository is ready:

```json
{
  "plugins": ["typescript"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "typescript/no-floating-promises": "error",
    "typescript/no-unsafe-assignment": "warn"
  }
}
```

Type-aware linting uses TypeScript 7 semantics and automatically discovers the relevant `tsconfig.json`. In monorepos, install dependencies and build prerequisite declaration files before linting when packages consume generated declarations.

Keep `tsc --noEmit` as the normal typecheck step. Oxlint's `--type-check` mode is experimental; use it only when a repository has deliberately adopted and validated it.

### Fix Modes

```bash
# Safe fixes
pnpm exec oxlint --fix

# Suggestions that may alter behavior
pnpm exec oxlint --fix-suggestions

# Aggressive fixes that require careful review
pnpm exec oxlint --fix-dangerously
```

Do not put suggestion or dangerous modes in an automatic pre-commit or CI autofix workflow.

## Oxfmt

### Initialize and Run

```bash
pnpm exec oxfmt --init
pnpm exec oxfmt
pnpm exec oxfmt --check
pnpm exec oxfmt --list-different
```

Running `oxfmt` without paths formats the current directory. Use `--check` in CI so verification never rewrites tracked files.

### Basic Configuration

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "sortImports": {},
  "ignorePatterns": ["dist/**", "coverage/**", "**/*.gen.ts"]
}
```

Store shared formatting decisions in `.oxfmtrc.json` or `oxfmt.config.ts`; do not depend on unsupported style flags in package scripts. Oxfmt also reads common `.editorconfig` indentation and line-width settings.

### Migrate from Prettier

```bash
pnpm exec oxfmt --migrate prettier
pnpm exec oxfmt --check
```

Review the generated configuration and a representative formatting diff before removing Prettier. Keep only one active formatter after migration to prevent files from oscillating between styles.

## Migrate from ESLint

Generate an Oxlint configuration from the existing ESLint setup:

```bash
pnpm dlx @oxlint/migrate
pnpm exec oxlint
```

For large or plugin-heavy repositories, migrate incrementally: run Oxlint first, then ESLint with overlapping rules disabled through `eslint-plugin-oxlint`. Keep ESLint only for rules or plugins that Oxlint does not yet support, and record what must happen before removing it.

## Monorepos

Put the shared root configuration beside `pnpm-workspace.yaml`. Oxlint and Oxfmt support nested configurations for packages that need overrides.

```text
my-monorepo/
├── .oxlintrc.json
├── .oxfmtrc.json
├── pnpm-workspace.yaml
├── apps/
│   └── web/
│       └── .oxlintrc.json
└── packages/
    └── shared/
```

Add `lint` and `format:check` scripts to each package when Turborepo orchestrates those tasks. Keep write-oriented formatting outside cached check pipelines.

## Editor Integration

Install the official Oxc editor extension and let it discover the repository configuration. Type-aware editor linting can follow the root config or be explicitly enabled in VS Code:

```json
{
  "oxc.typeAware": true,
  "editor.formatOnSave": true
}
```

Do not configure two default formatters for the same language. Remove or disable Biome/Prettier format-on-save settings after completing a migration to Oxfmt.

## Pre-commit Checks

With `lint-staged`, restrict tools to staged files and safe fixes:

```json
{
  "lint-staged": {
    "*.{js,jsx,ts,tsx,mjs,cjs}": [
      "oxlint --fix",
      "oxfmt --no-error-on-unmatched-pattern"
    ],
    "*.{json,jsonc,css,md,yaml,yml}": "oxfmt --no-error-on-unmatched-pattern"
  }
}
```

Run the full repository checks in CI even when pre-commit hooks are configured; hooks can be skipped and may not cover cross-file or type-aware rules.

## Continuous Integration

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm run typecheck
- run: pnpm run lint
- run: pnpm run format:check
- run: pnpm run test
```

Keep linting and format checks read-only in CI. If the repository uses Turborepo, expose `lint` and `format:check` as separate cacheable tasks.

## Troubleshooting

### Unexpected Configuration

```bash
pnpm exec oxlint --print-config
```

Check for nested configuration before adding command-line overrides. Explicit `-c` configuration paths disable normal nested lookup and should be reserved for unusual layouts.

### No Files Matched

Use `--no-error-on-unmatched-pattern` only for commands that legitimately receive an empty staged-file list. A full CI command that unexpectedly matches no source files should fail and prompt a path/configuration fix.

### Type-Aware Linting Is Slow

```bash
pnpm exec oxlint --type-aware --debug timings
```

Check `tsconfig.json` include/exclude patterns and generated declaration prerequisites before disabling rules or adding concurrency workarounds.

## Best Practices

1. Install Oxlint and Oxfmt as project development dependencies.
2. Use one linter/formatter stack after migration.
3. Keep safe fixes separate from suggestions and dangerous fixes.
4. Keep `tsc --noEmit` as the stable typecheck step.
5. Use `oxfmt --check` rather than write mode in CI.
6. Start with correctness rules and add stricter rules incrementally.
7. Use nested configs only when package requirements genuinely differ.
8. Run full checks in CI even when editor and pre-commit integrations exist.

See the official [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) and [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) documentation for complete configuration and CLI references.
