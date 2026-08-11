import type { KnowledgeDocListResponse } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { knowledgeApi } from '../../lib/api.js'

// The Knowledge tab's one query (ADR-0024): the filed corpus plus its last sync time. The
// endpoint is manager/admin-only (ADR-0007 — an employee is a flat 403) and the tab is gated
// the same way, so no `enabled` dance is needed; the raw query is returned so the screen
// branches on pending/error/empty with its own copy, as the locations screen does.
export const KNOWLEDGE_DOCS_QUERY_KEY = ['knowledge-docs'] as const

export function useKnowledgeDocs() {
  return useQuery({
    queryKey: KNOWLEDGE_DOCS_QUERY_KEY,
    queryFn: (): Promise<KnowledgeDocListResponse> => knowledgeApi.list(),
  })
}
