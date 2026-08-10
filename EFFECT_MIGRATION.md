# Effect Migration Guide

This guide coordinates the incremental migration of the Exchequer Ledger API to a
functional core with Effect-based orchestration. It also coordinates the temporary move of
Currency from Ledger to Ledger Account and the later replacement of Currency identity with
Organization-owned Assets.

Each numbered step receives its own brainstorm, approved design, plan, branch, and worktree.
This guide defines shared constraints and dependency order; the approved `design.md` for a
step remains authoritative for that resource's detailed behavior.

## Goals

- Adopt domain-owned models and pure business rules with Effect services and repository interfaces.
- Keep Fastify and TypeBox at the HTTP/OpenAPI boundary.
- Keep Drizzle as the PostgreSQL adapter.
- Complete every existing endpoint rather than mechanically preserving placeholder behavior.
- Move Currency ownership from Ledger to Ledger Account as an intentional intermediate state.
- Replace Currency identity with Organization-owned Asset identity after all endpoint families
  are complete.
- Keep every integrated step deployable, tested, and free of hard-coded domain responses.

## Program dependency order

```text
01 Organizations on Effect
        |
02 Ledgers on Effect
        |
03 Accounts on Effect + Account Currency
        |
04 Transactions on Effect + correct balances
        |
        +-- 05 Categories
        +-- 06 Settlements
        +-- 07 Statements
        +-- 08 Balance Monitors
                 |
09 Organization-owned Assets
```

Steps 02 through 08 may be **brainstormed in parallel** after step 01 establishes the shared
Effect conventions. Their implementations must follow the dependency graph:

1. Implement and integrate steps 01, 02, 03, and 04 sequentially.
2. Rebase steps 05 through 08 onto completed step 04.
3. Implement steps 05 through 08 concurrently where file ownership is independent.
4. Integrate steps 05 through 08 serially, rebasing and running full CI after each integration.
5. Begin step 09 only after steps 05 through 08 are integrated.

## Branch and worktree map

The program integration branch is:

```text
feat/effect-migration
```

| Step                | Branch                         | Worktree                             |
| ------------------- | ------------------------------ | ------------------------------------ |
| 01 Organizations    | `feat/organizations-effect`    | `.worktrees/organizations-effect`    |
| 02 Ledgers          | `feat/ledgers-effect`          | `.worktrees/ledgers-effect`          |
| 03 Accounts         | `feat/accounts-effect`         | `.worktrees/accounts-effect`         |
| 04 Transactions     | `feat/transactions-effect`     | `.worktrees/transactions-effect`     |
| 05 Categories       | `feat/categories-effect`       | `.worktrees/categories-effect`       |
| 06 Settlements      | `feat/settlements-effect`      | `.worktrees/settlements-effect`      |
| 07 Statements       | `feat/statements-effect`       | `.worktrees/statements-effect`       |
| 08 Balance Monitors | `feat/balance-monitors-effect` | `.worktrees/balance-monitors-effect` |
| 09 Assets           | `feat/assets-effect`           | `.worktrees/assets-effect`           |

Branch creation, commits, merges, pushes, pull requests, and worktree removal require explicit
authorization when each future step is executed.

## Worktree workflow

### Establish the integration branch

Create the integration branch from the agreed base branch before starting step 01:

```bash
git switch -c feat/effect-migration
```

Step 01 must add `.worktrees/` to `.gitignore` before creating additional in-repository
worktrees.

### Create a step worktree

Use the branch and path from the map. For example, step 01 uses:

```bash
git worktree add .worktrees/organizations-effect \
  -b feat/organizations-effect feat/effect-migration
```

After step 01 is integrated, design worktrees for steps 02 through 08 may be created from the
same integration baseline. For example:

```bash
git worktree add .worktrees/ledgers-effect \
  -b feat/ledgers-effect feat/effect-migration
```

During parallel brainstorming, a worktree should change only its own specification artifacts.
Do not implement a step until its declared dependencies have been integrated.

### Refresh before implementation

Before implementing a brainstormed step, rebase its branch onto the current integration branch:

```bash
git -C .worktrees/ledgers-effect rebase feat/effect-migration
```

Resolve specification-only conflicts first. If an upstream change invalidates an approved
design assumption, return that step to `/spec-brainstorm` rather than silently changing the
design during implementation.

