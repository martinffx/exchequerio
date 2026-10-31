# Exchequer Agent Guide

Exchequer is an operational double-entry subledger for organizations with treasury operations. Use [CONTEXT.md](./CONTEXT.md) as the canonical source for domain language and business invariants.

## Before making changes

Read only the documents relevant to the work:

1. Read [CONTEXT.md](./CONTEXT.md) before changing domain behavior, names, API resources, schemas, or public documentation.
2. Read the applicable product and engineering documents from the map below.
3. Use a repository skill from [`.agents/skills`](./.agents/skills/) when its subject matches the task.
4. Inspect the owning `package.json` and existing source before relying on a documented technology or command.

## Repository map

| Scope              | Source       | Required references                                                                                                                                                    |
| ------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger API         | `apps/api/`  | [Shared standards](./docs/standards/README.md), [API addendum](./docs/standards/api.md), and [ERD](./apps/api/docs/product/erd.md)                                     |
| Customer portal    | `apps/web/`  | [Shared standards](./docs/standards/README.md) and [web addendum](./docs/standards/web.md)                                                                             |
| Documentation site | `apps/docs/` | [Shared standards](./docs/standards/README.md), [documentation addendum](./docs/standards/documentation.md), and [CONTEXT.md](./CONTEXT.md) for all Ledger terminology |

## Agent workflow

- Use `atelier-orchestrator` at the start of development work. It selects an Inline Plan for bounded changes or a Spec-backed Plan when durable design and coordination artifacts are warranted.
- Use `ponytail` at full intensity for development work. Prefer the smallest behavior-preserving change, reuse existing code and platform behavior, and defer shared abstractions until a second current consumer exists.
- State required guarantees and acceptable failures in the plan before implementation. Revise the approved plan when those change.
- Check existing solutions and concurrent changes to shared dependencies before substantial work.
- Treat framework and architecture migrations as behavior-preserving. Before implementation, list every intended change to API behavior, domain rules, persistence, errors, identifiers, time, or operational behavior; the default is none. Stop and split the work if implementation discovers an unlisted change.
- Keep migrations separate from product and infrastructure changes unless the broader scope is explicitly requested.
- Treat skills as decision guidance, not implementation checklists; the task and existing source determine which patterns apply.
- Read [domain documentation guidance](./docs/agents/domain.md) before domain-modelling work. Maintain `CONTEXT.md` as a glossary, not an implementation specification.
- Read [issue-tracker guidance](./docs/agents/issue-tracker.md) when issue tracking is relevant. `plan.json` remains authoritative for Spec-backed task details and dependencies.
- Preserve unrelated work in a dirty worktree. Do not commit, push, or open a pull request unless explicitly requested.
- Report checks actually executed and their results separately from tests added.

## Repository skills

Use these project-owned skills when their descriptions match the task:

- [typescript-api-design](./.agents/skills/typescript-api-design/SKILL.md) — REST resources, endpoints, errors, pagination, and versioning.
- [typescript-drizzle-orm](./.agents/skills/typescript-drizzle-orm/SKILL.md) — database schemas, queries, relations, and migrations.
- [typescript-functional-patterns](./.agents/skills/typescript-functional-patterns/SKILL.md) — state machines, discriminated unions, branded types, and typed domain models.
- [typescript-effect-ts](./.agents/skills/typescript-effect-ts/SKILL.md) — Effect programs, typed errors, Layers, and resource management when Effect is actually in scope.
- [typescript-testing](./.agents/skills/typescript-testing/SKILL.md) — Vitest, MSW, typed mocks, and snapshots when that tooling is installed in the owning package.
- [typescript-build-tools](./.agents/skills/typescript-build-tools/SKILL.md) — TypeScript package, build, type-check, test, lint, format, and Turborepo guidance.

Skills provide task guidance; they do not prove that a dependency is installed. The owning package manifest and source are authoritative.

## Architecture boundaries

- API dependencies flow from Routes to Services to Repositories and Entities to PostgreSQL. Keep transport validation in Routes, business orchestration in Services, persistence in Repositories, and transformations or invariants in Entities.
- Treat domain purity as a behavioral boundary, not an import ban. Following the Organization model, entities may own the `fromRequest`, `fromRow`, and `toRow` conversions they need, using synchronous or Effect-based decoding as defined by the API standard and type-only transport or row contracts. They must not perform I/O. Repositories own SQL, transactions, and database error translation.
- Web work follows React Router framework conventions. Keep route composition in `apps/web/app/routes`, reusable UI in `apps/web/app/components`, and shared helpers in `apps/web/app/lib`.
- Public documentation uses Docusaurus under `apps/docs`; follow the [documentation addendum](./docs/standards/documentation.md) rather than duplicating writing conventions here.
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
pnpm run test             # Run Vitest suites (API tests start their own PostgreSQL and Valkey via Docker)
pnpm run ci               # Full local CI pipeline

pnpm --filter=@exchequerio/api test
pnpm --filter=@exchequerio/api test:watch
pnpm --filter=@exchequerio/api db:gen
pnpm --filter=@exchequerio/api db:migrate
```

Tests use Vitest through the package scripts. API tests start throwaway PostgreSQL and Valkey
containers (Testcontainers), so Docker must be running; nothing else needs to be started first. Copy `apps/api/.env.example` to
`apps/api/.env` for the documented local defaults.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:46cd31e7 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
