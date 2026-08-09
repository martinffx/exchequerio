# Option and Result

Absence and failure do not require custom functional types. Preserve the owning
package's established contract unless the task explicitly changes it.

## Reuse the current contract

Inspect imports, public signatures, schema parsing, database calls, and immediate
callers. Existing representations may include:

- `undefined` or `null` for expected absence;
- exceptions or rejected promises;
- library `Option`, `Either`, `Result`, or `Effect` values;
- TypeBox, Effect Schema, or another validator's issue type;
- Drizzle and DynamoDB Toolbox errors handled by the data layer;
- a project-owned discriminated union or error type.

Keep that representation, including its constructors, parameter order, matching
style, and propagation behavior. Recoverable failure alone does not justify a new
`Result`, and expected absence alone does not justify a new `Option`.

## Use boundary-owned errors

Let validators report validation failures through their existing issue types.
Let data-access code follow the package's established mapping for Drizzle driver
errors, DynamoDB service errors, and DynamoDB Toolbox parsing or condition errors.
Let Effect code use its existing error channel.

Do not wrap these values in another tagged hierarchy merely to give each failure a
new name. Add a project error only when callers need a stable distinction that the
current boundary does not provide and the task changes that behavior.

## Hard gate for a new Option or Result

A new representation is justified only when all of these conditions hold:

1. The task requires absence or failure to become explicit data in the contract.
2. No installed library or canonical project type already models it.
3. Callers need to branch on the distinction in current behavior.
4. One boundary owns conversion from the underlying nullable, throwing, or
   promise-based API.
5. The change does not create a second propagation convention across the package.

If any condition fails, preserve the existing contract.

## Boundaries

Convert once at the owner when conversion is required. Keep HTTP, database, queue,
and public-library contracts unchanged unless the task explicitly changes them.
Avoid wrappers that only rename library constructors, issue objects, or errors.

## Review checklist

- The existing absence and failure contracts were identified first.
- Installed library and schema error types were reused.
- No generic Option, Result, constructor, matcher, or error hierarchy was added.
- New conversion occurs once at an owning boundary.