### Parallel implementation rules

Steps 05 through 08 may be implemented concurrently only after step 04 is integrated.

- Assign exclusive domain files to each worktree.
- Do not let parallel worktrees make unrelated shared-framework changes.
- Record required shared changes in the step plan and integrate them serially.
- Before integrating each branch, rebase it onto the latest `feat/effect-migration`.
- Run the full validation suite after every integration.
- If two steps need incompatible changes to a shared contract, stop implementation and reconcile
  their approved designs first.

## Shared architecture constraints

### Module layout and naming

The completed API uses domain-rooted vertical slices with only the directories that communicate a
real ownership boundary:

```text
apps/api/src/
  organizations/
    domain/
    index.ts
  assets/
    domain/
    index.ts
  ledgers/
    domain/
    index.ts
    accounts/
      domain/
      index.ts
      settlements/
      statements/
      balance-monitors/
    transactions/
    categories/
  database/
  runtime/
  http/
```

- `domain/` owns the resource model, invariants, and transformations inside each resource family.
- Application services, repository capabilities, live implementations, HTTP adapters, row
  database access, and test Layers live at the owning slice root. Do not create `application/` or
  `adapters/` directories.
- Each migrated slice exposes a public contract and composed Layer from one entrypoint. Concrete
  Live classes, persistence rows, and internal wiring remain private.
- Cross-slice imports use the target slice's public entrypoint. A child slice may import an explicitly
  allowed parent; a parent must not import its child. Sibling dependencies require an explicit
  boundary edge, while runtime or route composition coordinates otherwise independent slices.
- Ledger Account Settlements, Statements, and Balance Monitors live under `ledgers/accounts/`.
  Transactions and Categories are direct Ledger children. Transaction Entries remain part of the
  Transaction domain and do not receive an independent resource slice.
- Assets remain top-level because an Organization owns reusable Asset definitions across Ledgers.

### Functional core

- Domain invariants and state transitions are pure functions.
- Domain models own `fromRequest`, `fromRow`, and `toRow` transformations when those operations
  construct or validate the model. They may use Effect for lazy typed decoding and type-only
  transport or Drizzle row contracts when that avoids duplicate mirror models.
- Domain code does not perform I/O, execute Effects, query PostgreSQL, read environment state, or
  depend on Fastify request/reply objects. Repositories own SQL, transactions, and database error
  translation.
- Model lifecycle states with discriminated unions and exhaustive matching.
- Use smart constructors for values with invariants.
- Use branded types for domain IDs, `CurrencyCode`, `MinorUnitExponent`, and integer
  `MinorUnits`.
- Expected absence and business failures are explicit; they are not represented by `null`,
  unchecked casts, or generic exceptions.

### Effect application layer

- Target Effect 4 beta. The API tracks the `beta` distribution tag, while the lockfile pins the
  resolved beta version for reproducible installs.
- Define repository capabilities and application services with Effect 4 `Context.Service`.
- Compose live and test implementations with `Layer`.
- Service functions return `Effect<Success, DomainError | InfrastructureError, Requirements>`.
- Represent expected failures as tagged errors in the Effect error channel.
- Convert rejected promises and database exceptions with `Effect.tryPromise` at adapter boundaries.
- Use Effect schedules for retryable concurrency failures; do not retain ad hoc retry utilities.
- Do not call `Effect.runPromise`, `Effect.runSync`, or equivalent inside domain, service, or
  repository modules.

### Runtime and adapters

- Build one managed Effect runtime per Fastify server, not one runtime per request.
- Fastify handlers decode transport input, invoke the application Effect, and encode the result.
- Maintain one exhaustive mapping from tagged application errors to RFC 7807 HTTP responses.
- Fastify authentication remains at the HTTP boundary, but the authenticated Organization ID is
  passed explicitly into every application operation.
- Keep TypeBox as the initial source for request validation and OpenAPI schemas.
- Use Effect Schema only where domain or database decoding otherwise duplicates validation.
- Drizzle implementations remain infrastructure adapters and never own business rules.
- PostgreSQL transaction boundaries must cover every atomic financial state transition.

### Repository and tenancy rules

