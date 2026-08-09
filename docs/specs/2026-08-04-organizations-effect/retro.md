# Retrospective: Organizations Effect migration

## What happened

Commits `2121abf` and `a0d25cb` implemented the SDD and its final review changes. Together, they
changed 114 files, added 7,014 lines, and deleted 3,671. The Organization slice grew to 25 files and
2,423 lines.

Seven cleanup commits followed. They reduced the slice to 13 files and 1,188 lines by removing
Redis rate limiting, current-Organization authorization, Organization-specific HTTP machinery,
custom Effect execution, a reusable API test harness, duplicate IDs and errors, and custom
PostgreSQL pool shutdown handling.

The SDD prescribed most of this machinery. Its design and plan totaled 1,043 lines, with 14 tasks,
78 test bullets, and 49 acceptance bullets.

## What went wrong

The SDD overloaded one resource migration. It combined the Effect migration with a Redis rollout,
a new authorization model, a new error stack, database ownership changes, a test-platform project,
an index migration, and a template for later resources. Most of this work did not serve the
migration.

Before examining the repository's existing code, the plan prescribed another Organization ID, new
parsing helpers, Organization-specific errors, special access types, a generic HTTP runner, and a
test harness. Existing code and framework behavior already covered much of this. The promise of
future reuse justified abstractions with one consumer.

The test plan mirrored the invented architecture. Every new layer produced more tests, including
tests for unnecessary wrappers and infrastructure. The slice contained 1,210 lines of test code
and 1,213 lines of production code. The volume followed the structure; it did not prove the
structure useful.

Final review measured compliance instead of necessity. It added lifecycle, migration,
documentation, boundary, and test work without challenging the design's size.

The implementation followed the SDD faithfully. The SDD specified the redundant code.

## What the cleanup showed

- `pool.end()` handled shutdown. The application did not need client tracking, forced release,
  timeouts, listener management, or tests for them.
- Explicit route handlers exposed request context, service lookup, error conversion, and reply
  handling better than a generic executor.
- Existing platform permissions served the existing Organization endpoints. Self-service
  permissions and per-actor Redis limiting needed their own user story.
- Shared errors, ID parsing, and the live database test Layer replaced a parallel error hierarchy
  and a premature full-stack test harness.
- Small repetitions at the HTTP boundary kept control flow visible. Focused tests let each active
  layer cover its own contract instead of replaying the CRUD matrix.

The cleanup retained the parts that solved current problems. The Organization service and
repository still return Effects, Layers still provide dependencies, PostgreSQL failures remain in
the typed error channel, and the server still owns one managed runtime.

## Rules for the next SDD

1. Start with the smallest behavior-preserving change. Give product changes separate user stories
   and approval.
2. Inventory existing types, helpers, errors, framework hooks, and test utilities before proposing
   replacements.
3. Wait for a second consumer before extracting shared infrastructure.
4. Prefer platform behavior and direct boundary code. Test observable behavior and one contract
   per active boundary.
5. Review for deletion before final approval. When the result differs from the design, update the
   SDD to record the result.

SDD should settle important decisions, not every possible detail. A decision-complete plan must
remain small.
