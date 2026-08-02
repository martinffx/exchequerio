# Issue Tracker

## Tracker

- **Provider:** Beads
- **Location:** Repository-local `.beads/`
- **Tool or procedure:** Run the `bd` CLI from the repository root
- **Mirror Spec-backed tasks:** Yes, when tracking adds execution value

## Authority

`plan.json` is the source of truth for Spec-backed task descriptions, dependencies, and
validation. Beads entries mirror execution state and dependencies when mirroring is enabled.

## Operations

- **Create:** Use `bd create "<title>" --type task --spec-id <spec-path>`. Use an epic as the
  feature container when multiple related tasks benefit from grouping.
- **Read:** Use `bd ready`, `bd list`, `bd show <id>`, and `bd blocked`.
- **Update:** Start work with `bd update <id> --status in_progress`; record useful progress with
  `bd update <id> --append-notes "<note>"`.
- **Complete:** Use `bd close <id> --reason "<reason>"`.
- **Dependencies:** Use `bd dep <blocker-id> --blocks <blocked-id>` to mirror `depends_on`
  relationships from `plan.json`.

## Status Mapping

| Plan state | Beads state |
|------------|-------------|
| Ready | `open` with no active blockers |
| In progress | `in_progress` |
| Blocked | `open` with an active blocking dependency |
| Complete | `closed` |

## Constraints

- The repository does not currently contain a Beads database. Initializing or restoring
  `.beads/` is a separate developer action; agents must not initialize it automatically.
- Mirror only Spec-backed tasks for which Beads adds execution value. Do not duplicate a simple
  `plan.json` merely to satisfy the workflow.
- Keep task descriptions, validation, and dependency definitions authoritative in `plan.json`.
- Do not store credentials, tokens, or other secrets in this document.
