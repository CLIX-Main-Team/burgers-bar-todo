import type { Clock } from '../auth/clock.js'
import { chunkDocContent } from './chunking.js'
import { EMBEDDING_BATCH_SIZE, type EmbeddingClient } from './embedding-client.js'
import type { KnowledgeRepository } from './repository.js'

// The retrieval-index maintenance pass (ADR-0025), riding the sync's afterReconcile seam the
// way the categorizer does: after every reconcile — full load, incremental, manual resync —
// it (1) chunks any ingested doc whose chunks are missing (new docs, edited docs whose upsert
// cleared them, and the whole pre-existing corpus on the first deploy), then (2) backfills
// embeddings onto chunks that lack one. The two halves are deliberately independent:
//
//   - chunking is pure and local, so the index over which keyword retrieval runs exists even
//     when no embedding provider is configured (groq) or the provider is down;
//   - embedding is best-effort and all-or-nothing per batch — a failed batch leaves its chunks
//     null and the NEXT pass retries them, so a transient provider error self-heals and never
//     fails a reconcile.
//
// The embedded text is title-prefixed ("{title}\n{chunk}") because the title carries the topic
// a short chunk may not repeat; the stored chunk content stays bare — the prompt renders the
// title as the block heading instead.

export interface ChunkIndexer {
  ensureIndexed(): Promise<void>
}

export interface ChunkIndexerOptions {
  // Best-effort failure reporting, mirroring the sync's onDocumentError: a logger in the
  // running server, a collector in tests. Never carries chunk content (ADR-0011).
  onIndexError?: (scope: string, error: unknown) => void
}

export function createChunkIndexer(
  repo: KnowledgeRepository,
  embeddings: EmbeddingClient,
  clock: Clock,
  options: ChunkIndexerOptions = {},
): ChunkIndexer {
  const reportError = options.onIndexError ?? (() => {})

  const chunkPendingDocs = async (): Promise<void> => {
    const docs = await repo.listDocsNeedingChunks()
    for (const doc of docs) {
      try {
        await repo.insertChunks(doc.id, chunkDocContent(doc.content), clock.now())
      } catch (error) {
        reportError(`chunk doc ${doc.id}`, error)
      }
    }
  }

  const embedPendingChunks = async (): Promise<void> => {
    const pending = await repo.listChunksMissingEmbedding()
    for (let start = 0; start < pending.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = pending.slice(start, start + EMBEDDING_BATCH_SIZE)
      const result = await embeddings.embed(
        batch.map((chunk) => `${chunk.docTitle}\n${chunk.content}`),
      )
      if (!result.ok) {
        // The provider is unhealthy or absent; stop rather than hammer it — the next pass
        // retries everything still null. Only the error class is reported (ADR-0011).
        reportError('embed chunks', new Error(result.error))
        return
      }
      // The client guarantees one non-empty vector per input on ok; the filter is the
      // defensive floor that keeps an empty vector from ever being stored as "embedded".
      const updates = batch.flatMap((chunk, index) => {
        const embedding = result.vectors[index]
        return embedding && embedding.length > 0 ? [{ id: chunk.id, embedding }] : []
      })
      await repo.setChunkEmbeddings(updates, clock.now())
    }
  }

  return {
    ensureIndexed: async () => {
      await chunkPendingDocs()
      await embedPendingChunks()
    },
  }
}
