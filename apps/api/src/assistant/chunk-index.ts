import type { Clock } from '../auth/clock.js'
import { chunkDocContent } from './chunking.js'
import { EMBEDDING_BATCH_SIZE, type EmbeddingClient } from './embedding-client.js'
import type { LlmClient, LlmMessage } from './llm-client.js'
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
//
// The language bridge (2026-08, from the field audit): the corpus is mostly Hebrew but holds a
// few English SOPs, and the measured Hebrew-question→English-chunk cosine lands at 0.19–0.28 —
// beneath any workable floor — so a Hebrew question could never surface an English document no
// matter how the thresholds were tuned (the client's twice-declined "מהו נוהל הפתיחה?" while
// PROC-047 "Grill Station Opening… Daily, at open" sat unretrieved is exactly this). The sister
// Clix RAG measured the same ~0.29 cross-lingual wall and solved it document-side, which is the
// approach borrowed here: when a chunk's letters are Latin-dominant and an LLM is wired, a short
// Hebrew gist is generated once at index time and becomes the chunk's EMBEDDED text (title +
// gist, without the English body — a mixed-language embed text dilutes both directions, while a
// Hebrew embed text matches Hebrew questions natively and English questions through the strong
// EN→HE direction, measured 0.55–0.70). The stored content — what the model reads, quotes, and
// cites — stays the original English. Gist generation is best-effort exactly like the embedding
// call: a failure stops the pass and the next one retries, so a provider hiccup never strands a
// chunk with a bridge-less embedding. Without an LLM (harness syncs, categorizer-less boots,
// embedding-less providers) every chunk embeds as before.

export interface ChunkIndexer {
  ensureIndexed(): Promise<void>
}

export interface ChunkIndexerOptions {
  // Best-effort failure reporting, mirroring the sync's onDocumentError: a logger in the
  // running server, a collector in tests. Never carries chunk content (ADR-0011).
  onIndexError?: (scope: string, error: unknown) => void
  // The LLM the language bridge generates Hebrew gists with. Wired only when embeddings are
  // live (the server gates it on the embedding config; the probe passes its own client) so a
  // disabled-embeddings boot never spends completions on gists no embedding will use.
  llm?: LlmClient
}

// The gist budget: a search-index summary, not a translation — a few Hebrew lines carrying
// the topic and the key terms are what the embedding needs. A thinking model counts its
// reasoning against max_tokens (#263) and treats the preset's 512 reasoning cap as a hint it
// overruns freely: 400 and even 1,000 made every gist finish 'length' with no content
// (measured on the first bridge-aware resyncs). 3,000 leaves the overrun plus a full gist
// comfortable, and the spend is one-time per chunk.
export const BRIDGE_MAX_TOKENS = 3_000

// A chunk needs the bridge when its letters are mostly Latin — a Hebrew doc that merely
// mentions WhatsApp or Boosty stays Hebrew-dominant and needs none.
export function needsLanguageBridge(content: string): boolean {
  const latin = (content.match(/[A-Za-z]/g) ?? []).length
  const hebrew = (content.match(/[\u{0590}-\u{05FF}]/gu) ?? []).length
  return latin > hebrew
}

const bridgeMessages = (title: string, content: string): LlmMessage[] => {
  const instruction = [
    `For a Hebrew search index: summarize the following excerpt from the document "${title}"`,
    'in Hebrew — 4 to 8 short lines naming the topic, the main actions, and the key terms',
    '(translate the key operational terms into Hebrew). Output only the Hebrew summary,',
    'nothing else.',
  ].join(' ')
  return [{ role: 'user', content: `${instruction}\n\n${content}` }]
}

export function createChunkIndexer(
  repo: KnowledgeRepository,
  embeddings: EmbeddingClient,
  clock: Clock,
  options: ChunkIndexerOptions = {},
): ChunkIndexer {
  const reportError = options.onIndexError ?? (() => {})
  const llm = options.llm

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

  // The text a chunk is embedded as: title-prefixed content, or — for a Latin-dominant chunk
  // with an LLM wired — the title plus a generated Hebrew gist (see the bridge note above).
  // null means the gist call failed and this pass should stop and be retried.
  const embedTextOf = async (chunk: {
    docTitle: string
    content: string
  }): Promise<string | null> => {
    if (!llm || !needsLanguageBridge(chunk.content)) {
      return `${chunk.docTitle}\n${chunk.content}`
    }
    const gist = await llm.complete({
      messages: bridgeMessages(chunk.docTitle, chunk.content),
      maxTokens: BRIDGE_MAX_TOKENS,
    })
    return gist.ok ? `${chunk.docTitle}\n${gist.content}` : null
  }

  const embedPendingChunks = async (): Promise<void> => {
    const pending = await repo.listChunksMissingEmbedding()
    for (let start = 0; start < pending.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = pending.slice(start, start + EMBEDDING_BATCH_SIZE)
      const texts: string[] = []
      for (const chunk of batch) {
        const text = await embedTextOf(chunk)
        if (text === null) {
          // The bridge LLM is unhealthy; stop rather than embed a bridge-less vector that
          // would never be revisited — the next pass retries everything still null. Only the
          // error class is reported (ADR-0011).
          reportError('bridge chunks', new Error('language-bridge gist failed'))
          return
        }
        texts.push(text)
      }
      const result = await embeddings.embed(texts)
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
