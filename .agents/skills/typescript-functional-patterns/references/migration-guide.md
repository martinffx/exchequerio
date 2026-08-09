# Migrating functional patterns

Make the smallest change that fixes a current modeling defect. A migration is not
a reason to replace working schemas or introduce a parallel type layer.

## Establish ownership

1. Inspect package dependencies, compiler settings, schemas, generated types,
   public contracts, and immediate callers.
2. Identify the owner at each active boundary. Common owners include TypeBox,
   Drizzle, DynamoDB Toolbox, Effect Schema, installed functional libraries, and
   established plain TypeScript contracts.
3. Record the behavior callers observe before changing it.
4. Name the concrete invalid state, unsafe interchange, absence, or failure that
   motivates the work.

Do not begin with `domain/`, `option.ts`, `result.ts`, `brand.ts`, or `errors.ts`.
Reuse or improve the highest existing owner that can solve the problem.

## Choose the smallest change

Follow this order:

1. Use the existing inferred or generated type unchanged.
2. Compose or refine its schema.
3. Improve the canonical owner when it lacks a required distinction.
4. Add one custom type only if the skill's hard gate is satisfied.

Prefer a literal union before tagged objects. Replace related booleans with a
discriminated union only when the current shape permits invalid combinations.
Keep established nullable and failure contracts unless the task changes them.

## Map boundaries directly

An API request and a persistence record may have different shapes. Map directly
between their schema-derived types. Do not add a third universal model merely to
connect them.

Reuse a behavior-rich domain entity when it already owns business behavior. Do
not create an entity class solely to wrap a TypeBox value, Drizzle row, or
DynamoDB Toolbox item.

## Migration order

1. Add or update a focused test for the named defect.
2. Change the canonical schema or type in the smallest affected unit.
3. Adapt immediate callers without spreading a second representation.
4. Remove obsolete local adapters once no active consumer needs them.
5. Type-check and run the owning package's focused tests.

Preserve public APIs, persistence shapes, serialization, and error behavior unless
the task explicitly changes them. Avoid repository-wide adoption work, new lint
rules, and generic helper libraries.

## Review checklist

- The migration fixes a named current problem.
- Existing schema, library, generated, and project types were reused first.
- No unnecessary middle model or duplicate parser remains.
- Any custom type passes the hard gate and has one owner.
- Public and operational contracts remain stable unless explicitly changed.
