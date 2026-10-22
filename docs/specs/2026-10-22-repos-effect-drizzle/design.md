# Finish the Effect-Drizzle migration (Organization and Ledger repositories)

## Problem
- `OrganizationRepo` and `LedgerRepo` still send SQL through the Promise node-postgres Drizzle client (`database.db`), wrapped in `Effect.tryPromise`. `LedgerRepo.deleteLedgerFixtures` still runs an `async` transaction.
- Because of them, `src/db/database.ts` builds two Drizzle clients on one pg Pool: node-postgres `db` and effect-postgres `effectDb`. Test fixtures in 9 repository test files and 2 benches also use `db`.
- Every other repository already uses `effectDb`, following the settlements, categories and statements specs.
- The people affected are maintainers, who today work with two execution and error models for database access.

## Scope
- **In scope:**
  - Move `OrganizationRepo` and `LedgerRepo` to `effectDb`.
  - Move every `database.db`, `{ db }` and `Database["db"]` use in the 9 repository test files and both benches to `effectDb`.
  - Add PostgreSQL repo tests for the contracts this migration puts at risk.
  - Delete `Database.db`, `DrizzleDatabase` and the node-postgres `drizzle()` client.
- **Out of scope:**
  - A shared fixture helper.
  - Renaming `effectDb` to `db`.
  - Restyling the repo interfaces.
  - Removing `pg`, which `PgClient.fromPool` still needs.
  - `DatabaseLive.close()`.
  - The Redis `tryPromise` wrappers.
  - The Fastify `runPromise` boundaries.

## User Stories
- US-1 (must): As a maintainer, I want every repository, test fixture and bench to use the single Effect Drizzle client, so that database access has one execution and error model.
  - Given the API is running, when any Organization or Ledger endpoint is called, then its SQL runs through `effectDb`.
  - Given the migration is complete, then `rg 'drizzle-orm/node-postgres|DrizzleDatabase|database\.db\b|\{ *db *\} *=.*DatabaseTag|Database\["db"\]' apps/api` returns nothing and `pnpm run check` passes.
- US-2 (must): As an API client, I want no behaviour change.
  - Given the existing Organization, Ledger, service and route tests, when they run after the migration, then they pass.
  - Test changes are limited to fixture plumbing plus these listed exceptions:
    - `OrganizationRepo.test.ts:68` uses `effectDb.execute(sql, "objects")`;
    - `OrganizationRepo.test.ts:214` asserts the pg code through `postgresErrorCode` on the flipped Effect error;
    - the spy at `LedgerAccountCategoryRepo.test.ts:964` targets `effectDb`.
- US-3 (must): As a maintainer, I want the contracts this migration puts at risk covered by PostgreSQL repo tests, so that a regression in error wrapping or transactions actually fails a test.
  - Given an Organization that has a Ledger, when it is deleted, then the repo fails with `OrganizationHasDependents`.
  - Given a Ledger with accounts and transactions, when `deleteLedgerFixtures` runs, then the Ledger and all its dependents are gone.
  - Given an absent Ledger, when `deleteLedgerFixtures` runs, then it completes without error.

## Constraints
- This is a behaviour-preserving migration. None of the following change:
  - API responses, status codes, error bodies, OpenAPI.
  - Domain rules.
  - Repository interfaces.
  - Error types and mapping.
  - SQL predicates, ordering, pagination and locking.
  - Identifiers and time handling.
- If implementation discovers an unlisted behaviour change, stop and split the work.

## Context

### Current state
- `OrganizationRepo.ts:94` and `LedgerRepo.ts:124` take `DrizzleDatabase`. Their layers pass `database.db` (`:206`, `:333`).
- `deleteLedgerFixtures` (`LedgerRepo.ts:255`) does the following, and does nothing when the Ledger is absent:
  1. Locks the Ledger `FOR UPDATE`.
  2. Deletes settlement entries, matched by a settlements subquery.
  3. Deletes transaction entries, transactions, settlements and accounts.
  4. Deletes the Ledger.
- Other callers of `db`:
  - 9 repository test files, including the `{ db }` destructure at `LedgerAccountSettlementRepo.test.ts:1319` and the `Database["db"]` types at `LedgerTransactionRepo.test.ts:107` and `LedgerAccountStatementRepo.test.ts:37`.
  - `test/bench/category-balances.bench.ts` and `test/bench/transaction.bench.ts`. Both are type-checked via `tsconfig.json`.
  - No test double constructs a `Database`.

### Client differences
- **`execute`:** on `effectDb`, the default mode resolves to the raw pg `QueryResult`; `"objects"` mode returns a row array (`@effect/sql-pg` `PgClient.js:419,427`).
- **Errors:** errors arrive as `EffectDrizzleQueryError → Cause → SqlError → pg error`.
  - `postgresErrorCode` and `isPostgresUnavailable` (`src/db/errors.ts:59,67`) walk that chain, so the repo mappers stay valid. `AssetRepo` already relies on this.
  - Assertions that read `cause.code` directly break.
  - `@effect/sql-pg`'s synthetic "No client returned" connection error has no code and no matching message.
- **Transactions:** an Effect transaction rolls back on failure, defect or interruption, like today's thrown-error rollback. An effect-postgres query builder is itself an Effect, so `yield*` would run it as a separate query.
- **Decoding:** node-postgres Drizzle applies its own per-query parsers for the same type IDs that the pool override passes through as raw strings. Decoding is identical on both clients.

