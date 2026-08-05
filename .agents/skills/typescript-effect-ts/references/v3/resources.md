# Effect v3 resource management

Use this guide only after confirming the target package uses Effect v3.

## Scoped acquisition and release

```typescript
import { Effect } from "effect"

interface Connection {
  readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>, Error>
  readonly close: () => void
}

declare const openConnection: () => Connection

const connection = Effect.acquireRelease(
  Effect.sync(openConnection),
  (resource, _exit) => Effect.sync(() => resource.close())
)

const program = Effect.scoped(
  Effect.gen(function*() {
    const resource = yield* connection
    return yield* resource.query("SELECT 1")
  })
)
```

The release action runs after success, expected failure, defect, or interruption. Keep it infallible.

## Inline acquire-use-release

```typescript
const rows = Effect.acquireUseRelease(
  Effect.sync(openConnection),
  (resource) => resource.query("SELECT * FROM users"),
  (resource, _exit) => Effect.sync(() => resource.close())
)
```

Use this form when the resource must not escape a single operation.

## Manual scopes

```typescript
import { Scope } from "effect"

const manuallyScoped = Effect.acquireUseRelease(
  Scope.make(),
  (scope) => connection.pipe(
    Scope.extend(scope),
    Effect.flatMap((resource) => resource.query("SELECT 1"))
  ),
  (scope, exit) => Scope.close(scope, exit)
)
```

Prefer `Effect.scoped` unless the lifetime must be controlled explicitly. `Scope.extend` provides an existing scope without closing it.

## Resource-owning services

```typescript
import { Context, Layer } from "effect"

class Database extends Context.Tag("Database")<Database, Connection>() {}

const DatabaseLive = Layer.scoped(Database, connection)

const app = Effect.gen(function*() {
  const database = yield* Database
  return yield* database.query("SELECT 1")
}).pipe(Effect.provide(DatabaseLive))
```

Use `Layer.scoped` for application-lifetime pools, clients, servers, and watchers.

## Rules

- Acquire lazily inside Effect; do not allocate at module initialization.
- Register release with acquisition.
- Do not return a resource beyond its scope.
- Prefer `acquireUseRelease` for one operation and scoped layers for application services.
- Use `Effect.ensuring`, `Effect.onExit`, or `Effect.addFinalizer` for additional cleanup.
