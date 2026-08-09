# Migrating Effect v3 to v4

Effect v4 preserves the core model—`Effect`, `Layer`, `Schema`, `Stream`, typed errors, and scoped resources—but changes package organization and many APIs. Because v4 prereleases may differ, treat the installed package declarations and the official migration documents as authoritative.

## Migration workflow

1. Record the installed v3 versions and identify every `effect` and `@effect/*` import.
2. Upgrade `effect` and all remaining Effect ecosystem packages to the same v4 release.
3. Rewrite imports using the package and unstable-module maps.
4. Apply mechanical renames before structural migrations.
5. Migrate existing services and Layers, then errors/core APIs, Schema, and
   resource code. Do not introduce new service architecture as migration scope.
6. Type-check after each topic. Do not mix v3 and v4 forms to silence isolated errors.

## Package organization

Effect v4 releases the ecosystem under one shared version. Packages that remain separate—such as platform implementations, SQL drivers, AI providers, OpenTelemetry, atom bindings, and Vitest utilities—must match the `effect` version.

Many abstractions formerly published from `@effect/platform`, `@effect/rpc`, `@effect/cluster`, and related packages now live in `effect`. Evolving modules use `effect/unstable/*`; those paths may break in minor releases.

Consult:

- [Effect v4 release announcement](https://www.effect.website/blog/releases/effect/40-beta)
- [Official v3-to-v4 migration index](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
- [Generated import and API rename map](https://github.com/Effect-TS/effect/blob/main/migration/v3-to-v4.md)
- [Schema migration guide](https://github.com/Effect-TS/effect/blob/main/migration/schema.md)

## Core crosswalk

| v3 | v4 |
| --- | --- |
| `Either` and `Effect.either` | `Result` and `Effect.result` |
| `Effect.fromNullable(value)` | `Effect.fromOption(Option.fromNullishOr(value))` in current v4 betas |
| `Effect.catchAll` | `Effect.catch` |
| `Effect.catchAllCause` | `Effect.catchCause` |
| `Effect.catchSome` | `Effect.catchFilter` |
| `Effect.fork` | `Effect.forkChild` |
| `Effect.forkDaemon` | `Effect.forkDetach` |
| `Effect.timeoutFail` | `Effect.timeoutOrElse` |
| yielding `Ref`, `Deferred`, or `Fiber` directly | `Ref.get`, `Deferred.await`, or `Fiber.join` |

V4's `Yieldable` trait preserves `yield*` for Effect, Option, Result, Config, and services without making all of those values structural Effect subtypes.

## Services and layers

| v3 | v4 |
| --- | --- |
| `Context.GenericTag<T>(id)` | `Context.Service<T>(id)` |
| `Context.Tag(id)<Self, Shape>()` | `Context.Service<Self, Shape>()(id)` |
| `Effect.Tag` accessors | `Context.Service`; prefer `yield*`, optionally `use` |
| `Effect.Service` with generated `.Default` | `Context.Service` with `make` plus an explicit `Layer.effect` |
| `dependencies` option | Explicit `Layer.provide` composition |
| `Layer.scoped` | `Layer.effect` |

V4 shares layer memoization across `Effect.provide` calls. Continue composing layers before providing them; use `Layer.fresh` or `{ local: true }` only when rebuilding is intentional.

## Schema crosswalk

| v3 | v4 |
| --- | --- |
| `Schema.Schema.Type<typeof S>` | `typeof S.Type` |
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])` |
| `Schema.Union(A, B)` | `Schema.Union([A, B])` |
| `Schema.Tuple(A, B)` | `Schema.Tuple([A, B])` |
| `Schema.Record({ key, value })` | `Schema.Record(key, value)` |
| `Schema.Date` for strings | `Schema.DateFromString` |
| `Schema.decodeUnknown` | `Schema.decodeUnknownEffect` |
| `Schema.decodeUnknownEither` | `Schema.decodeUnknownExit` |
| `Schema.filter` | `check(makeFilter(...))` or `refine(...)` |
| `Schema.pick` / `omit` / `partial` | Struct field mapping operations |
| `Schema.transform` | `Schema.decodeTo` with a transformation |

Optional-field and effectful-transformation migrations depend on their exact v3 options. Use the official Schema migration guide rather than guessing a mechanical replacement.

## Scope

`Scope.extend` is renamed to `Scope.provide`. `acquireRelease`, `acquireUseRelease`, and `Effect.scoped` remain the central resource patterns; update resource-owning layers from `Layer.scoped` to `Layer.effect`.

## Completion checks

- The application type-checks without compatibility casts added only to suppress migration errors.
- No v3-only imports or API names remain in migrated packages.
- All Effect ecosystem package versions match.
- Every `effect/unstable/*` import is intentional and verified against the installed version.
- Resource finalization and service-layer tests still cover interruption and failure paths.
