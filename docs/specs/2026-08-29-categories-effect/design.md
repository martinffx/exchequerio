# Ledger Account Categories ownership and Effect migration

## Problem

Ledger Account Category operations use Ledger IDs without checking that the authenticated
Organization owns the Ledger. The Category and relationship tables also lack the composite
ownership constraints used by Accounts and Transactions. A caller with another Organization's
Ledger ID can reach its Categories, and PostgreSQL accepts cross-Ledger Account relationships.

Categories also remain on Promise-based routes, service wiring, and a Node Drizzle repository while
the integrated Ledger slices use the server's managed Effect runtime. The prepared Category Effect
cutover exposes `unknown` failures across repository and service boundaries.

The work ships as two stacked change sets:

1. Add Organization and Ledger ownership, enforce relationship ownership, and define Category error
   behavior.
2. Move the hardened Category slice to Effect with explicit error unions.

The first change set intentionally changes tenancy, persistence, and availability behavior. The
second change set follows `EFFECT_MIGRATION.md` and preserves that new baseline.

## Scope

### In scope

- Store Organization and Ledger ownership on Categories and both Category relationship tables.
- Scope all nine Category operations by the authenticated Organization and route Ledger.
- Return `404` when the Organization does not own the route Ledger.
- Reject cross-Ledger Account and parent relationships in PostgreSQL.
- Backfill existing ownership without deleting data and abort on inconsistent relationships.
- Add Category-specific not-found, conflict, persistence-decoding, persistence-failure, and
  repository-unavailable errors.
- Return `503` when PostgreSQL is unavailable.
- Migrate Category routes, service, and repository to the managed Effect runtime with explicit
  error unions.
- Preserve existing Category HTTP success contracts, sequencing, timestamps, upsert behavior,
  pagination, and relationship idempotency.

### Out of scope

- Optimistic concurrency control or a Category `lock_version`.
- Real Category balance aggregation or changes to the placeholder balance response.
- Full cycle detection beyond direct self-link rejection.
- Transactions, retries, idempotency keys, clocks, ID services, or a new runtime.
- Moving the Category slice into the domain directory or adding a generic route executor.

## User stories

### US-1: Isolate Categories by Organization

As an authenticated API caller, I can operate only on Categories in Ledgers owned by my
Organization.

- Every operation reads `request.token.orgId` and the route Ledger ID.
- A foreign-Organization Ledger is indistinguishable from a missing Ledger and returns `404`.
- Repository predicates include both Organization ID and Ledger ID.
- List and create validate Ledger ownership instead of returning an empty list or relying only on a
  foreign-key failure.

### US-2: Enforce relationship ownership

As a Ledger operator, I cannot create a Category relationship across Ledger or Organization
boundaries.

- Account membership requires the Account and Category to share Organization and Ledger ownership.
- Parent relationships require the child and parent Category to share Organization and Ledger
  ownership.
- PostgreSQL enforces both rules with composite foreign keys.
- Duplicate valid links remain successful and idempotent.
- Parent Categories may still have multiple children and parents. Direct self-links remain
  conflicts, and longer cycles remain possible.

### US-3: Use typed Category failures

As an API maintainer, I can distinguish supported Category and infrastructure failures without an
`unknown` failure channel.

- Missing Categories fail with `CategoryNotFound`.
- Immutable ownership mismatches and direct self-links fail with `CategoryConflict`.
- Stored-row decoding fails with `CategoryPersistenceDecodingFailure`.
- Other PostgreSQL failures fail with `CategoryPersistenceFailure`.
- PostgreSQL unavailability fails with `CategoryRepositoryUnavailable` and returns `503`.
- Errors retain the original failure as their cause where one exists.

### US-4: Complete the Effect cutover

As an API maintainer, I want Category routes, service orchestration, and PostgreSQL operations to
use the server's managed Effect runtime.

- Routes execute Category Effects through `server.runtime`.
- The Category service Layer depends on the Category repository and Ledger service Layers.
- The live repository uses `DatabaseTag.effectDb`.
- Repository and service methods declare operation-specific error unions. They never use `unknown`
  as the Effect failure type.
- Unrelated legacy slices keep their existing wiring.

### US-5: Preserve unrelated Category behavior

As an API caller, I receive the existing result when the request does not exercise the intentional
ownership or availability changes.

- Methods, paths, permissions, request bodies, success statuses, headers, response bodies, and
  operation IDs remain unchanged.
