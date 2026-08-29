# Effect migration guide

This guide coordinates the Ledger API's incremental move to Effect. It does not define product
behavior or authorize domain, API, or database redesign.

## Migration contract

An Effect migration changes the execution mechanism while preserving:

- routes, request and response bodies, status codes, headers, and error semantics;
- domain terms, invariants, lifecycle behavior, and tenancy;
- database schemas, stored data, queries, transactions, locking, and concurrency behavior;
- identifier, timestamp, retry, and idempotency behavior; and
- operational dependencies and failure behavior.

The relevant product documents, `CONTEXT.md`, existing public contracts, and current source define
that behavior. [The API standard](./docs/standards/api.md) defines ownership between layers. This
guide defines migration sequence and method only.

Record each proposed deviation as separate follow-up work. The migration itself has no deviations.
If implementation discovers a required behavior, domain, schema, or operational change, stop and
split it into a separate plan and change set. Feature completion, placeholder removal, Currency
changes, and Asset design are not part of an Effect migration.

## Reference implementation

Use Organizations as the basic pattern:

- `Organization.ts` owns entity construction, invariants, and the request, row, and response codecs
  that it needs.
- `OrganizationRepo.ts` owns SQL, transactions, missing-row handling, and database error translation.
- `OrganizationService.ts` owns use-case orchestration and dependencies.
- `OrganizationRoutes.ts` owns HTTP behavior and runs the application Effect.

Also inspect the nearest approved, integrated slice for resource-specific behavior. Copy a pattern
only when the target has the same need. Do not add every Organization codec merely for symmetry.
Preserve the target's existing names and layout unless a separate architecture change has been
approved.

## Plan gate

Before implementation, the slice plan must identify:

1. The completed reference slice it will follow.
2. The current HTTP, domain, persistence, error, and operational behavior that must remain unchanged.
3. Confirmation that the migration has no deviations, with links to separate follow-up work for any
   proposed behavior changes.
4. The owner of every new validation or conversion.
5. The concrete requirement for each proposed service, Layer, decoder, error, or abstraction.

Do not start implementation while a deviation remains in scope. Stop during implementation if the
change introduces a contract change, database migration, duplicated validation, handwritten mirror
type, or material increase in scaffolding.

## Implementation rules

- Migrate one small vertical slice at a time. Keep each batch independently testable and review its
  diff before starting the next batch.
- Keep Fastify and TypeBox at the HTTP and OpenAPI boundary. Keep Drizzle as the PostgreSQL adapter.
- Keep necessary transformations and invariants on entities. Add `fromRequest`, `fromRow`, `toRow`,
  or response methods only when the resource needs that conversion. Do not repeat TypeBox or
  database guarantees there.
- Keep SQL, transactions, optimistic concurrency, and database error translation in repositories.
- Keep time, retries, idempotency, and use-case orchestration in services.
- Create services and Layers only for real dependencies or resource lifetimes. Reuse the managed
  runtime and existing error mapping.
- Keep pure, total transformations synchronous. Use an Effect pipeline when it carries a possible
  failure, dependency, lifetime, or concurrency behavior that the caller must handle.
- Derive request, response, and row types from TypeBox and Drizzle. Do not create parallel models for
  the same representation.
- Test changed wiring and preserved behavior at the narrowest useful layer. Do not repeat the same
  contract across route, service, repository, and entity tests.

## Program sequence

The integration branch is `feat/effect-migration`.

```text
01 Organizations
       |
02 Ledgers
       |
03 Accounts
       |
04 Transactions
       |
       +-- 05 Categories
       +-- 06 Settlements
       +-- 07 Statements
       +-- 08 Balance Monitors
```

| Step                | Branch                         | Worktree                             | Depends on         |
| ------------------- | ------------------------------ | ------------------------------------ | ------------------ |
| 01 Organizations    | `feat/organizations-effect`    | `.worktrees/organizations-effect`    | integration branch |
| 02 Ledgers          | `feat/ledgers-effect`          | `.worktrees/ledgers-effect`          | step 01            |
| 03 Accounts         | `feat/accounts-effect`         | `.worktrees/accounts-effect`         | step 02            |
| 04 Transactions     | `feat/transactions-effect`     | `.worktrees/transactions-effect`     | step 03            |
| 05 Categories       | `feat/categories-effect`       | `.worktrees/categories-effect`       | step 04            |
| 06 Settlements      | `feat/settlements-effect`      | `.worktrees/settlements-effect`      | step 04            |
| 07 Statements       | `feat/statements-effect`       | `.worktrees/statements-effect`       | step 04            |
| 08 Balance Monitors | `feat/balance-monitors-effect` | `.worktrees/balance-monitors-effect` | step 04            |

Steps 05 through 08 may proceed in parallel after step 04 is integrated when their file ownership is
independent. Integrate them serially. Rebase each branch onto the latest integration branch and run
the full validation suite before integration. Stop and reconcile the plans if two steps require
incompatible shared changes.

Branch creation, commits, merges, pushes, pull requests, and worktree removal require explicit
authorization.

## Prompt template

Use this prompt for each remaining resource:

```text
/spec-brainstorm Migrate [resource] to Effect using Organizations and [nearest integrated slice]
as references. Preserve HTTP, domain, error, persistence, transaction, concurrency, identifier,
timestamp, and operational behavior. Record the baseline and move every proposed deviation to a
separate plan and change set before implementation. Use branch [branch] and worktree [worktree].
```

## Definition of done

- The plan gate records the baseline and confirms that the migration has no deviations.
- Existing contract and characterization tests pass without weakened assertions.
- Tests cover changed runtime or adapter wiring at the narrowest useful layer.
- Public schemas, database schemas, migration history, and domain behavior remain unchanged.
- The final diff contains no duplicated validation, mirror models, speculative abstractions, or
  unrelated cleanup.
- `pnpm run check` and the targeted API suite pass.
- `pnpm run ci` passes before integration.
