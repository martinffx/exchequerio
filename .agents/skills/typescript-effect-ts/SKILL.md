---
name: typescript-effect-ts
description: Build, review, or migrate TypeScript applications using Effect v3 or v4. Use whenever code imports from effect or @effect/*, or when working with Effect.gen, typed errors, Result or Either, Context services, Layer dependency injection, Schema validation, fibers, concurrency, Scope, or acquireRelease. Resolve the installed Effect major before suggesting APIs so v3 and v4 syntax are never mixed.
user-invocable: false
---

# Effect for TypeScript

Effect v3 and v4 share the same programming model but differ in important API names and shapes. Resolve the project's version before writing or reviewing code.

## Resolve the version first

1. Read the nearest `package.json` that owns the target source file.
2. Inspect its `effect` dependency and any `@effect/*` packages. Use the lockfile when a workspace range, alias, prerelease tag, or indirect dependency makes the resolved major unclear.
3. In a monorepo, resolve the version separately for each package. Do not assume the root version applies everywhere.
4. Route major version 3 to `references/v3/` and major version 4 or later to `references/v4/`.
5. If no version can be discovered and the user did not name one, ask which major to target.

The installed package and its declarations are authoritative. This matters especially for prereleases, whose APIs can change between releases.

## Load only the relevant references

After resolving the major, read the matching topic guide:

| Topic | Effect v3 | Effect v4+ |
| --- | --- | --- |
| Core effects, generators, fibers, concurrency | [v3 core](./references/v3/core.md) | [v4 core](./references/v4/core.md) |
| Typed errors, recovery, retry, timeout | [v3 errors](./references/v3/error-handling.md) | [v4 errors](./references/v4/error-handling.md) |
| Services, dependency injection, layers | [v3 services](./references/v3/services.md) | [v4 services](./references/v4/services.md) |
| Schema, decoding, encoding, validation | [v3 Schema](./references/v3/schema.md) | [v4 Schema](./references/v4/schema.md) |
| Scope and resource safety | [v3 resources](./references/v3/resources.md) | [v4 resources](./references/v4/resources.md) |

For an upgrade from v3 to v4, first read [the migration guide](./references/v3-to-v4.md), then load the affected v4 topic guides.

## Shared principles

- Keep `Effect<A, E, R>` lazy and run it only at application boundaries.
- Model expected failures in `E`; reserve defects for broken invariants and unrecoverable faults.
- Validate untrusted data at system boundaries with Schema.
- Express dependencies as services and assemble implementations with layers.
- Scope every resource whose acquisition has a release action.
- Use structured concurrency and explicit concurrency limits.
- Prefer `Effect.gen` for sequential workflows and `pipe` for focused transformations.

## Version guardrails

- Do not copy a symbol from the other version because its name looks familiar.
- Do not upgrade package versions unless the user asked for a migration.
- On v4, check that all Effect ecosystem packages use the same release version.
- Treat `effect/unstable/*` as allowed to break in minor releases; verify its API against the installed package.
- When examples and installed declarations disagree, follow the declarations and explain the version-specific difference.
