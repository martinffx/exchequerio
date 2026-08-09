# Branded and opaque types

A brand adds a compile-time nominal distinction. It does not provide runtime
validation, and a validated value does not automatically need a brand.

## Keep schema-derived types canonical

Use the owning tool before considering a brand:

- Infer API types from TypeBox, Effect Schema, Zod, Valibot, or the package's
  current validation library.
- Infer SQL persistence types from Drizzle tables.
- Infer DynamoDB write and read shapes with DynamoDB Toolbox `InputItem` and
  `FormattedItem`.
- Reuse generated client types, database mappings, canonical identifiers, and
  existing refinements.

An email format, positive-number constraint, or identifier parser usually belongs
in the schema that validates the boundary. Do not add a branded copy merely to
repeat that validation elsewhere.

## Hard gate for a new brand

Add a brand only when all of these conditions hold:

1. Two values share a primitive representation but have a distinct unit or
   meaning.
2. Interchanging them can cause a concrete defect in the changed code.
3. The existing schema, installed library, and canonical project types cannot
   preserve the distinction.
4. One owner can validate or construct every branded value consistently.
5. The brand will not require parallel DTOs, row wrappers, item wrappers, casts,
   or duplicate test fixtures throughout the application.

If schema validation already makes the relevant operation safe, keep the inferred
schema type. If a Drizzle column or DynamoDB entity already owns the identifier,
improve that owner when the task requires a stronger distinction.

## Construction

Use the installed schema or branding facility when a brand passes the hard gate.
Keep construction at the owner and return the project's existing failure type.
Do not introduce a generic `Brand` module, scatter casts through application code,
or build another smart-constructor library.

Preserve existing wire and persistence representations unless the task changes
them. Reuse the owner's serializers, database mappings, fixtures, and generators.

## Review checklist

- The brand prevents a named interchange defect.
- No schema, library, or canonical type already provides the distinction.
- Runtime validation remains at the owning boundary.
- Construction has one owner and callers do not need routine adapters or casts.
