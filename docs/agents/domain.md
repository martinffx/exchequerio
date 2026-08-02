# Domain Documentation

## Layout

- **Mode:** Single-context
- **Context document:** `CONTEXT.md`
- **Context map:** Not used
- **System ADRs:** `docs/adr/`
- **Context ADRs:** Not used

## Before Domain Work

1. Read root `CONTEXT.md` when it exists.
2. Read ADRs in `docs/adr/` that are relevant to the work.
3. Proceed silently when these documents do not yet exist.

## Ownership

- `CONTEXT.md` records domain language, distinctions, and business invariants for the Exchequer
  ledger domain.
- ADRs record architectural decisions and trade-offs.
- This file only tells agents how to locate and consume those documents.

## Creation

Domain documents remain lazy. Do not create `CONTEXT.md` or `docs/adr/` until a domain-modelling
or architectural-decision task has substantive terminology or a decision worth recording.
