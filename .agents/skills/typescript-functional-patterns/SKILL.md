---
name: typescript-functional-patterns
description: Selective use of functional TypeScript patterns. Use when a task explicitly involves an existing state machine or discriminated union, an Option/Result/Either/Effect API, a branded or opaque type, or deciding whether one is warranted. Do not use for ordinary validation or domain modeling that existing schemas and types already cover.
user-invocable: false
---

# Selective functional patterns

Functional patterns solve specific modeling defects. They are not a default
architecture or an extra layer to place around working project types.

## Start with the owning boundary

Follow this order and stop at the first step that satisfies the task:

1. Reuse the owning boundary's existing schema, generated type, library type, or
   public contract.
2. Infer types with the installed tool's supported utilities.
3. Compose, refine, or extend the canonical schema or type.
4. Improve the representation at its owner when the task exposes a real gap.
5. Introduce one minimal custom type only when the hard gate below is satisfied.

Do not continue down the list once the existing representation can express the
requirement safely.

### Canonical owners

- TypeBox schemas own their request and response shapes. Use
  `Static<typeof Schema>` and TypeBox composition rather than handwritten mirrors.
- Drizzle tables own their persistence shapes. Use `typeof table.$inferSelect`,
  `typeof table.$inferInsert`, or the inference convention already used by the
  package.
- DynamoDB Toolbox entities own their item shapes. Use `InputItem<typeof Entity>`,
  `FormattedItem<typeof Entity>`, and the entity's item schema.
- Effect Schema and other installed schema libraries own their inferred types,
  refinements, parse errors, and tagged schemas.
- Installed functional libraries own their `Option`, `Result`, `Either`, and
  effect types, constructors, and matching conventions.
- Existing nullable, throwing, promise-based, generated, and plain TypeScript
  contracts remain canonical when the project already uses them.

## Do not add a middle model

Do not place a handwritten tagged, branded, or class-based model between an API
schema and a persistence schema merely to rename fields or repeat validation.
Convert directly between the two boundary-owned shapes.

Different boundaries may legitimately have different types. A TypeBox request,
a Drizzle row, and a DynamoDB item do not need a third universal domain type to
connect them. Reuse an existing behavior-rich domain entity when the package
already has one, but do not create an entity class solely to wrap a row or item.

## Hard gate for a custom type

Add a custom tagged union, brand, opaque type, `Option`, or `Result` only when all
of these conditions hold:

1. The changed code contains a concrete defect, invalid state, or unsafe
   interchange that the type should prevent.
2. The owning schema, installed library, and current project types cannot express
   the distinction through composition, refinement, literals, constraints, or
   their native error model.
3. The new type prevents the defect instead of restating validation or giving an
   existing value another name.
4. One boundary can own construction and validation consistently.
5. The type does not introduce routine adapters, duplicate serializers, or a
   second representation across callers, persistence, and tests.

If any condition fails, keep the existing representation.

## Choose the smallest representation

- Use a literal union such as `"pending" | "settled"` before wrapping each value
  in a tagged object.
- Use a discriminated union when variants carry different data or when it removes
  a demonstrated invalid combination of fields.
- Use a brand only when values with the same primitive representation remain easy
  to confuse after applying the existing schema and library tools.
- Use the established nullable or failure contract before considering `Option` or
  `Result`.
- Keep runtime validation in the owning schema. A custom compile-time type must
  not replace boundary validation.

Validation, nullability, recoverable failure, identifiers, and domain terminology
do not by themselves justify a custom type.

## Working method

1. Inspect imports, package dependencies, schemas, generated types, public
   contracts, and immediate callers.
2. Name the specific unsafe state or operation required by the task.
3. Reuse or extend the highest existing owner that can prevent it.
4. Keep conversions at active boundaries and preserve public behavior unless the
   task explicitly changes it.
5. Test the changed behavior using the package's existing test utilities.

## References

Read only the reference needed for the active problem:

- [ADTs](./references/adts.md) for deciding between literal and discriminated
  unions
- [Option and Result](./references/option-result.md) for absence and failure
  contracts
- [Branded types](./references/branded-types.md) for nominal distinctions and
  units
- [Migration guide](./references/migration-guide.md) for a focused change to an
  existing codebase

## Review checklist

- The owning schema, library, or project type was identified first.
- Schema-derived and generated types remain canonical at their boundaries.
- No unnecessary middle model or generic functional helper was added.
- Every new custom type passes the hard gate.
- The change fixes the named problem without spreading a second representation.
