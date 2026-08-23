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

const HEBREW = {
  id: 'c-he',
  docTitle: 'צק ליסט פתיחת סניף',
  content: 'חתימה על הסכם מול Boosty',
  gist: null,
}
const ENGLISH = {
  id: 'c-en',
  docTitle: 'Burgers Bar Procedure',
  content: 'Grill Station Opening: sanitize all surfaces ten minutes before open.',
  gist: null,
}

const fakeRepo = (
  pending: { id: string; docTitle: string; content: string; gist: string | null }[],
) => {
  const stored: { id: string; embedding: number[]; gist: string | null }[] = []
  const gistsWritten: { id: string; gist: string }[] = []
  const queuedWithGist: boolean[] = []
  const repo = {
    listDocsNeedingChunks: async () => [],
    insertChunks: async () => {},
    listChunksNeedingIndex: async (withGist: boolean) => {
      queuedWithGist.push(withGist)
      return pending
    },
    setChunkGists: async (updates: { id: string; gist: string }[]) => {
      gistsWritten.push(...updates)
    },
    setChunkEmbeddings: async (
      updates: { id: string; embedding: number[]; gist: string | null }[],
    ) => {
      stored.push(...updates)
    },
  } as unknown as KnowledgeRepository
  return { repo, stored, gistsWritten, queuedWithGist }
}

const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

describe('isLatinDominant', () => {
  it('flags a Latin-dominant chunk and passes a Hebrew chunk that merely mentions a system', () => {
    expect(isLatinDominant(ENGLISH.content)).toBe(true)
    expect(isLatinDominant(HEBREW.content)).toBe(false)
    expect(isLatinDominant('')).toBe(false)
  })

  it('does not call a table of Hebrew values under English headers Latin', () => {
    // The lease-dashboard shape: English column headers repeating on every row, Hebrew values. A
    // plain latin > hebrew majority read this as English, and for a Latin chunk the Hebrew gist
    // REPLACES the body in the embedded text — so the row's own values left its vector entirely and
    // every row group of the sheet embedded as a near-identical title-plus-gist.
    // Field names repeat on every row, which is how the HTML/JSON extraction path renders a
    // dashboard, so 144 Latin letters outnumber 59 Hebrew ones and the old majority rule called this
    // English. Hebrew is 29% of the letters here — clearly a Hebrew chunk to any reader.
    const rows = `branchName: סניף רמות | landlordName: דוד כהן | contractEndDate: 2028-01-01 | leaseStatus: פעיל
branchName: סניף תלפיות | landlordName: משה לוי | contractEndDate: 2026-11-15 | leaseStatus: פעיל
branchName: סניף מרכז | landlordName: אחמד דירבת | contractEndDate: 2027-03-01 | leaseStatus: פעיל`
    expect(isLatinDominant(rows)).toBe(false)
  })

  it('still flags a genuinely English procedure that carries no Hebrew at all', () => {
    expect(
      isLatinDominant('PROC-047 Grill Station Opening and Cleaning SOP. Daily, at open.'),
    ).toBe(true)
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

  it('skips only the chunk whose gist failed, and indexes the rest of the batch', async () => {
    // A failed gist used to abort the entire pass. The queue is title-ordered, so one chunk the
    // model consistently refused sat at its head and blocked every chunk behind it from ever being
    // indexed. The failing chunk keeps its null gist and is claimed again next pass; its neighbours
    // do not wait for it.
    const { repo, stored } = fakeRepo([ENGLISH, HEBREW])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))
    const llm = createFakeLlmClient()
    llm.failNext()
    const scopes: string[] = []

    await createChunkIndexer(repo, embeddings, clock, {
      llm,
      onIndexError: (scope) => scopes.push(scope),
    }).ensureIndexed()

    expect(stored.map((s) => s.id)).toEqual([HEBREW.id])
    expect(scopes).toEqual(['bridge chunks'])
  })

  it('indexes nothing but reports when every gist in the batch fails', async () => {
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

    // No embed call fires with a bridge-less text, and nothing is stored half-indexed.
    expect(embeddings.requests).toHaveLength(0)
    expect(stored).toHaveLength(0)
    expect(scopes).toEqual(['bridge chunks'])
  })

  it('banks the gists before spending anything on embeddings', async () => {
    // Each gist is a premium completion. Writing them only alongside the vectors meant an embedding
    // failure discarded a whole batch of paid work that the backstop then bought all over again.
    const { repo, stored, gistsWritten } = fakeRepo([ENGLISH])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith(() => ({ ok: false, error: 'provider down' }))
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer('bridged gist')

    await createChunkIndexer(repo, embeddings, clock, { llm }).ensureIndexed()

    expect(gistsWritten).toEqual([{ id: ENGLISH.id, gist: 'bridged gist' }])
    expect(stored).toHaveLength(0)
  })

  it('reuses a gist already on the row instead of buying it again', async () => {
    const { repo, stored } = fakeRepo([{ ...ENGLISH, gist: 'gist bought on an earlier pass' }])
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer('freshly bought gist')

    await createChunkIndexer(repo, embeddings, clock, { llm }).ensureIndexed()

    // No completion was requested, and the stored gist is the one that already existed.
    expect(llm.requests).toHaveLength(0)
    expect(stored).toEqual([
      { id: ENGLISH.id, embedding: [1, 0], gist: 'gist bought on an earlier pass' },
    ])
  })

  it('records the embedding model on every vector it writes', async () => {
    const models: string[] = []
    const pending = [HEBREW]
    const repo = {
      listDocsNeedingChunks: async () => [],
      insertChunks: async () => {},
      listChunksNeedingIndex: async () => pending,
      setChunkGists: async () => {},
      setChunkEmbeddings: async (_updates: unknown, model: string) => {
        models.push(model)
      },
    } as unknown as KnowledgeRepository
    const embeddings = createFakeEmbeddingClient()
    embeddings.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))

    await createChunkIndexer(repo, embeddings, clock, {
      embeddingModel: 'qwen/qwen3-embedding-8b',
    }).ensureIndexed()

    // Without this the queue cannot tell a vector from the current model apart from one left behind
    // by a previous model, and a swap silently leaves every stored vector in the wrong space.
    expect(models).toEqual(['qwen/qwen3-embedding-8b'])
  })
})
