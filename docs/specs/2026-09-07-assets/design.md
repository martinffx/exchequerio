# Organization-owned Assets and exact amounts

This design records the decisions approved in the Assets planning interview.

## Delivery

Replace currency strings with Organization-owned Asset definitions throughout existing accounting.
Assets support currencies, fungible instruments, and Usage Credits through the same accounting
behavior. Accounts permanently reference one Asset; Transactions balance independently by Asset ID.
Settlement accounts must share an Asset. Pricing and valuation remain outside the Ledger.

Assets have an immutable generated TypeID and Minor Unit Exponent, an editable Organization-unique
uppercase code, name, description, metadata, and timestamps. Organizations create definitions
explicitly; no catalog, aliases, classification, or cache is required. Codes may be renamed and reused.
Exponents are explicitly supplied integers from 0 through 18.

Account creation and Entries accept exactly one of Asset ID or code. Code lookup is scoped to the
authenticated Organization and batched. Accounting persists IDs. Existing idempotency claims replay
before code lookup; internal retries preserve resolved identity. Responses include ID, current code,
and exponent, so historical display follows renames.

Amounts use TypeScript bigint internally, PostgreSQL BIGINT in storage, and canonical decimal strings
in JSON. Positive Entries and every final stored projection are bounded by signed 64-bit storage.
Intermediate arithmetic remains exact and can exceed that range. Final overflow rejects a mutation
atomically, including all nine Account projections. Counts, time, lock versions, and non-balance
Monitor conditions retain their existing representations.

## Implementation boundaries

Keep the existing Route, Service, Repository, and Entity responsibilities and Effect runtime. Reuse
TypeBox contracts, native Drizzle Effect queries, database constraints, permissions, and pagination.
Asset selection and raw quantity validation must not change global Fastify validation behavior.
Statement Asset hydration includes Organization ownership predicates to prevent metadata disclosure.

The clean cutover generates a new migration without rewriting history. Lock and reject populated
currency-bearing tables rather than guessing exponents or deleting data. Use a fresh development
database. There is no legacy wire compatibility or new UI. The full public contract is documented
in [Assets and amounts](../../../apps/api/docs/product/assets.md).

## Follow-up work

- Calculate Category balance vectors by Asset, counting each descendant Account once.
- Implement reproducible Statement snapshots and their actual starting/ending balances.
- Implement Monitor condition persistence, evaluation, and emission semantics.

Until implemented, omit Category and Monitor balance arrays and Statement starting/ending balance
arrays. These follow-ups do not expand the Asset delivery. Add caching only when measurements justify
it and code-rename consistency has an explicit design.

## Acceptance

Verify scoped CRUD, code normalization/uniqueness/reuse, immutable identity/exponents, safe deletion,
mixed ID/code selection, independent balancing, same-Asset Settlements, and current display metadata.
Exercise quantities above JavaScript's safe limit, int64 limits, invalid encodings, exact cancellation,
overflow rollback, retries after code renames, and ownership constraints with PostgreSQL.

Run the complete API suite, repository checks, API build, benchmark discovery, migration tests, and
combined requirements/code-quality review. Generated OpenAPI follows the TypeBox source changes.
