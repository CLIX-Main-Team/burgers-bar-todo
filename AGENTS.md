## Documentation navigation

Every folder under `docs/` carries a `readme.md` index — a map of what the folder holds and where
to start. Read a folder's `readme.md` first, as the map, before opening its files one by one;
start from `docs/readme.md`, the top-level map of the whole tree. When you add or remove a document,
update its folder's `readme.md` in the same change so the map never drifts.

Project state (current phase, what is decided, what is open) lives in GitHub as wayfinder maps and
issues, not in an on-disk status or changelog. The `docs/` tree holds the durable records.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
