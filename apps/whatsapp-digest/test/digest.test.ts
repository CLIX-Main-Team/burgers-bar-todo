import { beforeEach, describe, expect, it } from 'vitest'
import { createMutableClock } from '../src/clock.js'
import { runDigest, splitForWhatsapp } from '../src/digest.js'
import {
  type FakeGreenApiClient,
  type GreenApiJournalMessage,
  createFakeGreenApiClient,
} from '../src/green-api-client.js'
import { type FakeLlmClient, createFakeLlmClient } from '../src/llm-client.js'
import {
  type FakeDigestStore,
  type StoredMessage,
  createFakeDigestStore,
} from '../src/repository.js'
import { QUIET_DAY_SUMMARY } from '../src/summary.js'

const NOW = new Date('2026-08-27T09:00:00Z')
const STAFF_GROUP = '972500000001-1581234048@g.us'
const RECIPIENT = '972501234567'

let greenApi: FakeGreenApiClient
let llm: FakeLlmClient
let store: FakeDigestStore

const clock = createMutableClock(NOW)

// A stored row as the webhook would have written it an hour before the run. The digest reads its day
// out of the store now, so the day is SEEDED rather than scripted onto the gateway.
function storedMessage(text: string): StoredMessage {
  return {
    idMessage: `msg-${text}`,
    chatId: STAFF_GROUP,
    senderId: '972500000002@c.us',
    senderName: 'יוסי',
    typeMessage: 'textMessage',
    textMessage: text,
    caption: null,
    fileName: null,
    direction: 'incoming',
    sentAt: new Date(NOW.getTime() - 3_600_000),
  }
}

const run = (recipient: string) =>
  runDigest({ greenApi, llm, clock, store, model: 'test-model' }, { recipient })

beforeEach(() => {
  greenApi = createFakeGreenApiClient()
  llm = createFakeLlmClient()
  store = createFakeDigestStore()
  clock.set(NOW)
  store.seedChats([{ chatId: STAFF_GROUP, name: 'דיזנגוף - צוות' }])
  store.seed([storedMessage('הלחם נגמר')])
  llm.setDefaultAnswer('סיכום הבדיקה')
})

describe('preflight', () => {
  it('stops on an unauthorized instance instead of reporting an empty day', () => {
    greenApi.setState('notAuthorized')
    return run(RECIPIENT).then((result) => {
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.stage).toBe('preflight')
      expect(result.error).toContain('notAuthorized')
      // The point of the preflight: no work is attempted past it. The digest reads its day from the
      // store now, so "no work" is measured on the model and the send, not on a journal call.
      expect(llm.requests).toHaveLength(0)
      expect(greenApi.sent).toHaveLength(0)
    })
  })

  it('names the phone when the instance is asleep', async () => {
    greenApi.setState('sleepMode')
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('phone')
  })

  it('refuses to run with the incoming journal switched off', async () => {
    // With incomingWebhook off the journals answer 200 with an empty array forever, so a digest
    // would confidently report silence every single morning.
    greenApi.setSettings({ incomingWebhook: 'no' })
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('preflight')
    expect(greenApi.sent).toHaveLength(0)
  })

  // The failure this replaces the old journal checks with. Nothing fills the database unless the
  // gateway is posting somewhere, and a digest that cannot tell "nobody configured the webhook" from
  // "nobody talked" would reassure everyone every morning forever.
  it('refuses to run when no webhook is configured to feed the database', async () => {
    greenApi.setSettings({ webhookUrl: '' })
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('preflight')
    expect(result.error).toContain('webhookUrl')
    expect(greenApi.sent).toHaveLength(0)
  })

  it('warns when the gateway is posting somewhere other than this deployment', async () => {
    greenApi.setSettings({ webhookUrl: 'https://somebody-else.test/hook' })
    const result = await runDigest(
      { greenApi, llm, clock, store, model: 'test-model' },
      { recipient: RECIPIENT, expectedWebhookUrl: 'https://ours.test/whatsapp/webhook' },
    )
    expect(result.ok).toBe(true)
    expect(result.warnings.join(' ')).toContain('not the one this deployment expects')
  })
})

