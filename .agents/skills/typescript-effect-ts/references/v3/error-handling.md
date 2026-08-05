# Effect v3 error handling

Use this guide only after confirming the target package uses Effect v3.

## Tagged expected errors

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

Expected failures belong in the error channel. Defects represent broken invariants or unrecoverable faults and are not handled by ordinary error recovery.

## Recovery

```typescript
const recovered = getUser("123").pipe(
  Effect.catchTag("UserNotFound", ({ userId }) =>
    Effect.succeed({ id: userId, name: "Anonymous" })
  ),
  Effect.catchAll((error) =>
    Effect.logError("Database lookup failed", error).pipe(
      Effect.as({ id: "unknown", name: "Unavailable" })
    )
  )
)
```

- `catchAll` handles the remaining expected error channel.
- `catchTag` and `catchTags` handle tagged errors precisely.
- `catchSome` performs conditional recovery with `Option`.
- `mapError` transforms an error without recovering.
- `orElse` runs a fallback Effect.

Use `catchAllCause` only when infrastructure code genuinely needs the complete cause, including defects and interruption.

## Either, Exit, and Cause

```typescript
import { Cause, Either, Exit } from "effect"

const asEither = getUser("123").pipe(Effect.either)
const message = asEither.pipe(
  Effect.map((result) =>
    Either.match(result, {
      onLeft: (error) => `failed: ${error._tag}`,
      onRight: (user) => `found: ${user.name}`
    })
  )
)

const exit = await Effect.runPromiseExit(getUser("123"))
if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause))
}
```

Use `Either` when expected failure should become ordinary data. Use `Exit` for the complete outcome and `Cause` for diagnostics.

## Retry and timeout

```typescript
import { Duration, Schedule } from "effect"

const retried = getUser("123").pipe(
  Effect.retry(
    Schedule.exponential("100 millis").pipe(
      Schedule.jittered,
      Schedule.compose(Schedule.recurs(4))
    )
  )
)

const timed = retried.pipe(Effect.timeout(Duration.seconds(5)))
```

Retry only transient failures. Narrow or filter the error channel first when permanent failures are also possible.
