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
// approach borrowed here: an LLM restates each chunk once at index time in THE OTHER LANGUAGE —
// Hebrew for a Latin-dominant chunk, English for a Hebrew one — and the result is stored as the
// chunk's `gist`. It is used two ways, deliberately not the same way in both directions:
//
//   - EMBEDDING (Latin-dominant chunks only): the Hebrew gist replaces the English body in the
//     embedded text (title + gist). A mixed-language embed text dilutes both directions, while a
//     Hebrew one matches Hebrew questions natively and English questions through the strong EN→HE
//     direction (measured 0.55–0.70). A Hebrew chunk already embeds well for both, so its text is
//     untouched — the English gist never enters its vector.
//   - KEYWORDS (both directions): retrieval's keyword arm reads title + content + gist, so the
//     lexical half of the ranking can match across languages at all. Without this the keyword arm
//     is monolingual by construction, and the 2026-08-13 flip test measured exactly that hole: the
//     lease-reminder question, fixed in Hebrew by the keyword arm, failed again in English in both
//     of its phrasings because an English question shares no characters with a Hebrew document.
//     The English gist also carries names as an English speaker would type them, which is what
//     makes "Ahmad Dirbat" reach אחמד דירבת lexically.
//
// The stored content — what the model reads, quotes, and cites — is always the original text; the
// gist is an index artifact the model never sees. Generation is best-effort exactly like the
// embedding call: a failure stops the pass and the next one retries, so a provider hiccup never
// strands a chunk with a bridge-less index entry. Without an LLM (harness syncs, categorizer-less
// boots, embedding-less providers) every chunk embeds as before and carries no gist.

export interface ChunkIndexer {
  ensureIndexed(): Promise<void>
}

export interface ChunkIndexerOptions {
  // Best-effort failure reporting, mirroring the sync's onDocumentError: a logger in the
  // running server, a collector in tests. Never carries chunk content (ADR-0011).
  onIndexError?: (scope: string, error: unknown) => void
  // The LLM the language bridge restates chunks with. Wired only when embeddings are live (the
  // server gates it on the embedding config; the probe passes its own client) so a
  // disabled-embeddings boot never spends completions on gists no retrieval will use.
  llm?: LlmClient
}

// The gist budget: a search-index summary, not a translation — a few Hebrew lines carrying
// the topic and the key terms are what the embedding needs. A thinking model counts its
// reasoning against max_tokens (#263) and treats the preset's 512 reasoning cap as a hint it
// overruns freely: 400 and even 1,000 made every gist finish 'length' with no content
// (measured on the first bridge-aware resyncs). 3,000 leaves the overrun plus a full gist
// comfortable, and the spend is one-time per chunk.
export const BRIDGE_MAX_TOKENS = 3_000

// Which way the bridge runs for a chunk: a Latin-dominant chunk is restated in Hebrew, everything
// else in English. A Hebrew doc that merely mentions WhatsApp or Boosty stays Hebrew-dominant.
export function isLatinDominant(content: string): boolean {
  const latin = (content.match(/[A-Za-z]/g) ?? []).length
  const hebrew = (content.match(/[\u{0590}-\u{05FF}]/gu) ?? []).length
  return latin > hebrew
}

const bridgeMessages = (title: string, content: string, toHebrew: boolean): LlmMessage[] => {
  const instruction = toHebrew
    ? [
        `For a Hebrew search index: summarize the following excerpt from the document "${title}"`,
        'in Hebrew — 4 to 8 short lines naming the topic, the main actions, and the key terms',
        '(translate the key operational terms into Hebrew). Output only the Hebrew summary,',
        'nothing else.',
      ].join(' ')
    : [
        `For an English search index: summarize the following excerpt from the document "${title}"`,
        'in English — 4 to 8 short lines naming the topic, the main actions, and the key terms.',
        'Write every name of a person, branch, supplier, or system the way an English speaker',
        'would type it (transliterate: אחמד דירבת → Ahmad Dirbat, מחנה יהודה → Mahane Yehuda),',
        'and keep numbers and dates as they appear. Output only the English summary, nothing else.',
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

  // What one chunk contributes to the index: the text it is embedded as, and its other-language
  // gist. Only a Latin-dominant chunk embeds through its gist — a Hebrew chunk keeps its own body
  // in the vector and uses the gist for keyword reach alone (see the bridge note above).
  // null means the gist call failed and this pass should stop and be retried.
  const indexTextsOf = async (chunk: {
    docTitle: string
    content: string
  }): Promise<{ embedText: string; gist: string | null } | null> => {
    if (!llm) {
      return { embedText: `${chunk.docTitle}\n${chunk.content}`, gist: null }
    }
    const toHebrew = isLatinDominant(chunk.content)
    const gist = await llm.complete({
      messages: bridgeMessages(chunk.docTitle, chunk.content, toHebrew),
      maxTokens: BRIDGE_MAX_TOKENS,
    })
    if (!gist.ok) {
      return null
    }
    return {
      embedText: toHebrew
        ? `${chunk.docTitle}\n${gist.content}`
        : `${chunk.docTitle}\n${chunk.content}`,
      gist: gist.content,
    }
  }

  const embedPendingChunks = async (): Promise<void> => {
    // With an LLM wired the queue also claims already-embedded chunks that carry no gist: that is
    // how the bridge reaches a corpus indexed before it existed, without nulling vectors and
    // leaving retrieval blind for the length of the backfill.
    const pending = await repo.listChunksNeedingIndex(llm !== undefined)
    for (let start = 0; start < pending.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = pending.slice(start, start + EMBEDDING_BATCH_SIZE)
      const texts: string[] = []
      const gists: (string | null)[] = []
      for (const chunk of batch) {
        const indexed = await indexTextsOf(chunk)
        if (indexed === null) {
          // The bridge LLM is unhealthy; stop rather than index a bridge-less chunk that would
          // never be revisited — the next pass retries everything still null. Only the error
          // class is reported (ADR-0011).
          reportError('bridge chunks', new Error('language-bridge gist failed'))
          return
        }
        texts.push(indexed.embedText)
        gists.push(indexed.gist)
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
        return embedding && embedding.length > 0
          ? [{ id: chunk.id, embedding, gist: gists[index] ?? null }]
          : []
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