- Lists retain `created DESC` ordering and existing offset and limit behavior.
- PUT remains last-writer-wins and keeps its nontransactional existence read followed by an ID-based
  upsert.
- Category creation and updates retain their existing ID and timestamp behavior.
- Malformed stored metadata remains tolerated as absent.
- Relationship operations retain their relative call order and `ON CONFLICT DO NOTHING` behavior.

## Current baseline

All routes use `/api/ledgers/:ledgerId/accounts/categories`.

| Operation      | Route suffix                                       | Success | Permission                       |
| -------------- | -------------------------------------------------- | ------: | -------------------------------- |
| List           | `GET /`                                            |   `200` | `ledger:account:category:read`   |
| Get            | `GET /:categoryId`                                 |   `200` | `ledger:account:category:read`   |
| Create         | `POST /`                                           |   `200` | `ledger:account:category:write`  |
| Replace        | `PUT /:categoryId`                                 |   `200` | `ledger:account:category:write`  |
| Delete         | `DELETE /:categoryId`                              |   `200` | `ledger:account:category:delete` |
| Link Account   | `PATCH /:categoryId/accounts/:accountId`           |   `200` | `ledger:account:category:write`  |
| Unlink Account | `DELETE /:categoryId/accounts/:accountId`          |   `200` | `ledger:account:category:write`  |
| Link parent    | `PATCH /:categoryId/categories/:parentCategoryId`  |   `200` | `ledger:account:category:write`  |
| Unlink parent  | `DELETE /:categoryId/categories/:parentCategoryId` |   `200` | `ledger:account:category:write`  |

Create sets no `Location` header. Responses retain three zero-valued USD balance entries and ISO
timestamps. Category IDs remain `lac` TypeIDs.

Before this work, Category queries use Ledger ID alone, Category rows do not store Organization ID,
and relationship rows store only their two resource IDs. Account linking checks Account existence
through a foreign-key error but does not require the Account to share the Category's Ledger.

Update reads the Category for existence and then performs an ID-based upsert. These statements do
not share a transaction. A concurrent delete can therefore allow the upsert to recreate the
Category. Relationship operations also use separate reads and writes. These concurrency behaviors
remain unchanged.

## Change set 1: ownership and error behavior

### Data model

`ledger_account_categories` gains a non-null `organization_id`. It uses a composite foreign key
from `(organization_id, ledger_id)` to `ledgers(organization_id, id)` and a unique key on
`(organization_id, ledger_id, id)` for relationship ownership references.

`ledger_account_category_accounts` gains non-null `organization_id` and `ledger_id` columns. Its
Category foreign key becomes
`(organization_id, ledger_id, category_id) -> ledger_account_categories`, and its Account foreign
key becomes `(organization_id, ledger_id, account_id) -> ledger_accounts`. Both preserve cascade
deletion. The existing `(category_id, account_id)` primary key and Account index remain.

`ledger_account_category_parents` gains the same ownership columns. Composite foreign keys connect
both the child and parent IDs to Categories under the stored Organization and Ledger. They preserve
cascade deletion. The existing primary key, parent index, and direct self-reference check remain.

The Category entity carries `organizationId`. Request construction receives both Organization and
Ledger IDs, row conversion decodes both IDs, and row encoding writes both values. The public
response does not add Organization ID.

### Migration

The generated migration performs these steps in one transaction:

1. Add nullable ownership columns.
2. Backfill each Category's Organization from its Ledger.
3. Backfill each relationship's Organization and Ledger from its child Category.
4. Raise an exception if an Account relationship's Account has different Organization or Ledger
   ownership.
5. Raise an exception if a parent relationship's parent Category has different Organization or
   Ledger ownership.
6. Add non-null, unique, index, and composite foreign-key constraints only after validation passes.

The migration never deletes or rewrites relationship rows to make invalid data fit. PostgreSQL
rolls back the transaction when validation fails.

### Application boundaries

Routes pass `request.token.orgId` into every Category service method. Each method first calls
`LedgerService.getLedger(organizationId, ledgerId)`. This gives list and create the same ownership
check as resource-specific operations. It also makes a foreign Ledger return the existing
`LedgerNotFound` response.

During the first change set, the Promise-based Category service accepts a narrow Ledger ownership
dependency. `services/index.ts` supplies it by running the existing `LedgerServiceTag` capability
through `server.runtime`. This matches the current managed-runtime adapter pattern. Category route
fixtures also supply `organizationId` when they construct Category entities. The Effect cutover
removes this temporary Promise adapter when the Category service begins using `LedgerServiceTag`
directly.

