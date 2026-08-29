# Ledger API

The Ledger API lives in `apps/api`. It uses Fastify, TypeBox, Effect, Drizzle, and PostgreSQL. Confirm
versions and available commands in `apps/api/package.json` before using framework APIs.

## Layer ownership

Dependencies flow from Routes to Services to Repositories and Entities to PostgreSQL.

- Routes own HTTP concerns: request and parameter validation, authorization hooks, status codes,
  headers, response schemas, and OpenAPI wiring.
- Services orchestrate use cases, time, idempotency, retries, and dependencies.
- Repositories own SQL, PostgreSQL transactions, optimistic concurrency writes, and database error
  translation.
- Entities own domain invariants and transformations into and out of requests, persistence rows, and
  responses. They may use type-only transport and row contracts. They do not perform I/O.

Keep response schemas and response types in the slice's `*Schema.ts` file. Put the transformation on
the entity as `toResponse()` or a specifically named response method when a resource has more than
one representation. Routes call that method; do not create a parallel route-level mapper.

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

Use the installed Effect major and the patterns already present in the slice. Expected domain,
validation, conflict, and infrastructure failures remain typed until the HTTP boundary. Do not add
decoders or defensive branches for states that the existing contract already excludes.

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
