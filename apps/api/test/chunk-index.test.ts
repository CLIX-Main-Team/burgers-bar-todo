import { describe, expect, it } from 'vitest'
import { createChunkIndexer, needsLanguageBridge } from '../src/assistant/chunk-index.js'
import { createFakeEmbeddingClient } from '../src/assistant/embedding-client.js'
import { createFakeLlmClient } from '../src/assistant/llm-client.js'
import type { KnowledgeRepository } from '../src/assistant/repository.js'

// Unit coverage for the language bridge (2026-08 field audit): a Latin-dominant chunk embeds as
// title + generated Hebrew gist, a Hebrew chunk embeds as before, no wired LLM means no bridge,
// and a failed gist stops the pass exactly like a failed embedding batch — nothing half-indexed.
// The chunking half of the indexer is covered by chunking.test.ts and the sync integration suite.

const HEBREW = { id: 'c-he', docTitle: 'צק ליסט פתיחת סניף', content: 'חתימה על הסכם מול Boosty' }
const ENGLISH = {
  id: 'c-en',
  docTitle: 'Burgers Bar Procedure',
  content: 'Grill Station Opening: sanitize all surfaces ten minutes before open.',
}

const fakeRepo = (pending: { id: string; docTitle: string; content: string }[]) => {
  const stored: { id: string; embedding: number[] }[] = []
  const repo = {
    listDocsNeedingChunks: async () => [],
    insertChunks: async () => {},
    listChunksMissingEmbedding: async () => pending,
    setChunkEmbeddings: async (updates: { id: string; embedding: number[] }[]) => {
      stored.push(...updates)
    },
  } as unknown as KnowledgeRepository
  return { repo, stored }
}

const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

describe('needsLanguageBridge', () => {
  it('flags a Latin-dominant chunk and passes a Hebrew chunk that merely mentions a system', () => {
    expect(needsLanguageBridge(ENGLISH.content)).toBe(true)
    expect(needsLanguageBridge(HEBREW.content)).toBe(false)
    expect(needsLanguageBridge('')).toBe(false)
  })
})

describe('chunk indexer — language bridge', () => {
  it('embeds a Latin-dominant chunk as title + Hebrew gist, a Hebrew chunk as title + content', async () => {
    const { repo, stored } = fakeRepo([HEBREW, ENGLISH])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer('תקציר עברי של פתיחת הגריל')

    await createChunkIndexer(repo, embeddings, clock, { llm }).ensureIndexed()

    expect(embeddings.requests[0]).toEqual([
      `${HEBREW.docTitle}\n${HEBREW.content}`,
      `${ENGLISH.docTitle}\nתקציר עברי של פתיחת הגריל`,
    ])
    // Exactly one gist call — the Hebrew chunk asked for none — and it carried the chunk text.
    expect(llm.requests).toHaveLength(1)
    expect(llm.requests[0]?.messages[0]?.content).toContain(ENGLISH.content)
    expect(stored.map((update) => update.id)).toEqual([HEBREW.id, ENGLISH.id])
  })

  it('embeds title + content for every chunk when no LLM is wired', async () => {
    const { repo, stored } = fakeRepo([ENGLISH])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))

    await createChunkIndexer(repo, embeddings, clock).ensureIndexed()

    expect(embeddings.requests[0]).toEqual([`${ENGLISH.docTitle}\n${ENGLISH.content}`])
    expect(stored).toHaveLength(1)
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
