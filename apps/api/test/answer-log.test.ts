import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type AnswerLogEntry, createAnswerLog } from '../src/assistant/answer-log.js'
import { createDb } from '../src/db/client.js'
import { assistantAnswerLog } from '../src/db/schema.js'
import { type TestDb, startTestDb } from './helpers/test-db.js'

// The per-answer log row (migration 0038): one insert per answer attempt, references and numbers
// only — chunk ids, scores, token counts, latency — never the question or the answer text, which
// live solely in the thread (ADR-0011). This suite pins the write path against the real table:
// the row round-trips, and both jsonb shapes come back structurally intact.

const now = new Date('2026-01-02T10:00:00.000Z')

const entry = (over: Partial<AnswerLogEntry> = {}): AnswerLogEntry => ({
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'employee',
  threadId: '33333333-3333-3333-3333-333333333333',
  status: 'answered',
  errorClass: null,
  agentMessageId: '44444444-4444-4444-4444-444444444444',
  mode: 'hybrid',
  model: 'google/gemini-3.1-pro-preview',
  inputTokens: 321,
  outputTokens: 45,
  latencyMs: 1200,
  llmMs: 900,
  vectorArmEmpty: false,
  unembeddedChunks: 0,
  retrieved: [
    { chunkId: 'doc-1#0', docId: 'doc-1', score: 0.04, vectorScore: 0.91, keywordRank: null },
  ],
  sources: [{ id: 'doc-1', title: 'נוהל פתיחה', type: 'document' }],
  tools: [{ tool: 'search_documents', status: 'ok' }],
  rounds: 2,
  capped: false,
  now,
  ...over,
})

describe('assistant answer log — the per-answer row', () => {
  let testDb: TestDb
  let db: ReturnType<typeof createDb>['db']
  let pool: ReturnType<typeof createDb>['pool']
  let log: ReturnType<typeof createAnswerLog>

  beforeAll(async () => {
    testDb = await startTestDb()
    const created = createDb(testDb.connectionString)
    db = created.db
    pool = created.pool
    log = createAnswerLog(db)
  }, 120_000)

  afterAll(async () => {
    await pool.end()
    await testDb.stop()
  })

  beforeEach(async () => {
    await db.delete(assistantAnswerLog)
  })

  it('round-trips an answered row with its retrieved chunks and resolved sources', async () => {
    await log.record(entry())
    const rows = await db.select().from(assistantAnswerLog)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    if (!row) throw new Error('expected a row')
    expect(row.status).toBe('answered')
    expect(row.role).toBe('employee')
    expect(row.mode).toBe('hybrid')
    expect(row.model).toBe('google/gemini-3.1-pro-preview')
    expect(row.inputTokens).toBe(321)
    expect(row.outputTokens).toBe(45)
    expect(row.latencyMs).toBe(1200)
    expect(row.llmMs).toBe(900)
    expect(row.retrieved).toEqual([
      { chunkId: 'doc-1#0', docId: 'doc-1', score: 0.04, vectorScore: 0.91, keywordRank: null },
    ])
    expect(row.sources).toEqual([{ id: 'doc-1', title: 'נוהל פתיחה', type: 'document' }])
    expect(row.tools).toEqual([{ tool: 'search_documents', status: 'ok' }])
    expect(row.createdAt.toISOString()).toBe(now.toISOString())
  })

  // The daily spend alert reads the day's cost from here (2026-09-20). The day is Israel's, so an
  // answer at 23:30 in Tel Aviv counts with that day, not with the UTC day that has already turned.
  it('sums what the answers of one Israel day cost, in dollars, ignoring the failed and the unpriced', async () => {
    const at = (iso: string) => new Date(iso)
    await log.record(entry({ costMicroUsd: 1_500_000, now: at('2026-09-20T05:00:00.000Z') }))
    await log.record(entry({ costMicroUsd: 250_000, now: at('2026-09-20T20:30:00.000Z') }))
    // 23:30 in Tel Aviv on the 20th is 20:30 UTC (above); 00:30 on the 21st is 21:30 UTC.
    await log.record(entry({ costMicroUsd: 9_000_000, now: at('2026-09-20T21:30:00.000Z') }))
    await log.record(entry({ costMicroUsd: null, now: at('2026-09-20T06:00:00.000Z') }))
    await log.record(
      entry({
        status: 'unavailable',
        costMicroUsd: 400_000,
        agentMessageId: null,
        now: at('2026-09-20T07:00:00.000Z'),
      }),
    )
    expect(await log.spentOnDay(at('2026-09-20T12:00:00.000Z'))).toBeCloseTo(1.75, 6)
    expect(await log.spentOnDay(at('2026-09-21T12:00:00.000Z'))).toBeCloseTo(9, 6)
    expect(await log.spentOnDay(at('2026-09-22T12:00:00.000Z'))).toBe(0)
  })

  it('records a failed attempt with its error class and no message reference', async () => {
    await log.record(
      entry({
        status: 'unavailable',
        errorClass: 'provider responded 402',
        agentMessageId: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        llmMs: null,
        sources: [],
      }),
    )
    const rows = await db.select().from(assistantAnswerLog)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('unavailable')
    expect(rows[0]?.errorClass).toBe('provider responded 402')
    expect(rows[0]?.agentMessageId).toBeNull()
    expect(rows[0]?.sources).toEqual([])
  })
})
