# Effect v3 services and dependency injection

Use this guide only after confirming the target package uses Effect v3.
Create a service and Layer only for a real dependency or resource lifetime. Reuse
existing tags, interfaces, implementations, test Layers, and runtime composition;
ordinary capabilities can remain functions or values.

## Define and use services

```typescript
import { Context, Effect } from "effect"

class Database extends Context.Tag("Database")<Database, {
  readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>, Error>
  readonly execute: (sql: string) => Effect.Effect<void, Error>
}>() {}

const getUsers = Effect.gen(function*() {
  const database = yield* Database
  return yield* database.query("SELECT * FROM users")
})
```

When a new service is required, use a unique runtime identifier and keep its
interface small. Do not add a class, interface, tag, and Layer when the capability
does not need dependency injection.

## Build layers

```typescript
import { Layer } from "effect"

const DatabaseTest = Layer.succeed(Database, {
  query: () => Effect.succeed([]),
  execute: () => Effect.void
})

const DatabaseLive = Layer.effect(
  Database,
  Effect.sync(() => ({
    query: (_sql: string) => Effect.succeed([]),
    execute: (_sql: string) => Effect.void
  }))
)
```

Use `Layer.succeed` for an existing implementation, `Layer.effect` for effectful construction, and `Layer.scoped` when construction acquires a scoped resource.

## Dependencies and composition

```typescript
class UserRepository extends Context.Tag("UserRepository")<UserRepository, {
  readonly findAll: () => Effect.Effect<ReadonlyArray<unknown>, Error>
}>() {}

const UserRepositoryLive = Layer.effect(
  UserRepository,
  Effect.gen(function*() {
    const database = yield* Database
    return {
      findAll: () => database.query("SELECT * FROM users")
    }
  })
)

const UserRepositoryWithDatabase = UserRepositoryLive.pipe(
  Layer.provide(DatabaseLive)
)

const program = Effect.gen(function*() {
  const repository = yield* UserRepository
  return yield* repository.findAll()
})

await Effect.runPromise(
  program.pipe(Effect.provide(UserRepositoryWithDatabase))
)
```

For required Layers, build dependencies bottom-up. Use `Layer.merge` for
independent outputs, `Layer.provide` to hide dependencies, and
`Layer.provideMerge` when callers also need the supplied services.

## Testing and lifecycle

```typescript
const result = await Effect.runPromise(
  getUsers.pipe(Effect.provide(DatabaseTest))
)
```

Reuse existing complete test Layers instead of mocking Effect internals or adding
parallel fixtures. Layers are memoized within one provision graph; use
`Layer.fresh` only when a current test requires the service to be rebuilt.
