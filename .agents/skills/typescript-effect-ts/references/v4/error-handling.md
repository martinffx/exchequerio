# Effect v4 error handling

Use this guide only after confirming the target package uses Effect v4.

## Model expected errors as tagged values

```typescript
import { Data, Effect } from "effect"

class UserNotFound extends Data.TaggedError("UserNotFound")<{
  readonly userId: string
}> {}

class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown
}> {}

declare const lookup: (
  id: string
) => Effect.Effect<{ id: string; name: string } | undefined, DatabaseError>

const getUser = (id: string) =>
  Effect.gen(function*() {
    const user = yield* lookup(id)
    if (user === undefined) {
      return yield* new UserNotFound({ userId: id })
    }
    return user
  })
```

Tagged errors work with `Effect.catchTag` and preserve useful data. Use `Schema.TaggedErrorClass` instead when an error also needs schema-backed encoding or decoding.

## Recover from expected failures

```typescript
import { Effect } from "effect"

const recovered = getUser("123").pipe(
  Effect.catchTag("UserNotFound", ({ userId }) =>
    Effect.succeed({ id: userId, name: "Anonymous" })
  ),
  Effect.catch((error) =>
    Effect.logError("Database lookup failed", error).pipe(
      Effect.andThen(Effect.succeed({ id: "unknown", name: "Unavailable" }))
    )
  )
)
```

- `Effect.catch` handles the remaining expected error channel.
- `Effect.catchTag` and `Effect.catchTags` handle tagged cases precisely.
- `Effect.catchFilter` replaces v3's `catchSome` for conditional recovery.
- `Effect.mapError` changes the error type without recovery.
- `Effect.orElse` runs a fallback Effect and replaces the original error channel.

Do not use broad recovery to hide defects. Use `Effect.catchCause` only when the full failure cause, including interruption and defects, is genuinely required.

## Result, Exit, and Cause

```typescript
import { Cause, Effect, Exit, Result } from "effect"

const asResult = getUser("123").pipe(Effect.result)

const reportResult = asResult.pipe(
  Effect.map((result) =>
    Result.match(result, {
      onFailure: (error) => `failed: ${error._tag}`,
      onSuccess: (user) => `found: ${user.name}`
    })
  )
)

const exit = await Effect.runPromiseExit(getUser("123"))
if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause))
}
```

Use `Result` when failure should become ordinary data. Use `Exit` when callers need the complete outcome, and `Cause` for diagnostics or infrastructure-level handling.

## Retry and timeout

```typescript
import { Duration, Effect, Schedule } from "effect"

const retried = getUser("123").pipe(
  Effect.retry(
    Schedule.exponential("100 millis").pipe(
      Schedule.jittered,
      Schedule.compose(Schedule.recurs(4))
    )
  )
)

class RequestTimeout extends Error {
  readonly _tag = "RequestTimeout"
}

const timed = retried.pipe(
  Effect.timeoutOrElse({
    duration: Duration.seconds(5),
    orElse: () => Effect.fail(new RequestTimeout())
  })
)
```

Retry only transient failures. Filter or narrow the error channel before retrying when permanent failures are also possible.

## v4 names to remember

| v3 | v4 |
| --- | --- |
| `Effect.catchAll` | `Effect.catch` |
| `Effect.catchAllCause` | `Effect.catchCause` |
| `Effect.catchSome` | `Effect.catchFilter` |
| `Effect.either` / `Either` | `Effect.result` / `Result` |
| `Effect.timeoutFail` | `Effect.timeoutOrElse` |
