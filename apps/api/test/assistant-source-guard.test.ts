import type { ThreadDetail } from '@burgers/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LlmCompletionRequest } from '../src/assistant/llm-client.js'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { assistantAnswerLog } from '../src/db/schema.js'
import { type AnswerAppHarness, createAnswerAppHarness } from './helpers/answer-app.js'

// The source guard, end to end through the HTTP seam (2026-09-17): what the reader is shown, what
// is persisted, and what the log says, when the model names a site it never opened. The detector
// and the loop's review pass have their own unit suites; this one proves they are wired into the
// answer a person actually gets. The draft below is one the live model really wrote.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'

const INVENTED =
  'As of March 30, 2026, according to israelhayom.co.il, VAT in Israel is 18%.\n\nSOURCES: none'
const HONEST =
  'VAT in Israel is 18%. That is from general knowledge, not a source I checked, so it may be out of date.\n\nSOURCES: none'

const wasSentBack = (request: LlmCompletionRequest): boolean =>
  request.messages.some((message) => message.content.startsWith('[Automatic source check'))

describe('assistant: an answer that names a site it never opened', () => {
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

  const logRows = () => harness.db.select().from(assistantAnswerLog)

  it('sends the draft back, and the reader only ever sees the second one', async () => {
    harness.llm.respondWith((request) => ({
      ok: true,
      content: wasSentBack(request) ? HONEST : INVENTED,
    }))
    const detail = await ask('What is the VAT rate in Israel today?')

    const turns = detail.messages.filter((message) => message.role === 'agent')
    expect(turns).toHaveLength(1)
    expect(turns[0]?.content).toBe(
      'VAT in Israel is 18%. That is from general knowledge, not a source I checked, so it may be out of date.',
    )
    expect(harness.llm.requests).toHaveLength(2)

    const rows = await logRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.rounds).toBe(2)
    expect(rows[0]?.tools).toEqual([{ tool: 'source_guard', status: 'ok' }])
  })

  it('cuts the claim and tells the reader, when the second draft is no better', async () => {
    harness.llm.respondWith(() => ({ ok: true, content: INVENTED }))
    const detail = await ask('What is the VAT rate in Israel today?')

    const answer = detail.messages.at(-1)?.content ?? ''
    expect(answer).toContain('As of March 30, 2026, VAT in Israel is 18%.')
    expect(answer).not.toContain('israelhayom')
    expect(answer).toContain('no website was opened for this answer')
    expect(answer).not.toContain('SOURCES:')
    // It is still an answer nothing was looked up for, and is still labelled as one.
    expect(detail.messages.at(-1)?.sources).toMatchObject([{ id: 'general', type: 'general' }])
    expect(harness.llm.requests).toHaveLength(2)

    const rows = await logRows()
    expect(rows[0]?.tools).toEqual([{ tool: 'source_guard', status: 'failed' }])
  })

  it('leaves the same sentence alone when the site really was searched', async () => {
    harness.llm.respondWith(() => ({
      ok: true,
      content: INVENTED,
      citations: [{ url: 'https://www.israelhayom.co.il/vat-2026', title: 'VAT in 2026' }],
    }))
    const detail = await ask('What is the VAT rate in Israel today?')

    expect(detail.messages.at(-1)?.content).toBe(
      'As of March 30, 2026, according to israelhayom.co.il, VAT in Israel is 18%.',
    )
    expect(harness.llm.requests).toHaveLength(1)
    const rows = await logRows()
    expect(rows[0]?.tools).toEqual([{ tool: 'web_search', status: 'ok' }])
  })
})
