# Exchequer Agent Guide

Exchequer is an operational double-entry subledger for organizations with treasury operations. Use [CONTEXT.md](./CONTEXT.md) as the canonical source for domain language and business invariants.

## Before making changes

Read only the documents relevant to the work:

1. Read [CONTEXT.md](./CONTEXT.md) before changing domain behavior, names, API resources, schemas, or public documentation.
2. Read the applicable product and engineering documents from the map below.
3. Use a repository skill from [`.agents/skills`](./.agents/skills/) when its subject matches the task.
4. Inspect the owning `package.json` and existing source before relying on a documented technology or command.

## Repository map

| Scope | Source | Required references |
| --- | --- | --- |
| Ledger API | `apps/api/` | [Architecture](./apps/api/docs/standards/architecture.md), [coding standards](./apps/api/docs/standards/coding.md), [ERD](./apps/api/docs/product/erd.md), and the relevant document under [`apps/api/docs/spec`](./apps/api/docs/spec/) |
| Customer portal | `apps/web/` | [Architecture](./apps/web/docs/standards/architecture.md) and [coding standards](./apps/web/docs/standards/coding.md) |
| Documentation site | `apps/docs/` | [Content standards](./apps/docs/docs/standards/coding.md) and [CONTEXT.md](./CONTEXT.md) for all Ledger terminology |

## Agent workflow

- Use `atelier-orchestrator` at the start of development work. It selects an Inline Plan for bounded changes or a Spec-backed Plan when durable design and coordination artifacts are warranted.
- Use `ponytail` at full intensity for development work. Prefer the smallest behavior-preserving change, reuse existing code and platform behavior, and defer shared abstractions until a second current consumer exists.
- Keep migrations separate from product and infrastructure changes unless the broader scope is explicitly requested.
- Treat skills as decision guidance, not implementation checklists; the task and existing source determine which patterns apply.
- Read [domain documentation guidance](./docs/agents/domain.md) before domain-modelling work. Maintain `CONTEXT.md` as a glossary, not an implementation specification.
- Read [issue-tracker guidance](./docs/agents/issue-tracker.md) when issue tracking is relevant. `plan.json` remains authoritative for Spec-backed task details and dependencies.
- Preserve unrelated work in a dirty worktree. Do not commit, push, or open a pull request unless explicitly requested.

## Repository skills

Use these project-owned skills when their descriptions match the task:

- [typescript-api-design](./.agents/skills/typescript-api-design/SKILL.md) — REST resources, endpoints, errors, pagination, and versioning.
- [typescript-fastify](./.agents/skills/typescript-fastify/SKILL.md) — Fastify routes, plugins, TypeBox validation, and OpenAPI wiring.
- [typescript-drizzle-orm](./.agents/skills/typescript-drizzle-orm/SKILL.md) — database schemas, queries, relations, and migrations.
- [typescript-functional-patterns](./.agents/skills/typescript-functional-patterns/SKILL.md) — state machines, discriminated unions, branded types, and typed domain models.
- [typescript-effect-ts](./.agents/skills/typescript-effect-ts/SKILL.md) — Effect programs, typed errors, Layers, and resource management when Effect is actually in scope.
- [typescript-testing](./.agents/skills/typescript-testing/SKILL.md) — Vitest, MSW, typed mocks, and snapshots when that tooling is installed in the owning package.
- [typescript-build-tools](./.agents/skills/typescript-build-tools/SKILL.md) — TypeScript package, build, type-check, test, lint, format, and Turborepo guidance.

Skills provide task guidance; they do not prove that a dependency is installed. The owning package manifest and source are authoritative.

## Architecture boundaries

- API dependencies flow from Routes to Services to Repositories and Entities to PostgreSQL. Keep transport validation in Routes, business orchestration in Services, persistence in Repositories, and transformations or invariants in Entities.
- Web work follows React Router framework conventions. Keep route composition in `apps/web/app/routes`, reusable UI in `apps/web/app/components`, and shared helpers in `apps/web/app/lib`.
- Public documentation uses Docusaurus under `apps/docs`; follow its content standard rather than duplicating writing conventions here.
- Use stub-driven TDD for changed behavior and keep tests at the narrowest useful layer. Avoid repeating the same contract across layers. API integration tests use PostgreSQL.

## Commands

Run commands from the repository root unless noted otherwise.

```bash
pnpm install

pnpm run dev              # PostgreSQL and all apps
pnpm run dev:api          # PostgreSQL and API
pnpm run dev:web          # Web only
pnpm run dev:docs         # Documentation site only

pnpm run build            # Build all buildable apps
pnpm run check            # Check formatting, lint, and types
pnpm run test             # Start PostgreSQL and run Vitest suites
pnpm run ci               # Full local CI pipeline

pnpm --filter=@exchequerio/api test
pnpm --filter=@exchequerio/api test:watch
pnpm --filter=@exchequerio/api db:gen
pnpm --filter=@exchequerio/api db:migrate
```

Tests use Vitest through the package scripts. Start PostgreSQL with `pnpm run docker:up` before
targeted API tests when it is not already running. Copy `apps/api/.env.example` to
`apps/api/.env` for the documented local defaults.
