# Effect v3 Schema

Use this guide only after confirming the target package uses Effect v3.

## Define schemas and infer types

```typescript
import { Schema } from "effect"

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.NonEmptyString,
  email: Schema.String.pipe(Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  role: Schema.Literal("admin", "member"),
  createdAt: Schema.Date
})

type User = Schema.Schema.Type<typeof User>
type UserEncoded = Schema.Schema.Encoded<typeof User>
```

In v3, `Schema.Date` decodes a date string into a valid `Date`.

## Collections and optional fields

```typescript
const Identifier = Schema.Union(Schema.String, Schema.Number)
const Point = Schema.Tuple(Schema.Number, Schema.Number)
const Counters = Schema.Record({ key: Schema.String, value: Schema.Number })

const Config = Schema.Struct({
  host: Schema.String,
  port: Schema.optionalWith(Schema.Number, { default: () => 3000 }),
  note: Schema.optional(Schema.String)
})
```

## Decode and encode

```typescript
import { Either } from "effect"

const input: unknown = {
  id: "123",
  name: "Ada",
  email: "ada@example.com",
  role: "admin",
  createdAt: "2026-08-05T08:00:00.000Z"
}

const decodedSync = Schema.decodeUnknownSync(User)(input)
const decodedEffect = Schema.decodeUnknown(User)(input)
const decodedEither = Schema.decodeUnknownEither(User)(input)

if (Either.isLeft(decodedEither)) {
  console.error(decodedEither.left.message)
}

const encoded = Schema.encodeSync(User)(decodedSync)
```

Use Effect-based decoding when schemas have effectful requirements or failures must compose with an Effect workflow.

## Refinements and transformations

```typescript
const PositiveInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.positive()
)

const BooleanFromString = Schema.transform(
  Schema.Literal("on", "off"),
  Schema.Boolean,
  {
    strict: true,
    decode: (value) => value === "on",
    encode: (value) => value ? "on" : "off"
  }
)
```

Use `filter` or built-in refinements for validation, `brand` for domain identifiers, and `transform`/`transformOrFail` for encoded-to-domain conversions.

## Struct composition

```typescript
const Entity = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.Date
})

const NamedEntity = Schema.Struct({
  ...Entity.fields,
  name: Schema.String
})

const Summary = NamedEntity.pipe(Schema.pick("id", "name"))
const Patch = Schema.partial(NamedEntity)
```

Validate external input early, infer domain types from schemas, and encode only at output boundaries.
