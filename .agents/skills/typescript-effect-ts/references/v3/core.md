# Effect v3 core concepts

Use this guide only after confirming the target package uses Effect v3.

## The Effect type

`Effect.Effect<A, E, R>` describes a lazy computation that succeeds with `A`, may fail with `E`, and requires services `R`.

```typescript
import { Effect } from "effect"

const value: Effect.Effect<number> = Effect.succeed(42)

const parsed: Effect.Effect<unknown, SyntaxError> = Effect.try({
  try: () => JSON.parse("{}"),
  catch: (cause) => new SyntaxError(String(cause))
})

const fetched: Effect.Effect<Response, Error> = Effect.tryPromise({
  try: () => fetch("https://example.com"),
  catch: (cause) => new Error("Request failed", { cause })
})
```

`Effect.promise` has no expected error channel; a rejected promise becomes a defect. Use `tryPromise` when rejection is expected and should be typed.

## Generators and composition

```typescript
declare const fetchUser: (id: string) => Effect.Effect<{ id: string }, Error>
declare const fetchPosts: (userId: string) => Effect.Effect<ReadonlyArray<string>, Error>

const program = Effect.gen(function*() {
  const user = yield* fetchUser("123")
  const posts = yield* fetchPosts(user.id)
  return { user, posts }
})

const count = program.pipe(Effect.map(({ posts }) => posts.length))
```

Use generators for sequential control flow. Use `map`, `flatMap`, `tap`, and `mapError` for short transformations.

## Option and Either

```typescript
import { Either, Option } from "effect"

const optional = Option.fromNullable("Ada" as string | undefined)

const either = Either.try({
  try: () => JSON.parse("{}") as unknown,
  catch: (cause) => new SyntaxError(String(cause))
})

const lifted = Effect.gen(function*() {
  const name = yield* optional
  const value = yield* either
  return { name, value }
})
```

In v3, `Option`, `Either`, services, `Ref`, `Deferred`, and `Fiber` are Effect subtypes and can be yielded directly. Prefer explicit module operations when they make intent clearer.

## Fibers and concurrency

```typescript
import { Fiber, Ref } from "effect"

const concurrent = Effect.gen(function*() {
  const ref = yield* Ref.make(0)
  yield* Ref.update(ref, (value) => value + 1)
  const value = yield* Ref.get(ref)

  const fiber = yield* Effect.fork(Effect.succeed(value + 1))
  const result = yield* Fiber.join(fiber)
  return result
})

const tasks = [Effect.succeed(1), Effect.succeed(2), Effect.succeed(3)]
const bounded = Effect.all(tasks, { concurrency: 3 })
```

Use `Effect.fork` for a structured child fiber and `Effect.forkDaemon` only when detached lifetime is intentional. Set an explicit concurrency bound for external systems.

## Running Effects

```typescript
Effect.runSync(Effect.succeed(42))
await Effect.runPromise(bounded)
const exit = await Effect.runPromiseExit(program)
const fiber = Effect.runFork(program)
```

Run Effects at application boundaries. Use `runSync` only for Effects known to be synchronous and fully provided.
