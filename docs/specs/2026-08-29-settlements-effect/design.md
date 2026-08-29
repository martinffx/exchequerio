# Ledger Account Settlements Effect migration

## Problem

Ledger Account Settlements still use promise-based repository and service registrations even
though Organizations, Ledgers, Accounts, and Transactions run through the shared Effect runtime.
The split leaves Settlement routes with two execution models and requires a legacy bridge to the
Effect Transaction service.

This migration moves the complete Settlement slice to Effect. It preserves observed implementation
behavior at baseline commit `47779c4`, including defects and race conditions. `CONTEXT.md` remains
authoritative for the domain contract. When the baseline conflicts with that contract, this
migration records and temporarily retains the implementation defect. Any correction requires a
separate design, plan, and change set.

## Scope

In scope:

- Move the Settlement entity, schemas, repository, service, routes, and tests into
  `apps/api/src/domains/ledgers/settlements`.
- Use the shared managed Effect runtime, the Effect-enabled Drizzle client, and direct Effect
  service dependencies.
- Remove only the legacy Settlement repository and service registrations and the Settlement to
  Transaction promise bridge.
- Preserve the observed HTTP, error, persistence, transaction, concurrency, identifier, timestamp,
  and operational behavior.
- Add characterization tests where the current suite does not pin important baseline behavior.

Out of scope:

- Database migrations or schema changes.
- Settlement lifecycle fixes, stronger Ledger scoping, atomic posting, uniqueness constraints,
  retries, or new error types.
- Automatic Entry gathering by Effective At Upper Bound.
- Changes to Transaction, Account, Ledger, or Organization behavior.
- Public API cleanup, response completion, pagination changes, or operational redesign.

## User stories

- US-1, must: As an API consumer, I can use all eight Settlement operations with the same routes,
  permissions, schemas, success codes, responses, and problem responses after the migration.
- US-2, must: As an Organization, I retain the current Settlement data isolation and lookup
  behavior, including operations that do not enforce the Ledger path parameter.
- US-3, must: As an operator, I observe the same SQL ordering, status transitions, Transaction
  creation ordering, timestamps, identifiers, and partial-failure behavior.
- US-4, must: As a maintainer, I can compose and test Settlement through Effect services and the
  shared runtime without Fastify service or repository decorations.

## Constraints

- The baseline is commit `47779c4` on the latest main history available when the design was
  approved. Its API suite passed 32 files and 490 tests.
- The work uses branch `feat/settlements-effect` and worktree
  `/Users/martinrichards/code/exchequerio/.worktrees/settlements-effect`.
- The installed versions are Effect `4.0.0-rc.112`, `@effect/sql-pg` `4.0.0-rc.112`, and Drizzle
  `1.0.0-rc.5-ab785fc`. Implementation must use APIs supported by those versions.
- Organizations provide the service and route integration reference. Transactions provide the
  nearest integrated Ledger slice and the Effect Drizzle reference.
- `CONTEXT.md` remains authoritative for domain terminology and invariants. Known baseline
  conflicts are compatibility defects, not alternate domain rules.
- Routes retain transport validation and permissions. Services retain orchestration. Repositories
  retain persistence. Entities retain transformations and invariants.
- The migration introduces no dependency, generic executor, runtime resource, Settlement-specific
  error hierarchy, transaction boundary, retry policy, or concurrency policy.
- Every correction to a baseline defect remains outside this design and requires a separate design,
  plan, and change set.

## Context and baseline

The current slice spans Fastify routes, shared Ledger schemas, a promise service, a promise
repository, and a repository entity. Fastify plugins construct and decorate the repository and
service. The service accepts a promise-shaped Transaction caller because Transactions already use
Effect.

The HTTP surface under `/api/ledgers/:ledgerId/settlements` contains:

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | List Settlements after verifying the Ledger |
| GET | `/:settlementId` | Get one Settlement |
| POST | `/` | Create a Settlement |
| PUT | `/:settlementId` | Replace a drafting Settlement |
| DELETE | `/:settlementId` | Delete a drafting Settlement |
| PATCH | `/:settlementId/entries` | Attach Entries |
| DELETE | `/:settlementId/entries` | Detach Entries |
| POST | `/:settlementId/:status` | Apply a lifecycle transition |

