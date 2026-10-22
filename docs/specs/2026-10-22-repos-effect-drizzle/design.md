# Finish the Effect-Drizzle migration (Organization and Ledger repositories)

## Problem
- `OrganizationRepo` and `LedgerRepo` still send SQL through the Promise node-postgres Drizzle client (`this.db`), wrapped in `Effect.tryPromise`. `LedgerRepo.deleteLedgerFixtures` also still uses an `async` transaction.
- Because of these two repositories, `src/db/database.ts` builds two Drizzle clients (`drizzle-orm/node-postgres` and `drizzle-orm/effect-postgres`) on one shared `pg` Pool.
- Every other repository already uses `DatabaseTag.effectDb`, following the settlements, categories and statements specs.
- The affected people are maintainers. Today they work with two execution and error models for database access.

## Scope
- **In scope:**
  - Move `OrganizationRepo` and `LedgerRepo` to `effectDb`.
  - Rewrite the `database.db` fixture calls (about 79 sites) in 8 `*.test.ts` files and `apps/api/test/bench/category-balances.bench.ts`.
  - Remove `Database.db`, `DrizzleDatabase` and the node-postgres `drizzle()` client from `src/db`.
- **Out of scope:**
  - Renaming `effectDb` to `db`.
  - Collapsing the repository interfaces into the `AssetRepo` class-only form.
  - Removing the `pg` dependency. `PgClient.fromPool` still needs a pg Pool.
  - `DatabaseLive.close()`.
  - Redis `tryPromise` wrappers and the Fastify `runPromise` boundaries.

## User Stories
- US-1 (must): As a maintainer, I want every repository to use a single Effect Drizzle client, so that database access has one execution and error model.
  - Given the API is running, when any Organization or Ledger endpoint is called, then its SQL runs through `effectDb`.
  - Given the migration is complete, then `rg "drizzle-orm/node-postgres|DrizzleDatabase|database\.db\b" apps/api` returns nothing.
- US-2 (must): As an API client, I want no behaviour change.
  - Given the existing Organization and Ledger repository, service and route tests, when they run after the migration, then they pass with changes limited to fixture plumbing.

## Constraints
- This is a behaviour-preserving migration. The following do not change:
  - API responses and status codes.
  - Domain rules.
  - Persistence, SQL semantics, ordering and locking (`FOR UPDATE`, foreign-key-order deletes).
  - Error types and their mapping.
  - Identifiers and time handling.
- Acceptable difference: the `cause` attached to infrastructure errors may become an effect-postgres error instead of a raw pg error. Error types do not change.
- If implementation discovers an unlisted behaviour change, stop and split the work.

## Context
- `AssetRepo` (`apps/api/src/domains/assets/AssetRepo.ts`) shows the target style: the query builder is itself an Effect, piped through `Effect.mapError` and `Effect.flatMap`.
- `LedgerTransactionRepo.ts:641` shows the Effect transaction form, `this.db.transaction(tx => Effect…)`. `LedgerAccountBalanceMonitorRepo.ts:114` shows `.for("update")` inside a transaction.
- `postgresErrorCode` and `isPostgresUnavailable` in `src/db/errors.ts` already walk Effect `Cause` values and nested errors, and `AssetRepo` relies on them. The per-repository error mappers can stay as they are.
- `LedgerAccountCategoryRepo.test.ts:87` already obtains the client with `(await runtime.runPromise(DatabaseTag)).effectDb`.
- `deleteLedgerFixtures` is called from the settlement and category repository tests as well as from `LedgerRepo.test.ts`.
- Both Drizzle clients share the pool's `getTypeParser` override (`drizzleParsedTypeIds`), so date and timestamp decoding is the same on either client.

