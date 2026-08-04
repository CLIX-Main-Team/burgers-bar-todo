# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker. Each label string is currently equal to its canonical role name.

- `needs-triage` → `needs-triage` — maintainer needs to evaluate this issue.
- `needs-info` → `needs-info` — waiting on reporter for more information.
- `ready-for-agent` → `ready-for-agent` — fully specified, ready for an AFK agent.
- `ready-for-human` → `ready-for-human` — requires human implementation.
- `wontfix` → `wontfix` — will not be actioned.

One more label sits outside the triage roles — it marks execution state, not triage state:

- `in-progress` — a session is actively working this ticket. Applied by `scripts/wip.sh claim` (which
  swaps it in for `ready-for-agent`) and cleared by `release` or by the merged PR that closes the
  issue. The frontier query skips it. See `issue-tracker.md` → _Claiming a ticket across sessions_.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string on the right. If your tracker already uses different names, change the right-hand side of each mapping to match so `triage` reuses your existing labels instead of creating duplicates.