### Coverage gaps
These contracts have no PostgreSQL test today:
- Organization 23503 → `OrganizationHasDependents`. Only stubbed, at `OrganizationService.test.ts:182`.
- `deleteLedgerFixtures` cleanup and its no-op branch. Not called in `LedgerRepo.test.ts`.
- Unavailable → `*RepositoryUnavailable`, in either repo.

The spy at `LedgerAccountCategoryRepo.test.ts:964` watches the Promise client, which the repo never calls, so its assertion can never fail.

### Research
| Concern | Existing solution | Decision | Current requirement |
|---------|-------------------|----------|---------------------|
| Effect SQL client | `database.effectDb` | reuse | US-1 |
| Query-to-Effect style | `AssetRepo.ts`: `builder.pipe(Effect.mapError, Effect.flatMap)` | reuse | US-1 |
| Effect transaction | `LedgerTransactionRepo.ts:641`; `.for("update")` in `tx` at `LedgerAccountBalanceMonitorRepo.ts:114` | reuse | US-1, US-3 |
| Error mappers | `postgresErrorCode` / `isPostgresUnavailable`; per-repo mappers | reuse | US-2 |
| Repo interfaces, tags, layers | `OrganizationRepo`, `LedgerRepo` | reuse | US-2 |
| Test client access | `LedgerAccountCategoryRepo.test.ts:87` | reuse | US-1 |
| Error-code assertions | `Effect.flip` + `postgresErrorCode`, as at `LedgerAccountCategoryRepo.test.ts:2752` | reuse | US-2 |
| Repo tests for uncovered contracts | none | new | US-3 |
| `Database.db`, `DrizzleDatabase`, node-postgres `drizzle()` | `src/db/database.ts`, `src/db/index.ts` | delete | US-1 |

## Architecture
- **Layer flow.** Routes → Services → Repositories and Entities → PostgreSQL is unchanged. Only repository internals and `src/db` change.
- **`OrganizationRepoLive`, `LedgerRepoLive`.** These own the IO and the error translation.
  - **Constructor and layer:** the constructor takes `EffectDrizzleDatabase`, and the layer passes `database.effectDb`. Interface, tag and exports are unchanged.
  - **Methods:** each method is the query builder, then `Effect.mapError(<existing mapper>)`, then the existing decode continuation.
  - **Mappers:** the mappers are unchanged and remain the only place that interprets pg codes.
  - **`deleteLedgerFixtures`:** becomes `this.db.transaction(tx => Effect.gen(...))`, followed by `Effect.mapError(mapLedgerDeleteError)` outside the transaction, so commit failures are mapped too. It keeps the same statement order, the `FOR UPDATE` lock and the early return. The settlements select is built but not run, and is passed to `inArray` as a subquery.
- **Entities.** `Organization.fromRow` and `Ledger.fromRow` are unchanged.
- **`src/db/database.ts`.**
  - `Database` exposes only `effectDb`.
  - `DatabaseLive` keeps `pool` and `close()`.
  - The pool, the type-parser override and `PgClient.fromPool` are unchanged.
  - The node-postgres `drizzle()` construction and the `DrizzleDatabase` type and export are deleted.
- **External seam.** There is no new untrusted input. Requests are parsed in routes; rows are decoded in entities.
- **Test seams.**
  - Repo integration tests against PostgreSQL are the only layer that proves SQL, mapping and transactions. US-3 tests go in `OrganizationRepo.test.ts` and `LedgerRepo.test.ts`.
  - Service and route tests stub the repos and are unchanged.
  - Fixtures get `effectDb` from each file's runtime and wrap queries inline in `runtime.runPromise`. `transaction.bench.ts` `cleanupFixtures` has no runtime, so it uses `Effect.runPromise`; effect-postgres queries need no context.
- **Ordering.** `Database.db` is deleted only after every repo, test and bench has stopped using it.

## API Design
No API changes. Endpoints, schemas, status codes, error bodies and OpenAPI are unchanged.

## Data Model
No schema changes and no migrations. The `deleteLedgerFixtures` settlements subquery stays a subquery.

## Trade-offs
- **Alternatives rejected:**
  - Keeping `Database.db` for fixtures leaves two clients.
  - A shared fixture helper is a new test abstraction inside a migration.
  - Renaming `effectDb` to `db` churns every repo for naming only.
  - An interface-less repo style changes public types.
- **Why this approach:** it is the smallest change that reaches a single client, it uses only existing patterns, and the risky parts gain real PostgreSQL tests.
- **Known limitations (accepted):**
  - Infrastructure error `cause` becomes an effect-postgres chain. Error types are unchanged.
  - "No client returned" maps to `*PersistenceFailure` instead of `*RepositoryUnavailable`, and the unavailable mapping has no PostgreSQL test.
  - The `effectDb` name stays.
  - Most of the diff is test churn: about 90 inline `runtime.runPromise` wrappers.
  - The three listed test changes. The spy change intentionally makes a vacuous assertion real.

## Verification
- With PostgreSQL running, `pnpm --filter=@exchequerio/api test` passes, including the new US-3 tests.
- `pnpm run check` passes. This type-checks both benches.
- Each bench runs once to completion.
- The US-1 `rg` returns nothing.

## Open Questions
None.