- Every Organization-owned repository operation accepts and filters by Organization ID.
- Nested resource operations also validate all Ledger, Account, and child-resource path IDs.
- Database constraints should enforce same-Organization and same-Ledger relationships wherever
  possible; application-only checks are insufficient for financial invariants.
- Repositories expose intention-revealing create, update, transition, and delete operations rather
  than generic upserts when the HTTP contracts distinguish those behaviors.
- Translate database failures into a small typed infrastructure error vocabulary before they reach
  services.

### Currency transition rules

Currency on Ledger Account is a deliberate intermediate model.

- Use the full names `currencyCode` and `minorUnitExponent`; do not introduce `ccy` field names.
- Currency and exponent are immutable after an Account is created.
- Amounts remain integers in the Account Currency's Minor Units.
- A Ledger may contain Accounts with several currencies after step 03.
- A Transaction may contain several currencies after step 04, but Debits and Credits must balance
  independently for every Currency and exponent pair.
- The Ledger performs no valuation, foreign-exchange conversion, pricing, or rate storage.
- Steps 04 through 08 use the centralized Currency value object rather than propagating unrelated
  raw string/exponent pairs through domain logic.
- Step 09 replaces Currency identity with Asset identity. Currency display codes become Asset
  attributes rather than identity.

### Database migration rules

Use an additive sequence for every cross-resource schema change:

1. **Expand:** add nullable columns/tables and required indexes or constraints.
2. **Backfill:** deterministically populate development data from existing canonical fields.
3. **Verify:** fail migration or validation when missing, ambiguous, or inconsistent rows remain.
4. **Switch:** move application reads and writes to the new model.
5. **Contract:** add non-null constraints and remove obsolete columns only after all consumers move.

Preserve development data and migration continuity. Production zero-downtime dual-write,
multi-release backfill orchestration, and rollback automation are outside this program unless a
later step explicitly adds them.

## Shared definition of done

Every step must satisfy all applicable checks before integration:

- All endpoints in the resource family use the functional-core and Effect architecture.
- All endpoint behavior promised by the public schema and `CONTEXT.md` is implemented.
- No migrated response contains hard-coded zero balances, USD, empty conditions, fake versions, or
  other placeholder domain values.
- No migrated request field is silently discarded.
- No expected error depends on a generic thrown `Error` or mocked-only behavior.
- Organization and nested resource isolation is tested through the real stack.
- Pure domain rules have narrow unit tests.
- Effect services have Layer-based tests using test implementations.
- Repository behavior has real PostgreSQL integration tests.
- Every endpoint behavior has an authenticated Fastify-to-PostgreSQL integration path.
- Concurrency-sensitive behavior has deterministic race/concurrency coverage.
- OpenAPI snapshots, ERD, and relevant product/engineering documentation are updated.
- Obsolete repository or transaction specifications are marked as superseded where applicable.
- `pnpm run check` passes.
- The targeted API suite passes.
- `pnpm run ci` passes before integration.
- A final scan finds no `NotImplemented`, placeholder responses, or stale Currency ownership in the
  migrated scope.

## Step 01: Effect foundation and Organizations

**Branch:** `feat/organizations-effect`

**Worktree:** `.worktrees/organizations-effect`
**Depends on:** `feat/effect-migration`

### Outcomes

- Place the migrated slice under `apps/api/src/organizations/` using the shared flat slice layout.
- Add Effect and establish the managed runtime, service Tags, Layers, and tagged error mapping.
- Add `.worktrees/` to `.gitignore`.
- Establish the standard directory and module boundaries followed by later steps.
- Establish the real authenticated Fastify-to-PostgreSQL endpoint-test fixture.
- Migrate all five Organization endpoints to the new architecture.
- Correct permission semantics and distinguish platform-wide from current-Organization access.
- Enforce token Organization ownership for current-Organization operations.
- Convert malformed IDs to transport/domain validation errors rather than 500 responses.
- Make deletion return Not Found for missing Organizations and Conflict for dependent resources.
- Remove synthetic conflict behavior that cannot occur through the real implementation.

### Brainstorm prompt

```text
/spec-brainstorm Migrate Organizations to the functional-core + Effect architecture. Read EFFECT_MIGRATION.md, CONTEXT.md, and the API standards first. Establish the shared runtime, Layers, tagged-error mapping, and real HTTP-to-PostgreSQL test pattern while completing all five Organization endpoints; keep Fastify/TypeBox and Drizzle as adapters and avoid unrelated resource changes. Use branch feat/organizations-effect and worktree .worktrees/organizations-effect.
```

