import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createKnowledgeRepository } from '../src/assistant/repository.js'
import { createDb } from '../src/db/client.js'
import { knowledgeChunks, knowledgeDocs } from '../src/db/schema.js'
import { type TestDb, startTestDb } from './helpers/test-db.js'

// The database half of retrieval (migration 0016): embeddings live in a pgvector column and the
// vector arm's cosine ranking runs as an exact `<=>` scan inside Postgres — the vectors never
// travel to Node. These are the only tests that execute that SQL for real (the retrieval unit
// suite simulates the scan's contract; the answer-path integration tests run keyword mode), so
// they pin the write path's ::vector cast, the ranking order, the role boundary, and that the
// grounding read carries the embedded flag without hauling the vectors.

const DIMENSIONS = 1024

// A unit vector along one axis: cosine against another axis is 0, against itself 1, and a
// mix of two axes lands in between — enough geometry to pin the ordering.
const axis = (i: number): number[] =>
  Array.from({ length: DIMENSIONS }, (_, j) => (j === i ? 1 : 0))
const mix = (i: number, j: number, weight: number): number[] => {
  const other = Math.sqrt(1 - weight * weight)
  return Array.from({ length: DIMENSIONS }, (_, k) => (k === i ? weight : k === j ? other : 0))
}

describe('knowledge repository — the pgvector scan', () => {
  let testDb: TestDb
  let db: ReturnType<typeof createDb>['db']
  let pool: ReturnType<typeof createDb>['pool']
  let repo: ReturnType<typeof createKnowledgeRepository>
  const now = new Date('2026-01-01T00:00:00.000Z')

  beforeAll(async () => {
    testDb = await startTestDb()
    const created = createDb(testDb.connectionString)
    db = created.db
    pool = created.pool
    repo = createKnowledgeRepository(db)
  }, 120_000)

  afterAll(async () => {
    await pool.end()
    await testDb.stop()
  })

  beforeEach(async () => {
    await db.delete(knowledgeChunks)
    await db.delete(knowledgeDocs)
  })

  const seedDoc = async (title: string, sensitivity: 'general' | 'confidential') => {
    const [row] = await db
      .insert(knowledgeDocs)
      .values({
        driveFileId: `drive-${title}`,
        title,
        content: `content of ${title}`,
        sourceMimeType: 'text/plain',
        status: 'ingested',
        sensitivity,
        driveModifiedTime: now,
        updatedAt: now,
      })
      .returning({ id: knowledgeDocs.id })
    if (!row) throw new Error('seed insert returned no row')
    return row.id
  }

  const chunkIdsOf = async (docId: string): Promise<string[]> => {
    const chunks = await repo.listGroundingChunks({ role: 'admin' })
    return chunks.filter((chunk) => chunk.docId === docId).map((chunk) => chunk.id)
  }

  it('round-trips a vector through setChunkEmbeddings and ranks by cosine, best first', async () => {
    const docId = await seedDoc('נהלים', 'general')
    await repo.insertChunks(docId, ['exact', 'near', 'far'], now)
    const [exact, near, far] = await chunkIdsOf(docId)
    if (!exact || !near || !far) throw new Error('expected three chunks')
    await repo.setChunkEmbeddings(
      [
        { id: exact, embedding: axis(0), gist: null },
        { id: near, embedding: mix(0, 1, 0.8), gist: null },
        { id: far, embedding: axis(1), gist: null },
      ],
      'qwen/qwen3-embedding-8b',
      now,
    )

    const hits = await repo.searchChunksByVector({ role: 'admin' }, axis(0), 30)
    expect(hits.map((hit) => hit.id)).toEqual([exact, near, far])
    expect(hits[0]?.score).toBeCloseTo(1, 5)
    expect(hits[1]?.score).toBeCloseTo(0.8, 5)
    expect(hits[2]?.score).toBeCloseTo(0, 5)
  })

  it('never returns a chunk the backfill has not reached, and respects the limit', async () => {
    const docId = await seedDoc('נהלים', 'general')
    await repo.insertChunks(docId, ['embedded-1', 'embedded-2', 'pending'], now)
    const [first, second, pending] = await chunkIdsOf(docId)
    if (!first || !second || !pending) throw new Error('expected three chunks')
    await repo.setChunkEmbeddings(
      [
        { id: first, embedding: axis(0), gist: null },
        { id: second, embedding: mix(0, 1, 0.9), gist: null },
      ],
      'qwen/qwen3-embedding-8b',
      now,
    )

    const all = await repo.searchChunksByVector({ role: 'admin' }, axis(0), 30)
    expect(all.map((hit) => hit.id)).toEqual([first, second])

    const capped = await repo.searchChunksByVector({ role: 'admin' }, axis(0), 1)
    expect(capped.map((hit) => hit.id)).toEqual([first])
  })

  it('holds the role boundary: an employee scan never sees a confidential document', async () => {
    // The same predicate as the grounding read, in the same place — the query. A lease chunk
    // whose vector matches the question exactly must still be absent from an employee's scan.
    const leaseId = await seedDoc('הסכם שכירות', 'confidential')
    const menuId = await seedDoc('תפריט', 'general')
    await repo.insertChunks(leaseId, ['lease terms'], now)
    await repo.insertChunks(menuId, ['menu items'], now)
    const [leaseChunk] = await chunkIdsOf(leaseId)
    const [menuChunk] = await chunkIdsOf(menuId)
    if (!leaseChunk || !menuChunk) throw new Error('expected seeded chunks')
    await repo.setChunkEmbeddings(
      [
        { id: leaseChunk, embedding: axis(0), gist: null },
        { id: menuChunk, embedding: mix(0, 1, 0.5), gist: null },
      ],
      'qwen/qwen3-embedding-8b',
      now,
    )

    const employee = await repo.searchChunksByVector({ role: 'employee' }, axis(0), 30)
    expect(employee.map((hit) => hit.id)).toEqual([menuChunk])

    const admin = await repo.searchChunksByVector({ role: 'admin' }, axis(0), 30)
    expect(admin.map((hit) => hit.id)).toEqual([leaseChunk, menuChunk])
  })

  it('reports embedded state on the grounding read without carrying the vectors', async () => {
    const docId = await seedDoc('נהלים', 'general')
    await repo.insertChunks(docId, ['done', 'pending'], now)
    const [done] = await chunkIdsOf(docId)
    if (!done) throw new Error('expected a chunk')
    await repo.setChunkEmbeddings([{ id: done, embedding: axis(0), gist: null }], 'model', now)

    const chunks = await repo.listGroundingChunks({ role: 'admin' })
    expect(chunks.map((chunk) => chunk.embedded)).toEqual([true, false])
    for (const chunk of chunks) {
      expect(chunk).not.toHaveProperty('embedding')
    }
  })
})
