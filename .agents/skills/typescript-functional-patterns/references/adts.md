# Algebraic data types

Use algebraic data types only when they describe alternatives or combinations
that the owning schema and current project types do not already express clearly.

## Reuse the existing owner

A schema-defined union is already the canonical union. Infer its TypeScript type
instead of maintaining a handwritten copy.

```typescript
import { Static, Type } from "@sinclair/typebox"

const PaymentStateSchema = Type.Union([
  Type.Object({ kind: Type.Literal("pending") }),
  Type.Object({
    kind: Type.Literal("settled"),
    ledgerId: Type.String(),
  }),
])

type PaymentState = Static<typeof PaymentStateSchema>
```

Apply the same rule to Effect Schema, Zod, Valibot, generated API types, and any
other canonical schema system. For persistence models, keep Drizzle inferred
types and DynamoDB Toolbox `InputItem` or `FormattedItem` types at their owning
boundaries.

## Start with a literal union

When the alternatives differ only by name, use the smallest representation:

```typescript
type JobStatus = "queued" | "running" | "complete"
```

Do not replace these values with `{ kind: "queued" }` wrappers merely to make the
code look functional. Use an enum or schema literals when that is the package's
existing convention.

## When a discriminated union is justified

A discriminated union is useful when all of these statements are true:

1. The value has mutually exclusive variants.
2. At least one variant carries different data or behavior, or the current shape
   permits an invalid combination.
3. No existing schema or library union already owns the representation.
4. The changed code benefits from exhaustive narrowing.

For example, independent flags permit contradictory order states:

```typescript
type Order = {
  isPaid: boolean
  isCancelled: boolean
  trackingNumber?: string
}
```

If the task must prevent those contradictions, one union can own the state:

```typescript
type OrderState =
  | { kind: "pending" }
  | { kind: "paid"; paidAt: Date }
  | { kind: "shipped"; trackingNumber: string }
  | { kind: "cancelled"; reason: string }
```

This union is justified by the invalid combinations it removes. Do not apply the
same transformation to unrelated booleans that may vary independently.

## Existing tags are enough

Reuse discriminants already supplied by protocols and libraries. Examples include
an API schema's literal field, DynamoDB Toolbox's entity attribute, and an
installed functional library's tag. Do not add another tag with the same meaning.

Nested tags are appropriate only when the nested value is independently matched
in current behavior. Do not create a tagged error hierarchy when the existing
HTTP, schema, database, or effect error representation already distinguishes the
cases callers handle.

## Exhaustiveness

Use the project's existing matching convention. This may be a `switch`, a library
matcher, a `never` check, or an established helper. Do not add a new matching
library or global `assertNever` helper for one local union.

Add exhaustive handling where missing a variant would cause a defect. A simple
membership check or pass-through value does not need ceremonial pattern matching.

## Review checklist

- A literal union was considered before tagged objects.
- A canonical schema or library union was reused when present.
- Each custom variant represents different data, behavior, or a prevented invalid
  state.
- No duplicate tag, generic union helper, or parallel persisted model was added.
