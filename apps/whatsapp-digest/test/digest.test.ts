import { beforeEach, describe, expect, it } from 'vitest'
import { createMutableClock } from '../src/clock.js'
import { runDigest } from '../src/digest.js'
import {
  type FakeGreenApiClient,
  type GreenApiJournalMessage,
  createFakeGreenApiClient,
} from '../src/green-api-client.js'
import { type FakeLlmClient, createFakeLlmClient } from '../src/llm-client.js'
import { createNoopDigestStore } from '../src/repository.js'
import { QUIET_DAY_SUMMARY } from '../src/summary.js'

const NOW = new Date('2026-08-27T09:00:00Z')
const STAFF_GROUP = '972500000001-1581234048@g.us'
const RECIPIENT = '972501234567'

let greenApi: FakeGreenApiClient
let llm: FakeLlmClient

const clock = createMutableClock(NOW)

function groupMessage(text: string): GreenApiJournalMessage {
  return {
    idMessage: `msg-${text}`,
    timestamp: Math.floor(NOW.getTime() / 1000) - 3600,
    typeMessage: 'textMessage',
    chatId: STAFF_GROUP,
    direction: 'incoming',
    senderName: 'יוסי',
    textMessage: text,
  }
}

// The no-op store keeps these tests about the RUN rather than about persistence: the store is a
// capability the job works without, and that is exactly the configuration exercised here.
const store = createNoopDigestStore()
const run = (recipient: string) =>
  runDigest({ greenApi, llm, clock, store, model: 'test-model' }, { recipient })

beforeEach(() => {
  greenApi = createFakeGreenApiClient()
  llm = createFakeLlmClient()
  clock.set(NOW)
  greenApi.setChats([{ id: STAFF_GROUP, name: 'דיזנגוף - צוות', type: 'group' }])
  greenApi.setIncoming([groupMessage('הלחם נגמר')])
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
      // The point of the preflight: no work is attempted past it.
      expect(greenApi.calls.lastIncomingMessages).toBe(0)
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

  it('warns but continues when outgoing notifications are off', async () => {
    greenApi.setSettings({ outgoingMessageWebhook: 'no' })
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    expect(result.warnings.join(' ')).toContain('outgoing')
  })
})

describe('degraded reads', () => {
  it('still produces a digest when the chat list cannot be read', async () => {
    greenApi.failNext('getChats')
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messageCount).toBe(1)
    expect(result.warnings.join(' ')).toContain('chat list')
  })

  it('still produces a digest when only the outgoing journal fails', async () => {
    greenApi.failNext('lastOutgoingMessages')
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messageCount).toBe(1)
    expect(result.warnings.join(' ')).toContain('outgoing')
  })

  it('fails when the incoming journal fails, rather than summarizing half a day', async () => {
    greenApi.failNext('lastIncomingMessages')
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('journals')
    expect(greenApi.sent).toHaveLength(0)
  })
})

describe('summarizing', () => {
  it('does not ask the model about a day with no messages', async () => {
    greenApi.setIncoming([])
    const result = await run(RECIPIENT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(llm.requests).toHaveLength(0)
    expect(result.message).toContain(QUIET_DAY_SUMMARY)
  })

  it('folds a model failure to a result and sends nothing', async () => {
    llm.failNext()
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
