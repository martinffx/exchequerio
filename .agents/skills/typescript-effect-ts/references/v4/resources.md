# Effect v4 resource management

Use this guide only after confirming the target package uses Effect v4.
First use the resource library's native finalizer and the application's existing
shutdown path. Add Effect lifecycle machinery only when Effect owns an otherwise
unmanaged resource lifetime.

## Scoped acquisition and release

`Effect.acquireRelease` registers the release action in the current `Scope`. Wrap the complete use of the resource in `Effect.scoped`.

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

The release action runs after success, expected failure, defect, or interruption. Keep release effects infallible; log cleanup problems rather than adding them to the expected error channel.

## Inline acquire-use-release

Use `acquireUseRelease` when the resource should not escape a single operation:

```typescript
const rows = Effect.acquireUseRelease(
  Effect.sync(openConnection),
  (resource) => resource.query("SELECT * FROM users"),
  (resource, _exit) => Effect.sync(() => resource.close())
)
```

The scope is managed by the combinator, so an outer `Effect.scoped` is unnecessary.

## Manual scopes

```typescript
import { Scope } from "effect"

const manuallyScoped = Effect.acquireUseRelease(
  Scope.make(),
  (scope) => connection.pipe(
    Scope.provide(scope),
    Effect.flatMap((resource) => resource.query("SELECT 1"))
  ),
  (scope, exit) => Scope.close(scope, exit)
)
```

Prefer `Effect.scoped` unless the resource lifetime must outlive one lexical effect. `Scope.provide` replaces v3's `Scope.extend` and does not close the supplied scope.

## Finalizers

```typescript
const withFinalizer = Effect.scoped(
  Effect.gen(function*() {
    yield* Effect.addFinalizer((exit) =>
      Effect.logDebug("scope closed", { exit: String(exit) })
    )
    return "ready"
  })
)
```

For cleanup not already handled by the library, use `Effect.ensuring` around an
Effect, `Effect.onExit` when cleanup depends on the outcome, or
`Effect.addFinalizer` when attaching cleanup to the current scope.

## Resource-owning services

```typescript
import { Context, Layer } from "effect"

class Database extends Context.Service<Database, Connection>()("Database") {}

const databaseLayer = Layer.effect(Database, connection)

const app = Effect.gen(function*() {
  const database = yield* Database
  return yield* database.query("SELECT 1")
}).pipe(Effect.provide(databaseLayer))
```

`Layer.effect` owns scoped acquisition in v4 and closes resources when the Layer
scope ends. Use this pattern only when the Layer owns an application-lifetime
pool, client, server, or file watcher.

## Rules

- Acquire lazily inside Effect; do not allocate at module initialization.
- Register release immediately with acquisition.
- Do not return a scoped resource beyond its scope.
- Use child scopes only when independent lifetimes are required.
- Prefer interruptible use phases and uninterruptible acquisition/release boundaries provided by the resource combinators.
- Compose resource layers once and provide them at the application boundary.
