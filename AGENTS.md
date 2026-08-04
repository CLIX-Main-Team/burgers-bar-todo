## Documentation navigation

Every folder under `docs/` carries a `readme.md` index — a map of what the folder holds and where
to start. Read a folder's `readme.md` first, as the map, before opening its files one by one;
start from `docs/readme.md`, the top-level map of the whole tree. When you add or remove a document,
update its folder's `readme.md` in the same change so the map never drifts.

Project state (current phase, what is decided, what is open) lives in GitHub as wayfinder maps and
issues, not in an on-disk status or changelog. The `docs/` tree holds the durable records.

## Worktree isolation

Any change to a tracked file happens in an isolated git worktree under `.claude/worktrees/`, never
in the primary working directory — code and documentation alike, since documentation is code here.
The primary checkout stays clean and on a known-good branch, and parallel work proceeds in separate
worktrees without stepping on each other. Read-only work — exploration, diagnosis, answering a
question — stays in place; the rule governs edits, not reads.

This is a convention the agent applies itself: read this file at the start of a session, and before
the first edit of any change-work, enter a worktree. There is no hook enforcing it.

One worktree maps to one feature branch, which maps to one pull request, named for the ticket or
feature it delivers. A worktree branches fresh from `origin/main`, so parallel features stay
independent and none inherits another's half-done work; a feature that depends on unmerged work
waits for that work to merge before it starts. The worktree lives from the first edit until its pull
request merges — kept across sessions, so a multi-session feature keeps its tree (choose keep on
exit, re-enter it by path next session) — and is removed once the pull request is merged.

Because a worktree branches fresh from `origin/main`, it does not contain unmerged work sitting on
another branch. And a long-lived worktree can drift as `origin/main` moves under it; rebase onto
`origin/main` when that drift starts to bite.

## Claiming tickets across sessions

Several sessions run against this repo at once, all as the same GitHub account, so a session can't
see what another is working on unless the claim is recorded on GitHub. Before picking up a ticket,
check what's in flight with `make board` (or `scripts/wip.sh board`); claim it with
`make claim n=<issue>` before your first edit. The claim is atomic, refuses a ticket another session
already holds, and marks the issue `in-progress` so it leaves everyone's frontier. Like worktree
isolation, this is a convention the agent applies itself — read this file at the start of a session
and claim before you work. The full protocol lives in `docs/agents/issue-tracker.md`.

## Operating instructions

How the engineering agents in this repo work — tracking issues and PRDs, triaging incoming work,
and consuming the domain docs — lives in `docs/agents/`. Start from `docs/agents/readme.md`, the
map for that folder, and open only the file the task in front of you needs. Following the same
navigation rule above keeps AGENTS.md a pointer, not a second copy that drifts from the map.
