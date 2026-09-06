# Drizzle ORM with Effect PostgreSQL

Use this guide only after confirming the target package uses Effect v4 and
imports `drizzle-orm/effect-postgres`. The native driver integrates Drizzle with
the `@effect/sql-pg` client service.

## Check package compatibility

Inspect the owning `package.json`, lockfile, and installed declarations before
choosing APIs. The packages must include compatible releases of `effect`,
`@effect/sql-pg`, `drizzle-orm`, `pg`, and `@types/pg`. Prerelease tags and peer
dependency ranges change independently, so do not copy version tags from an
example or upgrade packages unless the user requested it.

The current native integration targets Effect v4. For an Effect v3 project,
follow the installed Drizzle driver's declarations rather than applying this
guide.

## Provide the PostgreSQL client

Build one `PgClient` Layer from the application's existing configuration. Keep
the connection URL redacted and let the client Layer own its pool lifecycle.

Drizzle needs selected PostgreSQL temporal and array values in raw form so it
can apply its own decoders. Delegate every other type to `pg`:

```typescript
import { PgClient } from "@effect/sql-pg"
import { types } from "pg"
import * as Redacted from "effect/Redacted"

const drizzleTypeIds = new Set([
  1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182
])

const pgClientLayer = PgClient.layer({
  url: Redacted.make(databaseUrl),
  types: {
    getTypeParser: (typeId, format) =>
      drizzleTypeIds.has(typeId)
        ? (value: string) => value
        : types.getTypeParser(typeId, format)
  }
})
```

Reuse an established configuration service instead of reading `process.env`
inside the database module.

## Create the Drizzle database

Use `PgDrizzle.makeWithDefaults()` when the application does not need query
logging or caching. It returns an Effect that requires the `PgClient` service and
uses no-op logger and cache implementations:

```typescript
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { Effect } from "effect"

const program = Effect.gen(function*() {
  const database = yield* PgDrizzle.makeWithDefaults()
  return yield* database.select().from(users)
})

const runnable = program.pipe(Effect.provide(pgClientLayer))
```

Run `runnable` only at the application's existing Effect boundary.

## Expose a database service when needed

For a larger application, create one database service Layer and compose its
dependencies bottom-up. Reuse the project's existing database tag when it has
one:

```typescript
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { Context, Effect, Layer } from "effect"
import * as relations from "./schema/relations"

const makeDatabase = PgDrizzle.make({ relations }).pipe(
  Effect.provide(PgDrizzle.DefaultServices)
)

class Database extends Context.Service<
  Database,
  Effect.Effect.Success<typeof makeDatabase>
>()("Database") {}

const databaseLayer = Layer.effect(Database, makeDatabase).pipe(
  Layer.provide(pgClientLayer)
)
```

Use `Layer.provideMerge` only when downstream services also need direct access
to `PgClient`. Keep queries and driver error classification in the established
repository boundary.

## Configure logging and caching only when required

`PgDrizzle.makeWithDefaults()` disables query logging and caching. When the
application needs either capability, use `PgDrizzle.make()` and provide the
required service Layers explicitly:

- Import `EffectLogger` from `drizzle-orm/effect-postgres` for Effect logging or
  to wrap an existing Drizzle logger.
- Import `EffectCache` from `drizzle-orm/cache/core/cache-effect` to wrap an
  existing Drizzle cache.
- Provide `PgDrizzle.DefaultServices` for any logger or cache service that the
  application does not replace.

Verify these export paths against the installed Drizzle declarations before
using them. Do not add logging, caching, pool tracking, or shutdown machinery
without a current application requirement.

Source: [Drizzle ORM: Effect Postgres](https://orm.drizzle.team/docs/connect-effect-postgres)
