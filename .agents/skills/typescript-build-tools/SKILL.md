---
name: typescript-build-tools
description: TypeScript project tooling with Bun or pnpm, TypeScript 7, Vitest, Biome or Oxc (Oxlint and Oxfmt), and Turborepo. Use when setting up package.json scripts, running builds, typechecking, configuring tests, linting, formatting, or orchestrating monorepo development.
user-invocable: false
---

# TypeScript Build Tools

Modern TypeScript build tooling stack: Bun or pnpm for package management and task running, the native TypeScript 7 compiler for typechecking, Vitest for testing, Biome or Oxc for linting/formatting, and Turborepo for monorepo orchestration.

## Additional References

- [references/bun.md](./references/bun.md) - Bun package manager and task runner
- [references/pnpm.md](./references/pnpm.md) - pnpm package manager, workspaces, and CI
- [references/vitest.md](./references/vitest.md) - Advanced Vitest configuration patterns
- [references/biome.md](./references/biome.md) - Biome rules and customization
- [references/oxc.md](./references/oxc.md) - Oxlint and Oxfmt configuration and migration
- [references/turborepo.md](./references/turborepo.md) - Turborepo monorepo orchestration

## Choose the Existing Toolchain

Follow the repository's existing lockfile, `packageManager` field, scripts, and configuration:

- Use Bun when the project has `bun.lock` or targets the Bun runtime.
- Use pnpm when the project has `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or a pnpm `packageManager` field.
- Use Biome when the project has `biome.json`; use Oxlint/Oxfmt when it has `.oxlintrc.*`, `oxlint.config.*`, `.oxfmtrc.*`, or `oxfmt.config.*`.
- Do not mix package managers, linters, or formatters unless the repository is already migrating between them.

pnpm replaces Bun's package-management and task-running roles, not Bun's runtime or bundler.

## Quick Start

```bash
# Bun + Biome
bun add -D typescript @types/bun vitest @vitest/coverage-v8 @biomejs/biome
bun add -D turbo # For monorepos

# pnpm + Oxc (Node runtime)
pnpm add -D typescript @types/node vitest @vitest/coverage-v8 oxlint oxfmt
pnpm add -D turbo # For monorepos
```

## Package.json Scripts

### Bun + Biome

```json
{
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "build": "bun build ./src/index.ts --outdir ./dist --target bun",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "check": "bun run typecheck && bun run lint && bun run test"
  }
}
```

### pnpm + Oxc

pnpm does not supply a runtime or bundler, so keep `dev` and `build` scripts specific to the project.

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "check": "pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run test"
  }
}
```

### Monorepo Root

```json
{
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "lint": "turbo lint",
    "format:check": "turbo format:check",
    "check": "turbo typecheck lint format:check test"
  }
}
```

## Bun

```bash
bun install
bun add fastify drizzle-orm
bun run dev
bun run test
bun run --watch src/index.ts
bun build ./src/index.ts --outdir ./dist --target bun
```

Use `bun run test`, not `bun test`, on Bun-managed Node projects because `bun test` invokes Bun's native test runner. See [references/bun.md](./references/bun.md) for dependency management, runtime execution, building, workspaces, configuration, and CI.

## pnpm

Use `pn` as an optional shorthand in interactive shells:

```bash
alias pn=pnpm
```

Keep documentation, `package.json` scripts, and CI commands on canonical `pnpm`; shell aliases are not available in every non-interactive environment.

```bash
pnpm install
pnpm add fastify drizzle-orm
pnpm add -D typescript vitest oxlint oxfmt
pnpm run test
pnpm exec tsc --noEmit
pnpm -r run test
pnpm --filter './packages/**' run build
```

Commit `pnpm-lock.yaml`, define workspaces in `pnpm-workspace.yaml`, and pin pnpm with the `packageManager` field. See [references/pnpm.md](./references/pnpm.md) for dependency management, workspace filtering, CI, and troubleshooting.

## TypeScript 7 Native Compiler

TypeScript 7 is the stable, native Go implementation of TypeScript. Install the standard `typescript` package and use its `tsc` executable; `@typescript/native-preview` and `tsgo` were preview names.

```bash
# Install TypeScript 7
pnpm add -D typescript

# Typecheck without emitting
pnpm exec tsc --noEmit

# Use an explicit project
pnpm exec tsc --noEmit -p tsconfig.json

# Build project references
pnpm exec tsc --build

# Bun equivalent
bunx tsc --noEmit
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

Install `@types/node` for Node projects. For Bun runtime projects, install `@types/bun` and use `"types": ["bun"]` instead.

TypeScript 7.0 does not expose the legacy programmatic compiler API. Frameworks and tools that embed that API may still require TypeScript 6 until they add TypeScript 7 support; follow their compatibility guidance instead of forcing an upgrade.

## Vitest

### Basic Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
    },
  },
})
```

