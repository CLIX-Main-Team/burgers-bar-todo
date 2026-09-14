import type { KnowledgeDocSummary, KnowledgeFolderSummary } from '@burgers/shared'

// The corpus folder tree, indexed for the four questions the Knowledge tab asks of it. The API
// sends folders and documents as two flat lists — the folders are their own rows now, so a folder
// exists whether or not anything readable is inside it — and this is where they become a tree.
//
// Built once per render of the loaded screen and read many times, so every lookup below is a Map
// hit rather than a scan of the corpus.

export interface FolderTree {
  /** A folder by id, or undefined for an id whose folder is no longer in Drive. */
  get(folderId: string): KnowledgeFolderSummary | undefined
  /** The subfolders sitting directly in a folder, or at the corpus root when null. */
  childrenOf(parentId: string | null): KnowledgeFolderSummary[]
  /** The documents filed directly in a folder, or loose at the corpus root when null. */
  filesIn(folderId: string | null): KnowledgeDocSummary[]
  /**
   * The documents filed in a folder or anywhere beneath it. What a tile counts and what a search
   * inside a folder looks through: a file in "מוקד / 2026" is one of מוקד's documents to anybody
   * standing in מוקד, and a tile reading "0 documents" over a full subfolder would be a lie.
   */
  descendantsOf(folderId: string): KnowledgeDocSummary[]
  /** The trail from the corpus root down to a folder, that folder last. Empty for an unknown id. */
  pathTo(folderId: string): KnowledgeFolderSummary[]
}

export function buildFolderTree(
  folders: KnowledgeFolderSummary[],
  docs: KnowledgeDocSummary[],
  locale: string,
): FolderTree {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))

  // Name order, not the "recently modified" Drive itself defaults to. A wall of tiles is navigated
  // by muscle memory, and folders that reshuffle whenever somebody edits a file inside one defeat
  // that; the documents underneath keep the recency sort, where it is the useful axis.
  const children = new Map<string | null, KnowledgeFolderSummary[]>()
  for (const folder of [...folders].sort((a, b) => a.name.localeCompare(b.name, locale))) {
    const bucket = children.get(folder.parentId)
    if (bucket) {
      bucket.push(folder)
    } else {
      children.set(folder.parentId, [folder])
    }
  }

  const filed = new Map<string | null, KnowledgeDocSummary[]>()
  for (const doc of docs) {
    // A document whose folder is not in the tree renders at the root. It is the same place an
    // unfiled document already goes, and it can only be reached by a document written between two
    // passes of a sync that has since moved on, so it corrects itself.
    const key = doc.folderId !== null && byId.has(doc.folderId) ? doc.folderId : null
    const bucket = filed.get(key)
    if (bucket) {
      bucket.push(doc)
    } else {
      filed.set(key, [doc])
    }
  }

  const descendants = new Map<string, KnowledgeDocSummary[]>()
  const collect = (folderId: string): KnowledgeDocSummary[] => {
    const cached = descendants.get(folderId)
    if (cached) {
      return cached
    }
    const gathered = [
      ...(filed.get(folderId) ?? []),
      ...(children.get(folderId) ?? []).flatMap((child) => collect(child.id)),
    ]
    descendants.set(folderId, gathered)
    return gathered
  }

  return {
    get: (folderId) => byId.get(folderId),
    childrenOf: (parentId) => children.get(parentId) ?? [],
    filesIn: (folderId) => filed.get(folderId) ?? [],
    descendantsOf: collect,
    pathTo: (folderId) => {
      const trail: KnowledgeFolderSummary[] = []
      // Walks up by parent id, so it stops on its own at the root (a null parent) or at a parent
      // whose row is gone. Drive cannot parent a folder into its own subtree and the tree arrives
      // from one atomic write, so there is no cycle to guard against.
      let cursor = byId.get(folderId)
      while (cursor) {
        trail.unshift(cursor)
        cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
      }
      return trail
    },
  }
}
