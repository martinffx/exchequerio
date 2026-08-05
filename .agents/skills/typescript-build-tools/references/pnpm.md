# pnpm Package Manager and Workspaces

Use pnpm for dependency management and package-script execution in Node.js projects and monorepos. pnpm is not a JavaScript runtime or bundler; keep those scripts tied to the runtime and build tool selected by the project.

## Project Setup

Pin pnpm in the root `package.json` so local development and CI use the same release:

```json
{
  "packageManager": "pnpm@11.10.0"
}
```

Use the version already pinned by the repository. Change it only as an intentional dependency upgrade.

### Interactive Alias

Use `pn` as an optional local shell shorthand:

```bash
alias pn=pnpm
```

Use canonical `pnpm` in documentation, package scripts, hooks, containers, and CI because aliases are not reliably loaded by non-interactive shells.

## Dependency Management

```bash
# Install the project
pnpm install

# Verify a committed lockfile without changing it
pnpm install --frozen-lockfile

# Add runtime and development dependencies
pnpm add fastify drizzle-orm
pnpm add -D typescript vitest oxlint oxfmt

# Remove or update dependencies
pnpm remove package-name
pnpm update
pnpm update package-name

# Inspect dependencies
pnpm list
pnpm why package-name
pnpm outdated
```

Commit `pnpm-lock.yaml`. Do not generate a Bun, npm, or Yarn lockfile in the same project unless a documented migration is in progress.

## Running Commands

### Package Scripts

```bash
pnpm run dev
pnpm run build
pnpm run test
pnpm run typecheck
```

Scripts without a conflicting pnpm command can use the shorter form (`pnpm dev`), but prefer `pnpm run <script>` in shared instructions because it is explicit.

### Installed and One-Off Binaries

```bash
# Run a binary installed in the project
pnpm exec tsc --noEmit
pnpm exec vitest run

# Run a package without adding it to package.json
pnpm dlx package-name
```

Prefer a committed development dependency plus `pnpm exec` for repeatable project tooling. Reserve `pnpm dlx` for genuinely one-off commands.

## Workspaces

Define packages in the root `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Use the workspace protocol for internal dependencies:

```json
{
  "dependencies": {
    "@myorg/shared": "workspace:*"
  }
}
```

### Running Workspace Scripts

```bash
# Run in every workspace package that defines the script
pnpm -r --if-present run test

# Run in one named package
pnpm --filter @myorg/api run dev

# Select packages by directory
pnpm --filter './packages/**' run build

# Select a package and its dependencies
pnpm --filter @myorg/api... run build

# Select packages changed since the main branch
pnpm --filter '...[origin/main]' run test
```

The recursive `run` command excludes the workspace root unless `includeWorkspaceRoot` is enabled. Use Turborepo when task dependencies, caching, or persistent development processes need orchestration beyond pnpm's filtering.

### Adding Workspace Dependencies

```bash
# Add to one package
pnpm --filter @myorg/api add fastify

# Add a root development dependency
pnpm add -Dw turbo

# Link an internal workspace package
pnpm --filter @myorg/api add @myorg/shared@workspace:*
```

## Package Scripts

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "check": "pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run test"
  }
}
```

Keep runtime and bundling commands project-specific. pnpm executes `dev` and `build` scripts but does not provide their underlying runtime or compiler.

## Continuous Integration

Pin pnpm through `packageManager`, enable dependency caching, and use a frozen lockfile:

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

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v6
        with:
          node-version: lts/*
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm run check
```

`pnpm install` is recursive inside a workspace. Do not add a separate install loop for each package.

## Common Problems

### A Dependency Is Not Resolvable

pnpm's dependency layout prevents packages from importing undeclared dependencies. Add the missing direct dependency to the package that imports it instead of enabling broad hoisting.

```bash
pnpm --filter @myorg/api add missing-package
```

### Peer Dependency Errors

Inspect the dependency path before adding overrides:

```bash
pnpm why package-name
pnpm list --depth 10
```

Prefer compatible package versions. Use `peerDependencyRules` or overrides only for a known incompatibility with a documented removal condition.

### Lockfile Is Out of Date

Regenerate it intentionally in a development environment, review the diff, and commit the manifest and `pnpm-lock.yaml` together:

```bash
pnpm install
git diff -- package.json pnpm-lock.yaml
```

### Store Maintenance

```bash
# Show the content-addressable store location
pnpm store path

# Remove unreferenced packages from the store
pnpm store prune
```

Do not clear the store as a routine fix; first determine whether the failure is a manifest, lockfile, registry, or network problem.

## Best Practices

1. Pin pnpm with the root `packageManager` field.
2. Commit one `pnpm-lock.yaml` for the workspace.
3. Use canonical `pnpm` outside interactive shells.
4. Use `--frozen-lockfile` in CI.
5. Declare dependencies in the package that imports them.
6. Use `workspace:*` for internal packages.
7. Prefer filters for targeted work and Turborepo for cached task graphs.
8. Review lockfile changes alongside manifest changes.

See the official [pnpm documentation](https://pnpm.io/) for the complete CLI and configuration reference.
