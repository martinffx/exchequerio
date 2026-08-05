# Effect v4 services and layers

Use this guide only after confirming the target package uses Effect v4.

## Define services with Context.Service

```typescript
import { Context, Effect } from "effect"

class Database extends Context.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>, Error>
  readonly execute: (sql: string) => Effect.Effect<void, Error>
}>()("Database") {}
```

The identifier string is the runtime key and must be unique. Function-style services are also supported:

```typescript
interface Logger {
  readonly log: (message: string) => Effect.Effect<void>
}

const Logger = Context.Service<Logger>("Logger")
```

## Access services explicitly

```typescript
const getUsers = Effect.gen(function*() {
  const database = yield* Database
  return yield* database.query("SELECT * FROM users")
})

const logOnce = Logger.use((logger) => logger.log("starting"))
```

Prefer `yield*` for workflows with several operations because dependencies remain visible near their use. `Service.use` is convenient for one effectful call; `useSync` is for a pure callback and still returns an Effect.

## Build layers

```typescript
import { Layer } from "effect"

const databaseTest = Layer.succeed(Database, {
  query: () => Effect.succeed([]),
  execute: () => Effect.void
})

const databaseLayer = Layer.effect(
  Database,
  Effect.acquireRelease(
    Effect.sync(() => ({
      query: (_sql: string) => Effect.succeed([]),
      execute: (_sql: string) => Effect.void,
      close: () => undefined
    })),
    (database) => Effect.sync(() => database.close())
  )
)
```

In v4, `Layer.effect` handles both ordinary and scoped construction. The older `Layer.scoped` constructor is removed.

Use the convention `layer` for a service's primary implementation and descriptive names such as `layerTest` for variants.

## Services with constructors

```typescript
class UserRepository extends Context.Service<UserRepository>()(
  "UserRepository",
  {
    make: Effect.gen(function*() {
      const database = yield* Database
      return {
        findAll: () => database.query("SELECT * FROM users")
      }
    })
  }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(databaseLayer)
  )
}
```

`Context.Service` does not generate a default layer and has no `dependencies` option. Define the layer explicitly and wire its dependencies with `Layer.provide`.

## Compose once, provide at the boundary

```typescript
const loggerLayer = Layer.succeed(Logger, {
  log: (message) => Effect.sync(() => console.log(message))
})

const appLayer = Layer.merge(UserRepository.layer, loggerLayer)

const program = Effect.gen(function*() {
  const repository = yield* UserRepository
  const logger = yield* Logger
  yield* logger.log("loading users")
  return yield* repository.findAll()
})

await Effect.runPromise(program.pipe(Effect.provide(appLayer)))
```

Build dependency layers bottom-up and prefer one composed provision at the application boundary. v4 shares layer memoization across `Effect.provide` calls, but composition remains easier to inspect.

Use `Layer.fresh(layer)` or `Effect.provide(layer, { local: true })` when a layer subtree must be rebuilt, such as per-test resource isolation.

## Testing

Provide a small test layer instead of mocking Effect internals:

```typescript
const databaseLayerTest = Layer.succeed(Database, {
  query: () => Effect.succeed([{ id: "1", name: "Test User" }]),
  execute: () => Effect.void
})

const result = await Effect.runPromise(
  getUsers.pipe(Effect.provide(databaseLayerTest))
)
```

Keep service interfaces small, keep live resource acquisition in layers, and substitute complete implementations in tests.
