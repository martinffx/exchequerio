---
name: exchequer-standards
description: "Exchequer engineering standards: architecture, layer boundaries, coding, testing and tooling conventions, plus app addenda for the Ledger API, customer portal and documentation site. Load before any development or documentation work in this repo."
user-invocable: false
---

# Exchequer Engineering Standards

These standards apply to code and public documentation in this repository. They are written for
both contributors and coding agents.

For any change, apply the architecture and coding sections below. Then read the addendum for the
affected app:

- Ledger API (`apps/api`): `references/api.md`. When persistence is involved, also read the
  [entity relationship diagram](../../../apps/api/docs/product/erd.md).
- Customer portal (`apps/web`): `references/web.md`.
- Documentation site (`apps/docs`): `references/documentation.md`.

Read only the relevant addendum. `CONTEXT.md` defines domain language and business invariants.
`AGENTS.md` routes repository work. The owning package manifest, configuration, and source remain
authoritative for installed tools and current behavior.

## Architecture

Exchequer is a pnpm monorepo with three applications:

- `apps/api` provides the Ledger API.
- `apps/web` provides the customer portal.
- `apps/docs` provides the public documentation site.

Keep changes inside the owning application unless code has a current consumer elsewhere. Do not add
a shared abstraction for a possible future use.

### Design discipline

Justify new tables, cached state, background processes, and abstractions against current
requirements. Prefer authoritative data over duplicated state unless a demonstrated need
justifies the consistency work.

Build one complete behavior path before expanding supporting machinery. Review whether each
component is still necessary alongside checking its correctness. The
[Balance Monitors retrospective](../../../docs/specs/2026-08-29-balance-monitors-effect/retro.md)
shows how changing guarantees and unnecessary state led to rework.

### Sources of truth

- `CONTEXT.md` owns domain terms, distinctions, and business invariants.
- `docs/adr/` records architectural decisions and trade-offs.
- The `exchequer-standards` skill records engineering standards shared by humans and agents.
- App-local product and specification documents record API behavior and data design.
- Source, configuration, and package manifests determine the implementation that exists now.

### Boundaries

Keep transport, orchestration, persistence, domain behavior, and presentation concerns in their
owning layers. Domain entities may transform data at system boundaries and enforce invariants, but
they do not perform I/O. Code that owns I/O also owns its operational failure translation.

- API dependencies flow from Routes to Services to Repositories and Entities to PostgreSQL. Keep
  transport validation in Routes, business orchestration in Services, persistence in Repositories,
  and transformations or invariants in Entities.
- Domain purity is a behavioral boundary, not an import ban. Following the Organization model,
  entities may own the `fromRequest`, `fromRow`, and `toRow` conversions they need, using
  synchronous or Effect-based decoding as defined by the API addendum and type-only transport or
  row contracts. They must not perform I/O. Repositories own SQL, transactions, and database error
  translation.
- Web work follows React Router framework conventions. Keep route composition in
  `apps/web/app/routes`, reusable UI in `apps/web/app/components`, and shared helpers in
  `apps/web/app/lib`.
- Public documentation uses Docusaurus under `apps/docs`.

API import boundaries are linted from `.oxlintrc.json`. New API source files must be classified
into an element there; `boundaries/no-unknown-files` fails lint for any unclassified file. Only
tests and benchmarks may import the test harness, and only API contracts, routes, and application
shell modules may import the HTTP transport framework.

Keep domain rules and feature-specific jobs with their owning domain. Extract shared
infrastructure when another current consumer needs it.

Preserve tenant boundaries and transactional consistency across every layer. Treat identifiers,
money amounts, lifecycle states, and concurrency controls as domain data rather than incidental
transport values.

## Coding

### Scope

Make the smallest change that satisfies the current requirement. Reuse existing source and platform
behavior. Add a shared abstraction only when a second current consumer needs it.

Preserve unrelated work in a dirty worktree. Keep migrations separate from product and
infrastructure changes unless the task explicitly joins those concerns.

### TypeScript

- Use the strict types and module conventions already configured by the owning package.
- Prefer inferred local types and explicit public contracts.
- Use type-only imports when a dependency is needed only for checking.
- Model expected failures using the error mechanism already used by the surrounding slice.
- Do not add decoding, normalization, or fallback behavior without a requirement for it.
- Keep comments for intent, constraints, and non-obvious trade-offs. Do not narrate the code.

### Tests

Use stub-driven TDD for changed behavior. Test at the narrowest layer that proves the contract, and
do not repeat the same assertion across layers. API integration tests use PostgreSQL.

### Tooling

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
