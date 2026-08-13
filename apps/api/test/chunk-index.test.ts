import { describe, expect, it } from 'vitest'
import { createChunkIndexer, isLatinDominant } from '../src/assistant/chunk-index.js'
import { createFakeEmbeddingClient } from '../src/assistant/embedding-client.js'
import { createFakeLlmClient } from '../src/assistant/llm-client.js'
import type { KnowledgeRepository } from '../src/assistant/repository.js'

// Unit coverage for the language bridge (2026-08 field audit, extended by the 2026-08-13 flip
// test): every chunk is restated once in the other language and the restatement is stored, but
// only a Latin-dominant chunk EMBEDS through it — a Hebrew chunk keeps its own body in the vector
// and uses the gist for the keyword arm's cross-language reach. No wired LLM means no bridge at
// all, and a failed gist stops the pass exactly like a failed embedding batch: nothing
// half-indexed. The chunking half of the indexer is covered by chunking.test.ts and the sync
// integration suite.

const HEBREW = { id: 'c-he', docTitle: 'צק ליסט פתיחת סניף', content: 'חתימה על הסכם מול Boosty' }
const ENGLISH = {
  id: 'c-en',
  docTitle: 'Burgers Bar Procedure',
  content: 'Grill Station Opening: sanitize all surfaces ten minutes before open.',
}

const fakeRepo = (pending: { id: string; docTitle: string; content: string }[]) => {
  const stored: { id: string; embedding: number[]; gist: string | null }[] = []
  const queuedWithGist: boolean[] = []
  const repo = {
    listDocsNeedingChunks: async () => [],
    insertChunks: async () => {},
    listChunksNeedingIndex: async (withGist: boolean) => {
      queuedWithGist.push(withGist)
      return pending
    },
    setChunkEmbeddings: async (
      updates: { id: string; embedding: number[]; gist: string | null }[],
    ) => {
      stored.push(...updates)
    },
  } as unknown as KnowledgeRepository
  return { repo, stored, queuedWithGist }
}

const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

describe('isLatinDominant', () => {
  it('flags a Latin-dominant chunk and passes a Hebrew chunk that merely mentions a system', () => {
    expect(isLatinDominant(ENGLISH.content)).toBe(true)
    expect(isLatinDominant(HEBREW.content)).toBe(false)
    expect(isLatinDominant('')).toBe(false)
  })
})

describe('chunk indexer — language bridge', () => {
  it('embeds a Latin-dominant chunk as title + Hebrew gist, a Hebrew chunk as title + content', async () => {
    const { repo, stored } = fakeRepo([HEBREW, ENGLISH])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer('bridged gist')

    await createChunkIndexer(repo, embeddings, clock, { llm }).ensureIndexed()

    expect(embeddings.requests[0]).toEqual([
      // The Hebrew chunk's own words stay in its vector: its English gist is for words, not
      // vectors, and a mixed-language embed text dilutes both directions.
      `${HEBREW.docTitle}\n${HEBREW.content}`,
      `${ENGLISH.docTitle}\nbridged gist`,
    ])
    expect(stored.map((update) => update.id)).toEqual([HEBREW.id, ENGLISH.id])
  })

  it('restates every chunk in the other language and stores it for the keyword arm', async () => {
    const { repo, stored } = fakeRepo([HEBREW, ENGLISH])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer('gist')

    await createChunkIndexer(repo, embeddings, clock, { llm }).ensureIndexed()

    // Both directions run — the Hebrew chunk is asked for English, the English one for Hebrew —
    // and each chunk carries the result, which is what lets a question in either language match
    // either document lexically.
    expect(llm.requests).toHaveLength(2)
    expect(llm.requests[0]?.messages[0]?.content).toContain('For an English search index')
    expect(llm.requests[0]?.messages[0]?.content).toContain(HEBREW.content)
    expect(llm.requests[1]?.messages[0]?.content).toContain('For a Hebrew search index')
    expect(llm.requests[1]?.messages[0]?.content).toContain(ENGLISH.content)
    expect(stored.map((update) => update.gist)).toEqual(['gist', 'gist'])
  })

  it('embeds title + content and stores no gist when no LLM is wired', async () => {
    const { repo, stored, queuedWithGist } = fakeRepo([ENGLISH])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))

    await createChunkIndexer(repo, embeddings, clock).ensureIndexed()

    expect(embeddings.requests[0]).toEqual([`${ENGLISH.docTitle}\n${ENGLISH.content}`])
    expect(stored).toEqual([{ id: ENGLISH.id, embedding: [1, 0], gist: null }])
    // Without an LLM the queue must not claim gist-less chunks, or every pass would re-embed the
    // whole corpus forever chasing gists it cannot generate.
    expect(queuedWithGist).toEqual([false])
  })

  it('claims already-embedded chunks that carry no gist, so vectors are never nulled to schedule work', async () => {
    const { repo, queuedWithGist } = fakeRepo([HEBREW])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer('gist')

    await createChunkIndexer(repo, embeddings, clock, { llm }).ensureIndexed()

    expect(queuedWithGist).toEqual([true])
  })

  it('stops the pass on a failed gist — nothing embedded, the error reported by class only', async () => {
    const { repo, stored } = fakeRepo([ENGLISH])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))
    const llm = createFakeLlmClient()
    llm.failNext()
    const scopes: string[] = []

    await createChunkIndexer(repo, embeddings, clock, {
      llm,
      onIndexError: (scope) => scopes.push(scope),
    }).ensureIndexed()

    // The embed call never fires with a bridge-less text; the next pass retries the still-null
    // chunk with a healthy LLM.
    expect(embeddings.requests).toHaveLength(0)
    expect(stored).toHaveLength(0)
    expect(scopes).toEqual(['bridge chunks'])
  })
})