### Research
| Concern | Existing solution | Decision | Current requirement |
|---------|-------------------|----------|---------------------|
| Effect SQL client | `database.effectDb` in `src/db/database.ts` | reuse | US-1 |
| Query-to-Effect style | `AssetRepo.ts`: `builder.pipe(Effect.mapError(map), Effect.flatMap(decode))` | reuse | Replace `tryPromise` wrappers |
| Effect transaction | `LedgerTransactionRepo.ts:641`; `.for("update")` in `tx` as in `LedgerAccountBalanceMonitorRepo.ts:114` | reuse | `deleteLedgerFixtures` |
| Error mapping | `postgresErrorCode` / `isPostgresUnavailable`; `mapLedger*Error`, `mapInfrastructureError`, `mapDeleteError` | reuse | Preserve error types |
| Repository interfaces, tags, layers | `OrganizationRepo`, `LedgerRepo` | reuse | Callers untouched |
| Test access to `effectDb` | `LedgerAccountCategoryRepo.test.ts:87` | reuse | Fixture rewrite |
| `Database.db`, `DrizzleDatabase`, node-postgres `drizzle()` | `src/db/database.ts`, `src/db/index.ts` | delete | US-1 |

## Architecture
- Dependency flow is unchanged: Routes → Services → Repositories and Entities → PostgreSQL.
- **Repositories** keep the same interfaces, tags and layers. Only the constructor type changes, to `EffectDrizzleDatabase`, and the layer passes `database.effectDb`.
- **Query translation (per method):** replace `Effect.tryPromise({ try: () => this.db.<query>, catch: mapX })` with `this.db.<query>.pipe(Effect.mapError(mapX), <existing continuation>)`.
- **`deleteLedgerFixtures`:** becomes `this.db.transaction(tx => Effect.gen(function* () { … }))`, followed by `Effect.mapError(mapLedgerDeleteError)`.
  - Same statement order: lock the Ledger with `FOR UPDATE`; delete settlement entries, transaction entries, transactions, settlements, accounts, then the Ledger.
  - Same early return when the Ledger is absent.
- **Entities:** `Organization.fromRow` and `Ledger.fromRow` are unchanged.
- **`src/db/database.ts`:**
  - `Database` exposes only `effectDb`.
  - `DatabaseLive` keeps `pool` for `close()` and drops the `drizzle({ client: pool })` construction.
  - Pool and type-parser setup is unchanged.
  - Remove the `DrizzleDatabase` type and its export from `src/db/index.ts`.
- **Tests:** fixtures obtain `effectDb` from the runtime and run queries as `await runtime.runPromise(effectDb.<query>)`, in each file's local style. No shared test helper is added, because it would have no second current consumer.
- **Test seam:** repository integration tests against PostgreSQL remain the verification point for SQL and error mapping. Service and route tests are unaffected.

## API Design
No API changes.

## Data Model
No schema changes and no migrations.

## Trade-offs
- **Alternative:** stop after the two repositories and leave `Database.db` for test fixtures. It is a smaller diff, but `database.ts` would keep two clients, so the migration would not really be finished. Rejected by the scope decision.
- **Alternative:** rewrite the repositories in `AssetRepo`'s interface-less style. This changes public types, which goes beyond a behaviour-preserving migration. Rejected.
- **Accepted:** the `effectDb` name stays even though it becomes the only client. Renaming it would touch every repository for no behaviour gain.
- **Accepted:** most of the diff is test-fixture churn, in exchange for ending with one client.
- **Known limitation:** the Promise `cause` shape on infrastructure errors changes, as noted under Constraints.

## Verification
- `pnpm run docker:up`, then `pnpm --filter=@exchequerio/api test`. All suites must pass. The Organization, Ledger, Settlement and Category repository tests deserve particular attention, because the last two exercise `deleteLedgerFixtures`.
- `pnpm run check`.
- Run `apps/api/test/bench/category-balances.bench.ts` once to confirm it still executes.
- `rg "drizzle-orm/node-postgres|DrizzleDatabase|database\.db\b" apps/api` returns nothing.

## Open Questions
None.
