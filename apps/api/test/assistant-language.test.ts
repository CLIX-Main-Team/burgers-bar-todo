import type { ThreadDetail } from '@burgers/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LlmCompletionRequest } from '../src/assistant/llm-client.js'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { assistantAnswerLog } from '../src/db/schema.js'
import { type AnswerAppHarness, createAnswerAppHarness } from './helpers/answer-app.js'

// The language check, end to end (2026-09-18): an English question answered in Hebrew is sent back
// once, the reader sees the English answer, and the log says which check it was.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'

const HEBREW =
  'תנאי מועדון הלקוחות של בורגרס בר כוללים את הנקודות הבאות: החברות תקפה ל-12 חודשים ממועד ההצטרפות.\n\nSOURCES: none'
const ENGLISH =
  'The customer club terms are these: membership is valid for 12 months from joining.\n\nSOURCES: none'

const wasSentBack = (request: LlmCompletionRequest): boolean =>
  request.messages.some((message) => message.content.startsWith('[Automatic language check'))

describe('assistant: an answer in the wrong language', () => {
  let harness: AnswerAppHarness

  beforeAll(async () => {
    harness = await createAnswerAppHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.auth.repo, harness.auth.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
  })

  const ask = async (content: string): Promise<ThreadDetail> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: SEED_EMAIL, password: SEED_PASSWORD },
    })
    const token = login.json<{ token: string }>().token
    const thread = await harness.app
      .inject({
        method: 'POST',
        url: '/threads',
        headers: { authorization: `Bearer ${token}` },
        payload: { content: 'a thread' },
      })
      .then((res) => res.json<ThreadDetail>())
    const res = await harness.app.inject({
      method: 'POST',
      url: `/threads/${thread.id}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content },
    })
    expect(res.statusCode).toBe(201)
    return res.json<ThreadDetail>()
  }

  it('sends the draft back once and shows the answer in the language of the question', async () => {
    harness.llm.respondWith((request) => ({
      ok: true,
      content: wasSentBack(request) ? ENGLISH : HEBREW,
    }))
    const detail = await ask('What are the customer club terms?')

    const turns = detail.messages.filter((message) => message.role === 'agent')
    expect(turns).toHaveLength(1)
    expect(turns[0]?.content).toBe(
      'The customer club terms are these: membership is valid for 12 months from joining.',
    )
    expect(harness.llm.requests).toHaveLength(2)

    const rows = await harness.db.select().from(assistantAnswerLog)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tools).toEqual([{ tool: 'language_check', status: 'ok' }])
  })

  it('shows the first draft, marked, when the second is no better', async () => {
    harness.llm.respondWith(() => ({ ok: true, content: HEBREW }))
    const detail = await ask('What are the customer club terms?')
    const answer = detail.messages.at(-1)?.content ?? ''
    expect(answer).toContain('תנאי מועדון הלקוחות')
    const rows = await harness.db.select().from(assistantAnswerLog)
    expect(rows[0]?.tools).toEqual([{ tool: 'language_check', status: 'failed' }])
  })
})
