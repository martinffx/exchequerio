# Architecture

Exchequer is a pnpm monorepo with three applications:

- `apps/api` provides the Ledger API.
- `apps/web` provides the customer portal.
- `apps/docs` provides the public documentation site.

Keep changes inside the owning application unless code has a current consumer elsewhere. Do not add
a shared abstraction for a possible future use.

## Design discipline

Justify new tables, cached state, background processes, and abstractions against current
requirements. Prefer authoritative data over duplicated state unless a demonstrated need
justifies the consistency work.

Build one complete behavior path before expanding supporting machinery. Review whether each
component is still necessary alongside checking its correctness. The
[Balance Monitors retrospective](../specs/2026-08-29-balance-monitors-effect/retro.md)
shows how changing guarantees and unnecessary state led to rework.

## Sources of truth

- `CONTEXT.md` owns domain terms, distinctions, and business invariants.
- `docs/adr/` records architectural decisions and trade-offs.
- `docs/standards/` records engineering standards shared by humans and agents.
- App-local product and specification documents record API behavior and data design.
- Source, configuration, and package manifests determine the implementation that exists now.

## Boundaries

Keep transport, orchestration, persistence, domain behavior, and presentation concerns in their
owning layers. Domain entities may transform data at system boundaries and enforce invariants, but
they do not perform I/O. Code that owns I/O also owns its operational failure translation.

Keep domain rules and feature-specific jobs with their owning domain. Extract shared
infrastructure when another current consumer needs it.

Preserve tenant boundaries and transactional consistency across every layer. Treat identifiers,
money amounts, lifecycle states, and concurrency controls as domain data rather than incidental
transport values.

See the [API](./api.md), [web](./web.md), or [documentation](./documentation.md) addendum for concrete
application boundaries.
