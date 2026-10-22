# AGENTS.md

Working rules for anyone who changes this repository, a person or an agent. `CLAUDE.md` imports
this file, so Claude Code reads it at the start of every session.

## Start here

`START-HERE.md` at the repo root is the handover document: what the app does, every account and
what it is for, the keys file, how to run the app on this computer, how a change reaches the
server, the phone app, the known gaps and the first-session checklist. Read it before anything
else; when it and an older document disagree, trust the code and START-HERE.md.

## Documentation navigation

Every folder under `docs/` carries a `readme.md` index, a map of what the folder holds and where
to start. Read a folder's `readme.md` first, before opening its files one by one; start from
`docs/readme.md`, the map of the whole tree. When you add or remove a document, update its
folder's `readme.md` in the same change so the map never drifts.

Project state (what is decided, what is open) lives in GitHub issues; the `docs/` tree holds the
durable records: the PRD, the engineering design, the ADRs, the feature documents and the specs.

## Making a change

- Branch from `origin/main`. One change, one branch, one pull request.
- Before pushing: `npm run typecheck`, `npx biome ci .`, `npm test` (the API suite needs Docker
  Desktop running). CI runs the same gates on the pull request.
- Documentation is code: a change that alters behaviour updates the documents that describe it
  in the same pull request.
- A merge to `main` goes live within minutes (CI, then Deploy). Merge only with the owner's yes.
  Never push to `main` directly.
- Migrations are hand-written SQL files with a journal entry; never edit an applied one and never
  `drizzle-kit push` (the rules are in START-HERE.md, section 6).

## Secrets

`.env` and the server's `.env.prod` are never committed, and no secret value is ever printed or
pasted into a chat, an issue or a commit. START-HERE.md, section 4, says which lines are secret.
Variable names may be listed; values never.
