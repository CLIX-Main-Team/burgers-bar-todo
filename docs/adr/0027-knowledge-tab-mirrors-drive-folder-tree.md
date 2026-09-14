# The Knowledge tab mirrors the Drive folder tree, folders included

Status: accepted, supersedes 0024. Decided in two steps. On 2026-09-03 the owner moved the corpus
to a new Drive organized as one folder per department and asked for the LLM filing to go: "i want
it displayed correctly as how it looks in the drive". On 2026-09-10 the same tab was found to have
two gaps that shared one cause, and this record covers both steps because they are one decision:
the Knowledge tab shows the Drive folder tree, nothing else, and it does so from data about the
folders themselves rather than from the documents that happen to be inside them.

## Context

ADR-0024 filed every document into one of seven fixed shelves chosen by an LLM, because the corpus
at the time was ~38 files flat in one root and mirroring it would have mirrored the mess. That
reason went away with the new Drive: its folders are real filing decisions made by the departments
that own them, and a tab organized differently from the Drive people file into meant learning two
systems to find one document. #373 deleted the categorizer and replaced `knowledge_docs.category`
with `folder_name`, the top-level Drive folder a file's branch begins with (the value the sync
already resolved for classification, ADR-0023).

That shipped two gaps the client's own Drive then produced within days:

- **A folder holding nothing readable produced no tile.** The tab built its folder list by grouping
  the documents it had, so a folder somebody had just made, or one holding only photos, did not
  exist on the page. It read as broken rather than empty, and nothing on screen could say which
  kind of empty it was.
- **Nesting flattened.** `folder_name` was the branch's head, so a file in `דרייב ישן / כספים` was
  listed under `דרייב ישן`, and the one folder it could not be found in was the folder somebody had
  filed it in. The corpus now has exactly this shape, including two folders both named `כספים`
  at different depths, so a name cannot identify a folder at all.

## Decision

Folders are cached in their own right. A `knowledge_folders` table holds every folder under the
corpus root at any depth, keyed by Drive folder id, with its parent id and the number of non-folder
children Drive reports in it. A document points at the folder it is actually in
(`knowledge_docs.folder_id`, the immediate parent, null at the root), not at its branch's head. The
table is replaced wholesale on every walk of Drive, so a rename, a move and a delete are one write.

The Drive port carries a file's whole path, `folderPath: {id, name}[]` from the top level down,
because its two readers want different ends of it: classification (`document-metadata.ts`) still
files a document under the department its branch begins with (the head), so the access boundary
does not move when somebody makes a subfolder; the mirror shows where the file is (the tail). One
field so the two cannot disagree about the same file. `listFiles` becomes `listCorpus`, returning
folders and files from one walk, and `listFolders` returns only the tree for the incremental pass
that re-reads it after the changes feed reports something. Drive treats a folder as a file, so
creating an empty folder IS a change entry, which is what lets it be noticed at all; a quiet poll
still costs no folder walk.

The wire sends `folders[]` beside `docs[]`, and each doc carries `folderId`. The tab builds the
tree client-side: tiles are the subfolders of wherever you stand, the trail above is walkable at
every level, search inside a folder reaches its subfolders, and a tile's count is every document
beneath it. A folder with nothing in it is shown as a folder and says which kind of nothing: with
Drive's file count at zero it is empty and the copy says what to do about that in Drive; with files
Drive can see but the sync never ingests, the copy says the files are there and are not documents.

Migration 0043 adds the table, swaps the column, and deletes the sync cursor. The last step is the
trap 0042 documented: the incremental path visits a file only when Drive reports a change to it, so
without a full reload every cached row would keep a null folder until somebody edited that file.
The content hash keeps the reload from re-chunking or re-embedding unchanged text.

`folder_name` is not kept alongside `folder_id`: the name lives on the folder row, so a folder
renamed in Drive is one write instead of one per document, and a name that occurs twice in the
tree could never have identified anything.

## Consequences

- A folder exists on the tab the moment it exists in Drive, and an empty one is told apart from
  one full of photos. The app can no longer show a gap where a folder plainly is.
- Documents are found where they were filed, at any depth, and two folders sharing a name are two
  folders. Retrieval's department filter is unchanged.
- The department a nested document belongs to is still its top-level folder. A subfolder is not a
  new department, which is the posture the parked per-role folder scoping work will build on.
- The first boot after 0043 re-walks the whole corpus (70 files at the time), and while it runs the
  tab shows every document at the root. That is the load in progress, not a bug; it lasts about a
  minute.
- The folders table is not a foreign-key target for `knowledge_docs.folder_id`, deliberately: the
  sync writes folders and documents in separate passes over a Drive that changes underneath it,
  and a constraint would turn "the folder arrives next pass" into a failed sync. A dangling id
  renders at the root, where an unfiled document already goes.
- The root's loose files stay cards and a folder's files stay rows, as the owner approved on
  2026-09-03; now that a folder can contain folders, the two bands inside a folder are tiles over
  rows, which is Drive's own shape.
