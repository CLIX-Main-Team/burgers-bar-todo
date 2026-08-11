import type { KnowledgeDocListResponse } from '@burgers/shared'
import type { KnowledgeRepository } from './repository.js'

// The Knowledge tab's read model (ADR-0024): the repository's admin listing folded into the
// wire shape the shared schema pins — dates to ISO strings, content deliberately left behind
// (the tab links to the original in Drive, it never mirrors text). One function so server.ts
// and the integration harness compose the /assistant/knowledge route identically.
export async function listKnowledgeDocs(
  repo: KnowledgeRepository,
): Promise<KnowledgeDocListResponse> {
  const [docs, lastSyncAt] = await Promise.all([repo.listAllDocs(), repo.getLastSyncAt()])
  return {
    docs: docs.map((doc) => ({
      id: doc.id,
      driveFileId: doc.driveFileId,
      title: doc.title,
      category: doc.category,
      status: doc.status,
      skipReason: doc.skipReason,
      sourceMimeType: doc.sourceMimeType,
      driveModifiedTime: doc.driveModifiedTime.toISOString(),
    })),
    lastSyncAt: lastSyncAt?.toISOString() ?? null,
  }
}