## Step 02: Ledgers

**Branch:** `feat/ledgers-effect`

**Worktree:** `.worktrees/ledgers-effect`
**Depends on:** step 01 integrated into `feat/effect-migration`

### Outcomes

- Place the migrated slice at `apps/api/src/ledgers/`.
- Migrate all five Ledger endpoints using step 01 as the reference implementation.
- Correct create versus update semantics; updating a missing Ledger must not create it.
- Enforce Organization tenancy consistently without revealing cross-Organization existence.
- Use stable, bounded pagination and accurate conflict responses.
- Remove Currency and exponent from the public Ledger domain and stop new code from treating a
  Ledger as single-currency.
- Retain the legacy Ledger database columns temporarily because existing Accounts still need unit
  information before step 03.
- Expose a narrowly scoped compatibility reader for legacy Account responses, explicitly marked for
  removal by step 03.
- Do not physically drop Ledger Currency columns in this step; doing so would create an invalid
  intermediate release.

### Brainstorm prompt

```text
/spec-brainstorm Migrate Ledgers to Effect and complete every Ledger endpoint, using EFFECT_MIGRATION.md and the Organization migration as the reference. Remove Currency from the public Ledger domain, but design an additive compatibility transition that retains the legacy database values until Accounts are backfilled in step 03. Use branch feat/ledgers-effect and worktree .worktrees/ledgers-effect.
```

## Step 03: Accounts and Account Currency

**Branch:** `feat/accounts-effect`

**Worktree:** `.worktrees/accounts-effect`
**Depends on:** step 02 integrated into `feat/effect-migration`

### Outcomes

- Place the migrated slice at `apps/api/src/ledgers/accounts/`.
- Migrate all five Account endpoints to Effect.
- Introduce the shared Currency, exponent, Minor Units, Normal Balance, and Account ID value types.
- Add immutable `currencyCode` and `minorUnitExponent` fields to Ledger Accounts.
- Backfill existing Accounts from their Ledger's compatibility Currency values.
- Verify that every Account has an unambiguous Currency/exponent pair.
- Require clients to choose debit-normal or credit-normal behavior at creation.
- Repair first-update optimistic concurrency and duplicate-name Conflict behavior.
- Switch Account responses and every Account Currency reader to the Account-owned fields.
- Remove the step 02 compatibility reader.
- Drop the legacy Ledger Currency columns only after verification and consumer migration.

### Brainstorm prompt

```text
/spec-brainstorm Migrate Ledger Accounts to Effect, complete all Account endpoints, and move Currency ownership from Ledger to Account. Read EFFECT_MIGRATION.md and design the expand/backfill/switch/contract migration, shared Currency and Minor Units value objects, correct normal-balance creation, optimistic updates, tenancy, and final removal of legacy Ledger Currency storage. Use branch feat/accounts-effect and worktree .worktrees/accounts-effect.
```

## Step 04: Transactions and balances

**Branch:** `feat/transactions-effect`

**Worktree:** `.worktrees/transactions-effect`
**Depends on:** step 03 integrated into `feat/effect-migration`

### Outcomes

- Place the migrated slice at `apps/api/src/ledgers/transactions/`.
- Migrate all six Transaction endpoints to Effect.
- Model Pending, Posted, and Voided as an exhaustive functional state machine.
- Permit several Entries for one Account.
- Permit several currencies in one Transaction, balanced independently by Currency and exponent.
- Enforce same-Organization and same-Ledger Accounts at application and database boundaries.
- Implement correct Pending, Posted, and Available balance views.
- Respect Effective Time for current and as-of balance calculations.
- Implement reachable client idempotency with replay returning the original result without repeated
  balance effects.
- Make create, post, update, and void operations atomic and concurrency-safe.
- Acquire Account locks in deterministic order and retry only typed retryable conflicts.
- Make Posted Transactions immutable.
- Replace physical deletion with retained Voided Transactions.
- Add tests for rollback, concurrency, idempotency, lifecycle races, future Effective Time,
  multi-Currency balancing, and repeated Entries on one Account.

### Brainstorm prompt

