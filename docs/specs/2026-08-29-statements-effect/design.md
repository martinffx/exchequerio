# Ledger Account Statements: fully Effect-native

## Problem

The Statements slice (`apps/api/src/domains/ledgers/accounts/statements`) runs on the managed Effect
runtime, but its error handling is imperative code carried into Effect. The repo declares every
method as `Effect<_, unknown>` and guesses the error type with `instanceof`. The service and repo
wrap throwing helpers in `Effect.try({ catch: e => e })`. The entity decodes stored ids late, inside
`toResponse`, so a corrupt value throws a defect at response time. Maintainers cannot tell from a
signature what can fail, and the slice differs from Organizations, the reference.

## Scope

**In scope:** typed error channels for the repo and service; Option for absence; entity decoding in
`fromRow`; period and balance checks as Effects; idempotency-claim handling aligned with
Transactions; tests updated at their existing boundaries.

**Out of scope:** the snapshot product contract (see `apps/api/docs/product/statements.md`), new
behavior, schema or migration changes, other slices, errors beyond the infrastructure trio,
Schema decoding of snapshot JSON.

## User stories

- US-1 (must): As a maintainer, I want every repo and service operation to declare its errors.
  - Given any method, its error channel is a named union of shared errors and the infrastructure
    trio, never `unknown`.
  - Given the production Statement files, there is no `catch: x => x` and no `instanceof` mapping
    of an unknown cause.
  - Given a missing Statement, the repo returns `Option.none` and the service fails with
    `NotFoundError` (404).
- US-2 (must): As an operator, I want an undecodable stored id or timestamp to fail as
  `StatementPersistenceDecodingFailure`, reaching the global handler as a 500, not a thrown defect.
  Rows and snapshot entries written by the repo itself decode to byte-identical responses.
- US-3 (must): As an API consumer, I want routes, bodies, OpenAPI and statuses unchanged (400 bad
  period or oversize, 404, 409 stale version or overflow, 503 unavailable, 500).
- US-4 (must): As a client retrying a create, I want claim handling like Transactions: a known
  rejection (bad period, oversize, missing Account, int64 overflow) releases the idempotency claim;
  an infrastructure failure retains it. This is the only behavior difference: an overflow 409
  previously retained the claim.

## Constraints

- Effect v4 as installed; Effect-Drizzle through `DatabaseTag.effectDb`; no new services or layers.
- Follow `docs/standards/api.md` and the Organizations and Balance Monitors retrospectives: reuse
  shared errors and helpers, no abstraction without a current consumer, tests at Repo, Service and
  Routes only.

## Context

- The Organization slice is the reference: `OrganizationErrors.ts`, `Organization.fromRow`,
  `OrganizationRepo` (`Effect.tryPromise` with a mapped `catch`), `OrganizationService.requireFound`.
- `LedgerTransactionService.releaseFailedMutation` retains an idempotency claim only for
  infrastructure errors; this slice adopts that rule.
- Shared helpers exist: `parseUuid`, `parseDate`, `assertInt64`, `isPostgresUnavailable`.

## Research decisions

| Concern                    | Existing solution                                          | Decision                                             | Current requirement                                                             |
| -------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Error types                | Organization/Account error files                           | new (`StatementErrors.ts`, infrastructure trio only) | Replace `unknown` channels and `mapError`                                       |
| Overflow and period errors | Shared `BadRequestError`, `ConflictError`                  | reuse                                                | Keep today's statuses                                                           |
| Absence                    | Repos return `Option`; services `requireFound`             | modify                                               | Repo currently fails with `NotFoundError`                                       |
| Row decoding               | Entity `fromRow` as an Effect with `parseUuid`/`parseDate` | modify                                               | Decoding is deferred into `toResponse`, `id`, entry conversion                  |
| Throwing helpers           | `Effect.fail` in migrated entities                         | modify                                               | `validateStatementPeriod`, `calculateStatementBalances`, three identity `Effect.try` |
| Pure transformations       | `api.md`: keep sync when total                             | reuse                                                | `toResponse` stays sync after decoding                                          |
| Idempotency release        | Transactions retain only for the infrastructure union      | modify                                               | Align with main                                                                 |
| SQL                        | `Effect.tryPromise` with mapped catch                      | reuse                                                | Repo already uses Effect-Drizzle                                                |
| Tests                      | Repo, Service, Routes only                                 | reuse                                                | No entity suite                                                                 |
| Contract doc               | `statements.md`                                            | reuse                                                | Link, do not restate                                                            |

## Architecture

Layout is unchanged plus one file; dependencies flow Routes → Service → Repo → Entity → PostgreSQL.

- `StatementErrors.ts` (new): `StatementPersistenceDecodingFailure`, `StatementPersistenceFailure`,
  `StatementRepositoryUnavailable`, their union, and `mapStatementInfrastructureError`.
- Entity: `fromRow` returns an Effect failing with the decoding failure; the period check and
  balance calculation return Effects failing with `BadRequestError` / `ConflictError`; `toResponse`
  is sync and total over decoded TypeIDs and `DateTime`s, serialized with `.toISO()`; a
  snapshot-entry decoder returns response-shaped entries.
- Repo: precise error types; `getStatement` returns `Option`; SQL via `Effect.tryPromise` with
  `catch: mapStatementInfrastructureError`; `getEntries` returns decoded entries; `mapError`, the
  `unknown` channels and the identity `Effect.try` blocks are deleted.
- Service: `requireFound`; create releases the claim unless the error is in the infrastructure
  union; the period check is yielded directly.
- Routes: unchanged except entry conversion moves into the repo result.
- Untrusted input: TypeBox and `parseId` at the route edge; `fromRow` and the entry decoder are the
  only places stored data is decoded.

## API design

No changes. Routes, bodies, OpenAPI and statuses stay as they are.

## Data model

No changes. No migration.

## Trade-offs

- Selected: typed channels with only the error classes a caller must distinguish.
- Rejected: the full Organization error set (`StatementNotFound`, `StatementVersionConflict` differ
  only by message); Schema decoding of snapshot JSON (the repo writes it itself); leaving as is.
- Known differences: a corrupt stored value is a typed 500 instead of a thrown defect; an overflow
  409 releases the idempotency claim; the repo's `getEntries` returns response-shaped entries.

## Open questions

None.