### With Path Aliases

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
  },
})
```

### Global Setup (Database Migrations)

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    globalSetup: './test/global-setup.ts',
    setupFiles: ['./test/setup.ts'],
  },
})
```

```typescript
// test/global-setup.ts
import { execSync } from 'node:child_process'

export async function setup() {
  console.log('Running database migrations...')
  execSync('drizzle-kit migrate', { stdio: 'inherit' })
}

export async function teardown() {
  console.log('Test teardown complete')
}
```

See [references/vitest.md](./references/vitest.md) for workspace configs, benchmarks, and Cloudflare Workers pool.

## Biome

### Basic biome.json

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true,
    "ignore": ["dist", "node_modules", "*.gen.ts"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "es5"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "organizeImports": {
    "enabled": true
  }
}
```

### Strict Rules (Production)

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noForEach": "error"
      },
      "performance": {
        "noDelete": "error"
      },
      "style": {
        "useNodejsImportProtocol": "error"
      }
    }
  }
}
```

See [references/biome.md](./references/biome.md) for rule explanations, shareable configs, and CLI commands.

## Oxc (Oxlint + Oxfmt)

Use Oxlint for linting and Oxfmt for formatting when the repository has adopted the Oxc toolchain.

```bash
oxlint --init
oxlint
oxlint --fix
oxfmt --init
oxfmt
oxfmt --check
```

Keep `tsc --noEmit` as the default typecheck step. Type-aware Oxlint rules require `oxlint-tsgolint`; do not adopt the experimental `--type-check` mode implicitly. See [references/oxc.md](./references/oxc.md) for configuration, type-aware rules, migration, editors, and CI.

## Turborepo (Monorepo)

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "lint": {},
    "format:check": {},
    "test": {
      "dependsOn": ["^build"],
      "env": ["DATABASE_URL"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### Workspace Structure

```
my-monorepo/
├── package.json          # Root with turbo scripts
├── turbo.json            # Turbo configuration
├── pnpm-workspace.yaml   # pnpm workspaces; omit for Bun-only repos
├── biome.json            # Biome projects; use Oxc config files instead for Oxc
├── packages/
│   ├── config-biome/     # Shareable Biome package
│   └── shared/           # Shared utilities
├── apps/
│   ├── api/              # Fastify API
│   └── web/              # React app
└── pnpm-lock.yaml        # Or bun.lock for Bun projects
```

See [references/turborepo.md](./references/turborepo.md) for caching strategies, filtering, and CI setup.

## Cloudflare Workers

### Vite + Cloudflare Plugin

```typescript
// vite.config.ts
import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
})
```

### Vitest with Cloudflare Workers Pool

```typescript
// vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    globals: true,
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
})
```

## CI Pipeline

### GitHub Actions

```yaml
name: typescript-build-tools

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install --frozen-lockfile

      - run: bun run typecheck
      - run: bun run lint
      - run: bun run test
```

### Monorepo CI with Turbo

```yaml
name: typescript-build-tools

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2

      - run: bun install --frozen-lockfile

      - run: bun run check  # turbo typecheck lint format:check test
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}
```

For pnpm setup, dependency caching, and an Oxc check job, use the CI pattern in [references/pnpm.md](./references/pnpm.md) together with the scripts in [references/oxc.md](./references/oxc.md).

## Guidelines

1. **Preserve the existing toolchain** indicated by lockfiles, configs, and `packageManager`
2. **Use Bun or pnpm consistently**; do not create competing lockfiles
3. **Use `bun run test`** (not `bun test`) on Bun-managed Node projects
4. **Use `pn` only as an interactive alias**; use canonical `pnpm` in shared automation
5. **Use TypeScript 7's `tsc`** for native typechecking and builds
6. **Use Vitest** for fast, ESM-native testing
7. **Choose one lint/format stack**: Biome or Oxlint plus Oxfmt
8. **Use safe lint fixes by default**: `biome check --write` or `oxlint --fix`
9. **Check formatting in CI** when using Oxfmt: `oxfmt --check`
10. **Use Turborepo** for monorepo caching and task orchestration
11. **Run checks in order**: typecheck, lint, format check, test (fail fast)
12. **Use `--frozen-lockfile`** in CI for reproducible installs
13. **Enable V8 coverage** and configure Vitest workspace/global setup as needed
