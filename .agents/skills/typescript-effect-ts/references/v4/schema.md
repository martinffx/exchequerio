# Effect v4 Schema

Use this guide only after confirming the target package uses Effect v4. Schema changed substantially from v3; verify unfamiliar APIs against the installed declarations.

## Define schemas and infer types

```typescript
import { Schema } from "effect"

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String.check(Schema.isNonEmpty()),
  email: Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  role: Schema.Literals(["admin", "member"]),
  createdAt: Schema.DateFromString
})

type User = typeof User.Type
type UserEncoded = typeof User.Encoded
```

`Schema.Date` accepts a `Date` value in v4. Use `Schema.DateFromString` when the encoded input is a date string.

## Collections, unions, and optional fields

```typescript
import { Effect, Schema } from "effect"

const Identifier = Schema.Union([Schema.String, Schema.Number])
const Point = Schema.Tuple([Schema.Number, Schema.Number])
const Counters = Schema.Record(Schema.String, Schema.Number)

const Config = Schema.Struct({
  host: Schema.String,
  port: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
    Schema.withDecodingDefaultTypeKey(Effect.succeed(3000))
  ),
  note: Schema.optionalKey(Schema.String),
  label: Schema.optional(Schema.String)
})
```

- `optionalKey` models an exact optional property.
- `optional` allows a missing property and `undefined`.
- Decoding defaults are Effects in v4; use `withDecodingDefaultTypeKey` for an optional key with a default.

## Decode and encode

```typescript
const input: unknown = {
  id: "123",
  name: "Ada",
  email: "ada@example.com",
  role: "admin",
  createdAt: "2026-08-05T08:00:00.000Z"
}

const decodedSync = Schema.decodeUnknownSync(User)(input)
const decodedEffect = Schema.decodeUnknownEffect(User)(input)
const decodedExit = Schema.decodeUnknownExit(User)(input)

const encodedSync = Schema.encodeSync(User)(decodedSync)
const encodedEffect = Schema.encodeEffect(User)(decodedSync)
```

Use synchronous operations only for schemas without asynchronous requirements. Use `SchemaIssue` formatters when validation errors must be rendered for users or protocols.

## Checks and refinements

```typescript
const Even = Schema.Number.check(
  Schema.makeFilter((value) => value % 2 === 0 || "Expected an even number")
)

const PositiveInteger = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.makeFilter((value) => value > 0 || "Expected a positive number"))
)
```

Use `check` with Schema checks for validation. Use `refine` when a predicate narrows the TypeScript type.

## Compose structs

```typescript
import { Struct } from "effect"

const Entity = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.DateFromString
})

const NamedEntity = Entity.pipe(Schema.fieldsAssign({ name: Schema.String }))
const Summary = NamedEntity.mapFields(Struct.pick(["id", "name"]))
const WithoutDates = NamedEntity.mapFields(Struct.omit(["createdAt"]))
const Patch = NamedEntity.mapFields(Struct.map(Schema.optionalKey))
```

## Transformations

```typescript
import { SchemaTransformation } from "effect"

const BooleanFromString = Schema.Literals(["on", "off"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) => value === "on",
      encode: (value) => value ? "on" : "off"
    })
  )
)
```

Use `decodeTo` for bidirectional transformations. Use `SchemaGetter.transformOrFail` when decoding or encoding may fail effectfully.

## v4 names to remember

| v3 | v4 |
| --- | --- |
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])` |
| `Schema.Union(A, B)` | `Schema.Union([A, B])` |
| `Schema.Tuple(A, B)` | `Schema.Tuple([A, B])` |
| `Schema.Record({ key, value })` | `Schema.Record(key, value)` |
| `Schema.decodeUnknown` | `Schema.decodeUnknownEffect` |
| `Schema.decodeUnknownEither` | `Schema.decodeUnknownExit` |
| `Schema.filter(...)` | `check(makeFilter(...))` or `refine(...)` |
| `Schema.Schema.Type<typeof S>` | `typeof S.Type` |