describe('reading the day from the store', () => {
  it('still produces a digest when the group has no name on record', async () => {
    store.seedChats([])
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The messages survive; only the label is lost, which is the whole point of deciding membership
    // on the chatId rather than on the directory.
    expect(result.messageCount).toBe(1)
    expect(result.message).toContain('קבוצה ללא שם')
  })

  it('fails loudly when the database cannot be read, rather than reporting a quiet day', async () => {
    store.failReads('57P01')
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('journals')
    // The SQLSTATE, never a row's contents.
    expect(result.error).toContain('57P01')
    expect(greenApi.sent).toHaveLength(0)
  })

  // The distinction the whole `| null` return exists for: a store that cannot read at all is not an
  // empty day, and collapsing the two is how a broken pipeline congratulates itself every morning.
  it('refuses to summarize when there is no store to read from', async () => {
    store.cannotRead()
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('journals')
    expect(result.error).toContain('DATABASE_URL')
    expect(llm.requests).toHaveLength(0)
  })
})

describe('summarizing', () => {
  it('does not ask the model about a day with no messages', async () => {
    store.seed([])
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(llm.requests).toHaveLength(0)
    expect(result.message).toContain(QUIET_DAY_SUMMARY)
  })

  it('recovers a branch the first call could not read, rather than losing it', async () => {
    // One failure is what a token cap looks like, and it used to cost the branch. The ladder now
    // sends it to the second model, so the day is complete and the run is a success.
    llm.failNext()
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(greenApi.sent).toHaveLength(1)
  })

  it('folds a total model outage to a result and sends nothing', async () => {
    // Every rung refused: not a hard branch, a provider that is not answering. There is nothing left
    // to try and the run has to say so rather than send a digest built from placeholders.
    llm.respondWith(() => ({ ok: false, error: 'provider unavailable' }))
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('summary')
    expect(greenApi.sent).toHaveLength(0)
  })

  it('fences the transcript as data inside the prompt', async () => {
    await run(RECIPIENT)
    const request = llm.requests[0]
    expect(request).toBeDefined()
    const user = request?.messages.find((turn) => turn.role === 'user')
    expect(user?.content).toContain('TRANSCRIPT')
    expect(user?.content).toContain('הלחם נגמר')
  })
})

describe('sending', () => {
  it('sends one message to the recipient as a private chat', async () => {
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(greenApi.sent).toHaveLength(1)
    expect(greenApi.sent[0]?.chatId).toBe(`${RECIPIENT}@c.us`)
    expect(result.delivery.status).toBe('queued')
  })

  it('builds the digest but sends nothing when the recipient is blank', async () => {
    const result = await run('')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Every prior step still ran — this is what makes the blank state a real rehearsal.
    expect(result.messageCount).toBe(1)
    expect(llm.requests).toHaveLength(1)
    // And the structural proof that nothing left.
    expect(greenApi.sent).toHaveLength(0)
    expect(greenApi.calls.sendMessage).toBe(0)
    expect(result.delivery.status).toBe('skipped')
  })

  it('reports a refused send instead of throwing', async () => {
    greenApi.failNext('sendMessage')
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('send')
  })

  it('dates the digest header in Jerusalem local time', async () => {
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toContain('27/08/2026')
  })
})

// The off switch (migration 0037). What matters here is not that it stops the run — it is WHERE it
// stops it: after the cheap half, so a switched-off deployment still proves every morning that the
// webhook is filling the database, and before the paid half, so it proves it for nothing.
describe('the off switch', () => {
  it('asks for no summaries and sends nothing when it is off', async () => {
    store.setSwitch({ enabled: false, note: 'off until a recipient exists' })
    const result = await run(RECIPIENT)
    // A success, not a failure. Nothing went wrong; a switched-off job did what it was told.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(llm.requests).toHaveLength(0)
    expect(greenApi.sent).toHaveLength(0)
    expect(result.delivery.status).toBe('skipped')
    // The note travels all the way to the operator, which is the whole reason the column exists.
    expect(result.delivery.status === 'skipped' && result.delivery.reason).toContain(
      'off until a recipient exists',
    )
  })

  it('still counts the day, which is the only proof the webhook is still feeding us', async () => {
    store.setSwitch({ enabled: false, note: null })
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messageCount).toBe(1)
    expect(result.groupCount).toBe(1)
  })

  it('writes no digest row, because a switched-off day did not produce one', async () => {
    store.setSwitch({ enabled: false, note: null })
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // An empty string rather than a placeholder: a row saying "" would be read later as a day that
    // genuinely had nothing to report.
    expect(result.message).toBe('')
    expect(store.digests).toHaveLength(0)
  })

  it('treats a store with no switch to read as off, never as on', async () => {
    store.setSwitch(null)
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(llm.requests).toHaveLength(0)
    expect(greenApi.sent).toHaveLength(0)
  })

  it('runs the whole pipeline when it is on', async () => {
    store.setSwitch({ enabled: true, note: null })
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(llm.requests.length).toBeGreaterThan(0)
    expect(greenApi.sent).toHaveLength(1)
  })
})

