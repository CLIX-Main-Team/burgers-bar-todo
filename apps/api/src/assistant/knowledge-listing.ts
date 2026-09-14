import type { KnowledgeDocListResponse } from '@burgers/shared'
import type { KnowledgeScope } from './document-metadata.js'
import type { KnowledgeRepository } from './repository.js'

// The Knowledge tab's read model (ADR-0024): the repository's admin listing folded into the
// wire shape the shared schema pins — dates to ISO strings, content deliberately left behind
// (the tab links to the original in Drive, it never mirrors text). One function so server.ts
// and the integration harness compose the /assistant/knowledge route identically.
//
// The folder tree travels beside the documents rather than being inferred from them (2026-09-10).
// Inferring it made a folder real only if something readable happened to be inside it, so a folder
// somebody had just made — or one holding only a photo — produced no tile and read as broken.
export async function listKnowledgeDocs(
  repo: KnowledgeRepository,
  scope: KnowledgeScope,
): Promise<KnowledgeDocListResponse> {
  const [docs, folders, lastSyncAt] = await Promise.all([
    repo.listAllDocs(scope),
    repo.listFolders(),
    repo.getLastSyncAt(),
  ])
  return {
    docs: docs.map((doc) => ({
      id: doc.id,
      driveFileId: doc.driveFileId,
      title: doc.title,
      folderId: doc.folderId,
      status: doc.status,
      skipReason: doc.skipReason,
      sourceMimeType: doc.sourceMimeType,
      driveModifiedTime: doc.driveModifiedTime.toISOString(),
    })),
    folders: folders.map((folder) => ({
      id: folder.driveFolderId,
      name: folder.name,
      parentId: folder.parentId,
      fileCount: folder.fileCount,
    })),
    lastSyncAt: lastSyncAt?.toISOString() ?? null,
  }
}