```text
/spec-brainstorm Migrate Ledger Transactions to Effect and complete all Transaction endpoints. Use Account-owned Currency, allow multi-Currency Transactions that balance independently per Currency, and design Pending/Posted/Voided lifecycle, Effective Time, three balance views, idempotency, atomic persistence, locking, retries, immutability, and full-stack concurrency tests. Use branch feat/transactions-effect and worktree .worktrees/transactions-effect.
```

## Step 05: Categories

**Branch:** `feat/categories-effect`

**Worktree:** `.worktrees/categories-effect`
**Depends on:** step 04 integrated into `feat/effect-migration`

### Outcomes

- Place the migrated slice at `apps/api/src/ledgers/categories/`.
- Migrate all nine Category endpoints to Effect.
- Enforce Organization and Ledger scope for Category records, Account membership, and parent links.
- Prevent self-links, two-node cycles, longer cycles, and concurrent cycle creation.
- Preserve valid multiple-parent relationships.
- Calculate Pending, Posted, and Available balance vectors keyed by Currency.
- Count each descendant Account once even when several paths reach it.
- Remove hard-coded zero/USD balance output.
- Add real tests for cross-Organization membership, cross-Ledger membership, graph cycles,
  descendant deduplication, and balance vectors.

### Brainstorm prompt

```text
/spec-brainstorm Migrate Ledger Account Categories to Effect and complete all nine endpoints. Read EFFECT_MIGRATION.md and design Organization-safe membership, an acyclic multi-parent graph with concurrency protection, and Currency-keyed balance-vector aggregation that counts each descendant Account once; remove every placeholder balance response. Use branch feat/categories-effect and worktree .worktrees/categories-effect.
```

## Step 06: Settlements

**Branch:** `feat/settlements-effect`

**Worktree:** `.worktrees/settlements-effect`
**Depends on:** step 04 integrated into `feat/effect-migration`

### Outcomes

- Place the migrated slice at `apps/api/src/ledgers/accounts/settlements/`.
- Migrate all eight Settlement endpoints to Effect.
- Enforce Organization, Ledger, and nested Settlement path scope.
- Require the settled and contra Accounts to use the same Currency and exponent.
- Select eligible Posted Entries explicitly or by Effective Time cutoff.
- Calculate the signed net Amount rather than the unsigned gross sum.
- Enforce one active or Posted Settlement claim per Entry at database level.
- Allow abandoned/Voided claims to release Entries for later Settlement.
- Implement the complete Settlement lifecycle with expected-current-state updates.
- Create and link the offsetting Transaction atomically with the Settlement transition.
- Return the actual transaction link, cutoff, external reference, Currency, and lifecycle state.
- Test attachment races, release/reuse, signed netting, rollback, and path mismatch through the real
  stack.

### Brainstorm prompt

```text
/spec-brainstorm Migrate Ledger Account Settlements to Effect and complete all eight endpoints. Read EFFECT_MIGRATION.md and design same-Currency Account validation, cutoff and explicit Entry selection, signed netting, database-safe Entry exclusivity, lifecycle and release rules, and atomic creation/linking of the offsetting Transaction. Use branch feat/settlements-effect and worktree .worktrees/settlements-effect.
```

## Step 07: Statements

**Branch:** `feat/statements-effect`

**Worktree:** `.worktrees/statements-effect`
**Depends on:** step 04 integrated into `feat/effect-migration`

### Outcomes

- Place the migrated slice at `apps/api/src/ledgers/accounts/statements/`.
- Migrate both Statement endpoints to Effect.
- Enforce Organization, Ledger, Account, and nested path scope.
- Validate non-empty periods with an inclusive lower bound and exclusive upper bound.
- Generate immutable, versioned Account snapshots.
- Copy the included Posted and Pending Entry and Transaction data required for reproducibility.
- Persist all three starting and ending balance views.
- Snapshot Normal Balance, Currency, exponent, Account version, and descriptive data.
- Enforce immutability and version uniqueness in PostgreSQL.
- Remove hard-coded dates, version zero, debit normal balance, zero balances, and USD output.
- Test reproducibility after Pending Transactions change.

### Brainstorm prompt