The baseline returns `200` for create, delete, Entry mutation, and transition success. Permissions,
TypeBox validation, operation IDs, response schemas, and error schemas remain unchanged.

### Research decisions

| Concern | Existing solution | Decision | Current requirement |
| --- | --- | --- | --- |
| Effect composition | Organization and Transaction service tags and layers | reuse | Join the shared runtime |
| SQL access | Transaction's Effect Drizzle client through `DatabaseTag.effectDb` | reuse | Remove promise repository wiring |
| Settlement entity | `LedgerAccountSettlementEntity` transformations | modify | Relocate without changing output |
| Settlement schemas | TypeBox definitions in the Ledger route schema | modify | Move exact contracts into the slice |
| IDs | Existing TypeID parsers and `newLedgerAccountSettlementID` | reuse | Preserve identifiers |
| Time | Entity-owned `Date` creation at mutation points | reuse | Preserve timestamp behavior |
| Errors | Existing `ConflictError`, `NotFoundError`, and generic 500 handling | reuse | Preserve problem responses |
| Transaction posting | Existing Transaction service and idempotency key | reuse | Preserve posting behavior |
| Legacy plugin wiring | Fastify repository and service decorations | delete | Use one managed runtime |
| Settlement schema | Existing PostgreSQL tables, indexes, and check constraint | reuse | Avoid data migration |
| Characterization coverage | Existing service, repository, and route tests | modify | Pin untested baseline behavior |

## Architecture

The Settlement slice lives under `apps/api/src/domains/ledgers/settlements`:

```text
LedgerAccountSettlementEntity.ts
LedgerAccountSettlementSchema.ts
LedgerAccountSettlementRepo.ts
LedgerAccountSettlementService.ts
LedgerAccountSettlementRoutes.ts
index.ts
Settlement tests
```

The runtime flow is:

```text
Fastify routes
  -> shared managed Effect runtime
     -> LedgerAccountSettlementService
        -> LedgerService
        -> AccountService
        -> TransactionService
        -> LedgerAccountSettlementRepo
           -> Effect Drizzle -> PostgreSQL
```

The repository is one Effect `Context.Service` capability with a live Layer backed by
`DatabaseTag.effectDb`. It preserves existing query predicates, ordering, statement order, and
row mapping. It adds no transaction wrapper or parallel SQL execution.

The service is one Effect `Context.Service` capability with a live Layer. It owns Settlement
orchestration, status validation, Account validation, amount calculation, and Transaction creation.
It invokes the existing entity transformations lazily with `Effect.sync`, so ID and timestamp
creation remain entity behavior. The service depends directly on Ledger, Account, Transaction, and
Settlement repository services.

Routes remain explicit Fastify handlers. Each handler builds one Effect program and executes it
once through the request server's managed runtime. Routes convert successful entities with
`toResponse` and rethrow the same typed errors for the existing Fastify error handler.

The runtime supplies the Settlement Layer with the database and existing Ledger, Account, and
Transaction Layers. Legacy Fastify plugin registrations lose only their Settlement ownership.

## Domain and operational behavior

The lifecycle remains:

```text
drafting -> processing
processing -> pending | drafting
pending -> posted | drafting
posted -> archiving
archiving -> archived
```

The migration preserves the current call order:

- List verifies the Ledger before querying Settlements.
- Create and update fetch both Accounts concurrently, compare currencies, and then persist.
- Update performs Account validation before checking whether the Settlement exists.
- Get, delete, Entry mutation, and most transition operations scope by Organization and Settlement
  ID. They continue to ignore the Ledger path where the baseline ignores it.
- Posting creates the Transaction before linking its ID to the Settlement and before writing the
  final Settlement status.

Posting uses the idempotency key `settlement:<settlementId>`. It creates a Posted Transaction with
two Entries in the Settlement currency and amount. The settled Account direction opposes its Normal
Balance, and the contra Account uses the reverse direction. The description falls back to
`Settlement <settlementId>`. Settlement metadata is copied first, then the Settlement ID overwrites
any caller-provided `settlementId` metadata value.