The Category repository receives Organization and Ledger IDs on every operation. Category reads,
writes, and deletes filter by both values. Relationship inserts write both ownership columns, and
their composite foreign keys provide the final ownership check.

The leading Ledger ownership check is new. After it succeeds, operation order remains:

- Update reads the Category, then upserts it.
- Link Account reads the Category, then inserts the junction row without pre-reading the Account.
- Unlink Account reads the Category, then deletes the junction row.
- Link parent reads the child, reads the parent, checks direct equality, then inserts.
- Unlink parent reads the child, then deletes the junction row.

Create and upsert map an ownership foreign-key failure to `LedgerNotFound`. Account-link ownership
foreign-key failures map to the existing `AccountNotFound`. Parent ownership failures map to
`CategoryNotFound`. The repository maps all other adapter failures through the Category
infrastructure error family.

### Error contract

`LedgerAccountCategoryErrors.ts` defines:

- `CategoryNotFound`, a `NotFoundError` with the existing Category details.
- `CategoryConflict`, a `ConflictError` for immutable ownership mismatch and direct self-links.
- `CategoryPersistenceDecodingFailure`, an `InternalServerError` for stored-row conversion.
- `CategoryPersistenceFailure`, an `InternalServerError` for other persistence failures.
- `CategoryRepositoryUnavailable`, a `ServiceUnavailableError` for PostgreSQL unavailability.

Each mapping keeps its cause. The route error schemas remain unchanged except that list and create
advertise their newly reachable `404` response. The existing `503` schema now corresponds to a
produced response.

## Change set 2: typed Effect cutover

The Effect cutover starts only after the ownership change set passes its focused and migration
tests. Its baseline is the hardened Category behavior above.

```text
Fastify and TypeBox Category routes
  -> managed ServerRuntime
     -> LedgerAccountCategoryServiceTag
        -> LedgerServiceTag
        -> LedgerAccountCategoryRepoTag
           -> DatabaseTag.effectDb
              -> PostgreSQL
```

The repository retains its eight operations and adds a tag, live Layer, and explicit capability
types. Each operation declares the smallest union of `LedgerNotFound`, `AccountNotFound`,
`CategoryNotFound`, `CategoryConflict`, and Category infrastructure errors that it can produce.
Repository code catches Effect Drizzle failures at the SQL boundary and converts row failures at
the entity boundary. No expected failure crosses either boundary as `unknown`.

The service retains its nine operations and exposes `LedgerAccountCategoryServiceTag`. Its Layer
depends on `LedgerServiceTag` and `LedgerAccountCategoryRepoTag`. Each method validates Ledger
ownership, performs its existing orchestration, and declares an operation-specific error union.

Routes parse identifiers with the shared typed parser, obtain the Category service through its tag,
and execute one program through `server.runtime`. Successful Effects convert entities to the
existing response shape. Failed Effects reach the global handler as their typed HTTP error values.

The runtime composes the Category repository and service Layers. The legacy repository and service
plugins remove only their Category types, construction, decoration, and fixture injection. The
Settlement, Statement, and Balance Monitor wiring remains unchanged.

## Test design

Ownership tests precede the Effect cutover:

- Migration integration tests prove valid backfill, all composite constraints, and transactional
  failure for existing cross-scope Account and parent rows.
- Repository tests cover Organization isolation for every operation, ownership predicates,
  cross-Ledger Account rejection, parent ownership rejection, cascades, and duplicate links.
- Service tests verify Organization propagation, leading Ledger validation, existing operation
  order, last-writer-wins updates, and the delete/recreate window.
- Route tests prove foreign-Organization access returns `404`, Account-not-found failures map to
  `404`, PostgreSQL unavailability returns `503`, and authentication and permission behavior
  remains.

Effect tests then prove that repository and service failures use the failure channel with their
exact typed value rather than defects or `unknown`. Existing characterization assertions for HTTP,
pagination, timestamps, metadata tolerance, upserts, races, and relationship sequencing remain.

Validation runs focused Category and migration tests after the first change set, then API typecheck
and focused Effect tests after the second. The final branch must pass `pnpm run check`,
`pnpm run ci`, and `git diff --check`.

## Known limitations

Categories retain last-writer-wins PUTs, the delete/recreate race, longer Category cycles,
unconstrained pagination values, and placeholder balances. These limitations do not weaken
Organization or Ledger ownership.
