# Coding

## Scope

Make the smallest change that satisfies the current requirement. Reuse existing source and platform
behavior. Add a shared abstraction only when a second current consumer needs it.

Preserve unrelated work. Keep migrations separate from product and infrastructure changes unless
the task explicitly joins those concerns.

## TypeScript

- Use the strict types and module conventions already configured by the owning package.
- Prefer inferred local types and explicit public contracts.
- Use type-only imports when a dependency is needed only for checking.
- Model expected failures using the error mechanism already used by the surrounding slice.
- Do not add decoding, normalization, or fallback behavior without a requirement for it.
- Keep comments for intent, constraints, and non-obvious trade-offs. Do not narrate the code.

## Tests

Use stub-driven TDD for changed behavior. Test at the narrowest layer that proves the contract, and
do not repeat the same assertion across layers. API integration tests use PostgreSQL.

## Tooling

Run commands from the repository root unless a package says otherwise. Inspect the owning
`package.json` before choosing a command.

```bash
pnpm run check
pnpm run test
pnpm run build
pnpm run ci
```

Oxc formats and lints the TypeScript packages. Turborepo runs package tasks. Root Markdown outside a
package may need a direct `pnpm exec oxfmt --check` invocation.