Entity transformations continue to call the system clock at their current mutation points. Update
continues to replace Created Time and Updated Time during request-to-entity conversion, and the
repository continues to write a later Updated Time. Entity helper methods keep their current
timestamp behavior. The migration adds no clock service or timestamp abstraction.

## API design

The migration makes no public HTTP change. `LedgerAccountSettlementSchema.ts` owns local TypeBox
definitions that exactly match the current Settlement JSON shape, required fields, optional fields,
IDs, status values, validation, pagination, and OpenAPI metadata. The slice does not import the
legacy Ledger route schema or create shared schema infrastructure. Small TypeBox definitions remain
local, as they do in the integrated Account and Transaction slices.

Responses retain the current omissions and defaults. In particular, `externalReference` remains
stored but omitted by `toResponse`, `effectiveAtUpperBound` remains absent from the response, and a
missing Transaction ID remains the empty string. Unexpected SQL and decoding failures remain
generic HTTP 500 responses. The migration does not introduce a new 503 path.

## Data model

No migration changes the `ledger_account_settlements` or
`ledger_account_settlement_entries` tables. The Settlement table retains its Organization,
Transaction, settled Account, contra Account, Amount, Normal Balance, Currency, status,
description, External Reference, Effective At Upper Bound, metadata, Created Time, and Updated Time
columns. Its current indexes and no-self-settlement check remain.

The link table retains the composite primary key `(settlement_id, entry_id)` and its non-unique
Entry index. Entry exclusivity remains a check followed by an insert. The database gains no global
unique constraint, lock, or new isolation behavior.

## Preserved limitations

These observed baseline behaviors are compatibility constraints for this migration. They do not
replace conflicting domain rules in `CONTEXT.md`:

- The full repository update accepts only a stored `drafting` Settlement. As a result, the
  `processing -> pending` amount write and `pending -> posted` Transaction link write fail against
  the real repository. A Posted Transaction may commit before the link failure.
- Entry exclusivity uses check-then-insert and remains vulnerable to concurrent attachment races.
- `effectiveAtUpperBound` is stored but does not gather Entries automatically.
- A Pending to Drafting transition does not release linked Entries, despite the domain glossary's
  intended rule.
- Item operations retain their current Organization-only scoping where applicable.
- Update replaces Created Time instead of preserving it.
- List ordering remains descending Created Time without a tie-breaker.
- Existing request status flexibility and response omissions remain.

Each correction belongs in a separate design, plan, and change set. No correction may enter the
migration as incidental cleanup.

## Verification

- Retain existing assertions that prove observable Settlement behavior. Delete tests that cover
  retired plugin wiring or other removed implementation structure.
- Add the smallest characterization coverage needed for intermediate transition failure,
  Transaction-before-link failure, ignored Ledger path parameters, stored-only Effective At Upper
  Bound, response omissions, retained Entry links on Pending rollback, and Created Time replacement
  on update. Extend an existing test when it already owns that contract.
- Test route inputs, dependency calls, outputs, and typed failures without asserting runtime call
  counts or introducing a reusable route harness.
- Test repository SQL behavior through the existing managed PostgreSQL test Layer.
- Run focused Settlement tests, the full API test suite, repository checks, and the full local CI
  pipeline. The migration is complete only when the baseline tests and new characterization tests
  pass without schema snapshots or public contract changes.

## Trade-offs

The selected design relocates the complete slice and uses native Effect Drizzle. Keeping the files
in their legacy directories would reduce movement but preserve split ownership. Wrapping the
promise repository in Effect would reduce the first diff but retain the bridge and postpone the
actual persistence migration. The selected design costs more file movement now and leaves one
cohesive runtime boundary.

Strict behavior preservation keeps known defects. Fixing them during migration would make failures
harder to attribute and would combine compatibility work with product changes. Separate change
sets keep review, rollback, and baseline comparison clear.

## Open questions

None. The approved design is decision complete. Any newly discovered behavioral deviation stops
implementation and returns to design or planning before code changes continue.
