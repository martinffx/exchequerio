# Ledger API

The Ledger API lives in `apps/api`. It uses Fastify, TypeBox, Effect, Drizzle, and PostgreSQL. Confirm
versions and available commands in `apps/api/package.json` before using framework APIs.

## Layer ownership

Dependencies flow from Routes to Services to Repositories and Entities to PostgreSQL.

| Concern                                                                      | Owner                  |
| ---------------------------------------------------------------------------- | ---------------------- |
| HTTP shape, validation, status, headers, authentication, and OpenAPI         | Routes and TypeBox     |
| Use cases, time, idempotency, retries, and dependencies                      | Services               |
| SQL, missing rows, transactions, optimistic concurrency, and database errors | Repositories           |
| Representation conversion, domain invariants, and state transitions          | Entities               |
| Row shape, relationships, and storage constraints                            | Drizzle and PostgreSQL |

Keep response schemas and response types in the slice's `*Schema.ts` file. Put the transformation on
the entity as `toResponse()` or a specifically named response method when a resource has more than
one representation. Routes call that method; do not create a parallel route-level mapper.

Treat TypeBox and Drizzle schemas as the canonical transport and row types. Derive types from them;
do not add handwritten mirrors or intermediate option types that merely copy their fields. Entity
`fromRequest` methods receive TypeBox-valid data and enforce only additional domain invariants.
Entity `fromRow` methods convert real persistence representations, such as TypeID strings, JSON,
timestamps, and nullable fields, and enforce only invariants not guaranteed by Drizzle or
PostgreSQL. Entity `toRow` and response methods own the inverse conversions. Add only the methods a
resource needs; the Organization entity is an ownership example, not a required method inventory.
Do not repeat the same validation in routes, entities, repositories, and services.

## Persistence and consistency

Derive row types from the Drizzle schema. Repositories must preserve Organization and Ledger scope
in their queries. Multi-row ledger mutations belong in one PostgreSQL transaction.

Do not weaken optimistic concurrency control. When an update relies on a lock version, include the
expected version in the write predicate, increment it as part of the write, and treat a missing
updated row as a conflict. Preserve existing retry and idempotency behavior when changing a write
path.

Generate migrations from schema changes, review the generated SQL, and keep migrations separate
unless broader scope is requested.

## Effect and errors

Use the installed Effect major and copy the nearest approved slice only where it solves the same
problem. Existing code is evidence, not permission to copy ceremony.

- Keep pure, total transformations synchronous. Use Effect-based entity codecs when decoding can
  fail, but do not turn every mapping into an Effect pipeline.
- Add a service only for a real dependency, and add a Layer only to construct that dependency or
  manage its lifetime. Resource repositories and use-case services may follow the established
  `Context.Service` pattern; pure helpers, codecs, mappers, and validators do not become services.
  Do not wrap a service in a parallel interface, tag, factory, or implementation class. Test doubles
  do not justify additional production abstractions.
- Add a tagged error only when a caller handles it differently through HTTP mapping, retry, cleanup,
  or orchestration and no existing error represents that handling. A different message or cause does
  not justify a new error type.
- Do not add decoders or defensive branches for states that TypeBox, Drizzle, PostgreSQL, or an
  existing domain contract already excludes. Each decoder branch must correspond to a value a real
  producer can supply.

## Validation

Start PostgreSQL before targeted integration tests when it is not already running.

```bash
pnpm run docker:up
pnpm --filter=@exchequerio/api test
pnpm --filter=@exchequerio/api build
pnpm --filter=@exchequerio/api types
```

Read the relevant [API specification](../../apps/api/docs/spec/) for resource behavior and the
[entity relationship diagram](../../apps/api/docs/product/erd.md) for persistence work.
