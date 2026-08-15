# Ledger Transactions implementation status

The Effect migration is complete. The authoritative implementation plan is
[`docs/specs/2026-08-14-transactions-effect/plan.json`](../../../../../docs/specs/2026-08-14-transactions-effect/plan.json).

| Task | Outcome | Status |
| --- | --- | --- |
| T1 | Transaction domain, Luxon timestamps, and typed failures | Complete |
| T2 | Four-counter Account projection and derived balances | Complete |
| T3 | Contracted Drizzle schema | Complete |
| T4 | Transactional legacy-data migration and regression | Complete |
| T5 | Managed Valkey idempotency repository | Complete |
| T6 | Tenant-scoped Effect repository reads | Complete |
| T7 | Atomic Pending and Posted creation | Complete |
| T8 | Atomic Pending replacement | Complete |
| T9 | Atomic post and void transitions | Complete |
| T10 | Effect orchestration, idempotency, and retries | Complete |
| T11 | TypeBox transport contract | Complete |
| T12 | Six direct Fastify routes and runtime composition | Complete |
| T13 | Settlement bridge to the Effect Transaction service | Complete |
| T14 | Legacy Transaction stack removal | Complete |
| T15 | Authenticated lifecycle, replay, balance, and tenancy journeys | Complete |
| T16 | Cross-instance Valkey idempotency proof | Complete |
| T17 | Current documentation and final repository verification | Complete |

Current behavior lives in [`spec.md`](./spec.md), and the implementation boundaries live in
[`design.md`](./design.md). Historical checklists, decimal Amount examples, Archived Transaction
state, Effective Time, and physical Transaction deletion no longer describe the API.