```text
/spec-brainstorm Migrate Ledger Account Statements to Effect and complete both endpoints. Read EFFECT_MIGRATION.md and design immutable versioned period snapshots containing copied Posted/Pending Entry and Transaction data, all three balance views, Account and Currency configuration, strict period validation, tenancy, and database-enforced immutability. Use branch feat/statements-effect and worktree .worktrees/statements-effect.
```

## Step 08: Balance Monitors

**Branch:** `feat/balance-monitors-effect`

**Worktree:** `.worktrees/balance-monitors-effect`
**Depends on:** step 04 integrated into `feat/effect-migration`

### Outcomes

- Place the migrated slice at `apps/api/src/ledgers/accounts/balance-monitors/`.
- Migrate all five Balance Monitor endpoints to Effect.
- Enforce Organization, Ledger, Account, and nested path scope.
- Persist the complete typed condition set in Account Minor Units.
- Make update preserve identity and reject Account reparenting.
- Evaluate Monitors whenever an effective Account balance transition occurs.
- Emit only when a condition crosses from false to true.
- Rearm only after the condition becomes false.
- Persist armed/evaluation state needed for deterministic concurrency behavior.
- Write notification events to a transactional outbox with deduplication identity.
- Keep webhook transport/delivery behind an Effect service boundary.
- Remove hard-coded thresholds, empty conditions, zero balances, and USD output.
- Test concurrent balance changes, duplicate suppression, rearming, and transaction rollback.

### Brainstorm prompt

```text
/spec-brainstorm Migrate Ledger Account Balance Monitors to Effect and complete all five endpoints. Read EFFECT_MIGRATION.md and design persisted typed conditions in Account Minor Units, strict tenancy, transaction-integrated evaluation, false-to-true emission, rearming, durable state, and a transactional outbox; remove all placeholder responses. Use branch feat/balance-monitors-effect and worktree .worktrees/balance-monitors-effect.
```

## Step 09: Organization-owned Assets

**Branch:** `feat/assets-effect`

**Worktree:** `.worktrees/assets-effect`
**Depends on:** steps 05, 06, 07, and 08 integrated into `feat/effect-migration`

### Outcomes

- Place the migrated slice at `apps/api/src/assets/`.
- Add Organization-owned Asset persistence and public Asset CRUD endpoints using the established
  Effect architecture.
- Give every Asset an immutable Exchequer ID and immutable Minor Unit Exponent.
- Treat code, symbol, name, external identifiers, and metadata as attributes rather than identity.
- Deterministically create Assets for distinct Organization/Currency/exponent pairs in development
  data.
- Add `assetId` to Accounts and backfill it through the temporary Currency mapping.
- Verify that every Account maps to exactly one Organization-owned Asset.
- Convert Transaction balancing from Currency keys to Asset IDs.
- Convert Category balance vectors to Asset IDs.
- Convert Settlement same-unit validation, Statement snapshots, and Monitor thresholds to Asset
  identity.
- Preserve all Amounts as integer Minor Units without conversion or rounding.
- Remove duplicated Currency identity fields only after all consumers use `assetId`.
- Retain currency codes where useful only as Asset attributes or response projections.
- Continue allowing multi-Asset Transactions, balanced independently per Asset.
- Do not add valuation, pricing, market data, foreign-exchange rates, or conversions.

### Brainstorm prompt

```text
/spec-brainstorm Replace the temporary Account Currency model with Organization-owned Assets across the completed Effect architecture. Read EFFECT_MIGRATION.md and CONTEXT.md, then design Asset CRUD and identity, deterministic development-data backfill, Account assetId migration, per-Asset Transaction balancing and dependent-resource updates, and removal of duplicated Currency identity fields without valuation or FX behavior. Use branch feat/assets-effect and worktree .worktrees/assets-effect.
```

## Final program completion

The migration program is complete only when:

- All nine steps are integrated into `feat/effect-migration`.
- All 45 existing endpoints and the new Asset endpoints use the agreed architecture.
- Every endpoint's advertised behavior is implemented through the real stack.
- Currency no longer acts as Ledger, Account, Entry, Settlement, Statement, or Monitor identity.
- Asset identity and Minor Unit Exponent are authoritative.
- No advanced resource returns placeholder domain data.
- All migrations apply successfully from a clean database and the existing development database.
- Full CI, concurrency tests, OpenAPI generation, and documentation validation pass.
- Final integration to the repository's target branch is separately reviewed and explicitly
  authorized.
