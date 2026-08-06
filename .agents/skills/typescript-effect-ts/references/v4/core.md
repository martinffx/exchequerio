# Effect v4 core

Use this guide only after confirming the target package uses Effect v4.

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

Use `Effect.sync` for lazy synchronous work and `Effect.suspend` when creating the next Effect must itself be deferred. Use `Effect.die` only for defects, not expected failures.

## Nullable values, Option, and Result

In current v4 betas, `Effect.fromNullable` is replaced by `Option.fromNullishOr` followed by `Effect.fromOption`. `Result` replaces v3's `Either`.

```typescript
import { Effect, Option, Result } from "effect"

const maybeName: string | undefined = "Ada"
const name = Effect.fromOption(Option.fromNullishOr(maybeName))

const parsed = Result.try({
  try: () => JSON.parse("{}") as unknown,
  catch: (cause) => new SyntaxError(String(cause))
})

const parsedEffect = Result.isSuccess(parsed)
  ? Effect.succeed(parsed.success)
  : Effect.fail(parsed.failure)
```

Convert an Effect to a value-level result with `Effect.result`.

## Generators and composition

```typescript
import { Effect } from "effect"

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

## Yieldable is not Effect subtyping

Services, `Option`, and `Result` are yieldable in `Effect.gen`, but ordinary state and concurrency values are no longer Effect subtypes.

```typescript
import { Deferred, Effect, Fiber, Ref } from "effect"

const program = Effect.gen(function*() {
  const ref = yield* Ref.make(0)
  const value = yield* Ref.get(ref)

  const deferred = yield* Deferred.make<string>()
  yield* Deferred.succeed(deferred, "ready")
  const message = yield* Deferred.await(deferred)

  const fiber = yield* Effect.forkChild(Effect.succeed(value + 1))
  const result = yield* Fiber.join(fiber)

  return { message, result }
})
```

- `Ref`: use `Ref.get`, `Ref.set`, or `Ref.update`.
- `Deferred`: use `Deferred.await`.
- `Fiber`: use `Fiber.join` or another explicit Fiber operation.
- Use `.asEffect()` when an Effect combinator needs a yieldable value; inside `Effect.gen`, prefer `yield*`.

## Running and concurrency

```typescript
import { Effect } from "effect"

const tasks = [Effect.succeed(1), Effect.succeed(2), Effect.succeed(3)]

const sequential = Effect.all(tasks, { concurrency: 1 })
const bounded = Effect.all(tasks, { concurrency: 3 })
const unbounded = Effect.all(tasks, { concurrency: "unbounded" })

Effect.runSync(sequential)
await Effect.runPromise(bounded)
const fiber = Effect.runFork(unbounded)
```

Use `runSync` only for effects known to be synchronous and fully provided. Prefer `runPromiseExit` when callers need structured failure information instead of a rejected promise.

## v4 names to remember

| v3 | v4 |
| --- | --- |
| `Effect.fromNullable(value)` | `Effect.fromOption(Option.fromNullishOr(value))` |
| `Effect.fork(effect)` | `Effect.forkChild(effect)` |
| `Effect.forkDaemon(effect)` | `Effect.forkDetach(effect)` |
| implicit `yield* ref/deferred/fiber` | `Ref.get`, `Deferred.await`, `Fiber.join` |
| `Either` | `Result` |
