# The knowledge corpus recurses into subfolders

Status: accepted — amends ADR-0021. Decided when the client's real corpus turned out to use
subfolders (a כספים folder of finance procedure docs) that ADR-0021's flat-only scoping silently
never ingested. Delivers the "subfolder recursion" line ADR-0021 deferred.

## Context

ADR-0021 scoped every Drive read to the corpus folder's direct children: `listFiles` queried the
one folder, and `listChanges` forwarded a change only when the corpus folder itself was a parent.
Flat only — a document inside a subfolder was invisible, silently.

The client organises the shared folder with subfolders and wants that structure kept. The interim
workaround — copying subfolder documents to the corpus root — duplicates files, goes stale the
moment the client edits an original, and puts copies the client never made into their folder. The
owner's requirement is the obvious one: if it is anywhere in the knowledge-base folder, the
assistant reads it.

## Decision

All still adapter-side (ADR-0021's posture is unchanged: the sync and its port never learn about
parents). Three changes inside `createGoogleDriveClient`:

1. **`listFiles` walks the corpus folder tree.** A breadth-first walk collects every descendant
   folder id (cycle-guarded), then lists each folder's non-folder children — documents at any
   depth, folders themselves never listed (they are containers; the sync would leave them uncached
   anyway). One paginated `files.list` per folder per pass, acceptable because the corpus is tens
   of files and a handful of folders.

2. **`listChanges` scopes against the folder tree, not the root alone.** A changed file is an
   upsert when any corpus-tree folder is among its parents (and it is live); everything else is
   still forwarded as a deletion. The tree is rebuilt lazily at most once per changes page — a
   quiet poll (zero changes) walks no folders at all — and never cached across polls, so a folder
   created moments before its files' changes arrive is already known.

3. **A folder-level change fans out to the files it silently carries.** Drive reports only the
   folder when one is dragged into the corpus, dragged out, or trashed; the files inside produce
   no change events of their own. So a folder change expands: still-in-tree ⇒ upserts for every
   document under it (a dragged-in folder arrives full); left-the-tree ⇒ removals for every
   document it took with it (listed with trashed included, because Drive v3 marks a trashed
   folder's children trashed by inheritance — a `trashed = false` query would hide exactly the
   files the cascade must forward). The folder id itself is forwarded as a removal — never a
   cached doc, so at most an idempotent no-op.

The adapter gains unit tests at the transport seam (`fetch` mocked, JWT stubbed) — the same
posture as `createHttpLlmClient`'s tests, and a step past ADR-0021's probe-only verification,
justified because scoping is now real logic (a tree walk and a fan-out) rather than one query
parameter.

## Consequences

- Client-facing: folder organisation inside the corpus is now free — documents are ingested at any
  depth, and a subfolder is no longer a "not for the bot" corner. Anything to exclude from the
  assistant must leave the corpus folder tree entirely. Everything ingested remains chain-wide
  answerable (ADR-0014's v1 posture; per-location tagging stays deferred).
- The root-copy workaround is retired: once this deploys, the copied documents at the corpus root
  are deleted and the originals ingest from the client's own subfolders.
- Sync cost per poll rises from zero folder queries to zero-on-quiet / one-tree-walk-when-changes —
  a handful of `files.list` calls at the current corpus size. The full load lists one query per
  folder instead of one total.
- A folder hard-deleted without passing through the trash cascades to nothing (its children cannot
  be listed after the fact). Drive's UI always trashes first — the trash event runs the cascade —
  so the gap is theoretical; a checkpoint clear remains the recovery lever.
- ADR-0021's deferred list shrinks: subfolder recursion is delivered; the resync endpoint, the
  `changes.watch` webhook, OCR, and per-location tagging remain open.