// The operator's half of the same problem. The digest's own closing line says it is incomplete, but
// that line is written by a model; the count has to come from us, and it has to survive a stage 2
// failure, because a failed merge does not make the lost branches less lost.
describe('what a hard day costs', () => {
  it('tells the operator which branches needed more than one call, and that it cost more', async () => {
    store.seedChats([
      { chatId: STAFF_GROUP, name: 'דיזנגוף - צוות' },
      { chatId: '972500000009-1@g.us', name: 'מוקד הזמנות' },
    ])
    store.seed([
      storedMessage('הלחם נגמר'),
      { ...storedMessage('בון 98 מאחר'), idMessage: 'm2', chatId: '972500000009-1@g.us' },
    ])
    llm.failNext('provider truncated the completion at the token cap')
    const result = await run(RECIPIENT)
    // The bill lands on the operator, because the digest is not allowed to hedge about itself.
    expect(result.warnings.join(' ')).toMatch(/cost more than an ordinary day/)
    // Named, not just counted: "one branch was expensive" does not tell you which one to look at.
    expect(result.warnings.join(' ')).toMatch(/דיזנגוף|מוקד הזמנות/)
  })

  it('says nothing at all on a day where every branch went through first time', async () => {
    const result = await run(RECIPIENT)
    expect(result.warnings.join(' ')).not.toMatch(/cost more/)
  })
})

// The last silent-loss path in the pipeline. The digest used to be sliced at WhatsApp's 20,000
// character limit with nothing anywhere saying so, on the reasoning that the token budget kept it
// far below. That stopped being true when the merge was told to be complete: the budget is 48,000
// tokens and a measured day already produces 12,996 characters.
describe('a briefing too long for one WhatsApp message', () => {
  it('splits on line boundaries and keeps every character', () => {
    const lines = Array.from({ length: 400 }, (_, index) => `* שורה מספר ${index} עם קצת טקסט נוסף`)
    const text = lines.join('\n')
    const parts = splitForWhatsapp(text, 2_000)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(2_000)
    }
    // Nothing lost and nothing reordered: the parts rejoin into exactly what went in.
    expect(parts.join('\n')).toBe(text)
  })

  it('leaves a briefing that already fits completely alone', () => {
    expect(splitForWhatsapp('קצר', 2_000)).toEqual(['קצר'])
  })

  it('cuts a single over-long line rather than dropping it', () => {
    // Should never happen, the merge writes bullets. Handled because "cannot happen" is how the
    // last three limits in this job were described.
    const parts = splitForWhatsapp('א'.repeat(50), 20)
    expect(parts.join('')).toBe('א'.repeat(50))
    expect(parts).toHaveLength(3)
  })

  it('sends every part and tells the operator it took more than one', async () => {
    // A day whose branch summaries are long enough to push the digest past one message.
    store.seedChats([{ chatId: STAFF_GROUP, name: 'דיזנגוף - צוות' }])
    store.seed([storedMessage('הלחם נגמר')])
    llm.setDefaultAnswer('שורה\n'.repeat(9_000))
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(greenApi.sent.length).toBeGreaterThan(1)
    expect(result.warnings.join(' ')).toMatch(/went as \d+ messages/)
    // The stored digest is the WHOLE briefing, not the first message.
    expect(store.digests[0]?.message.length).toBeGreaterThan(20_000)
  })
})
