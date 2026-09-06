import { beforeEach, describe, expect, it } from 'vitest'
import { createMutableClock } from '../src/clock.js'
import type { DigestResult, DigestSuccess } from '../src/digest.js'
import { type FakeGreenApiClient, createFakeGreenApiClient } from '../src/green-api-client.js'
import {
  ACKNOWLEDGEMENT,
  COOLDOWN_MS,
  COOLDOWN_REPLY,
  FAILURE_REPLY,
  UNAVAILABLE_REPLY,
  handleSummaryRequest,
} from '../src/on-demand.js'
import { type FakeDigestStore, createFakeDigestStore } from '../src/repository.js'

// Summaries asked for with the keyword (0040). The property every test here defends is the one the
// module is built around: whoever types the keyword gets an answer, on every path, including the
// paths where no summary was produced. Silence reads as a broken keyword and gets typed again.

const NOW = new Date('2026-09-06T13:00:00Z')
const GROUP = '120363411373854384@g.us'
const REQUEST = {
  idMessage: 'REQ1',
  chatId: GROUP,
  requestedBy: '972500000002@c.us',
  requestedAt: new Date(NOW.getTime() - 5_000),
}

const clock = createMutableClock(NOW)
let greenApi: FakeGreenApiClient
let store: FakeDigestStore
let ran: string[]

const success = (): DigestSuccess => ({
  ok: true,
  window: { fromSeconds: 0, toSeconds: 0, minutes: 0 },
  groupCount: 3,
  messageCount: 12,
  truncationNotes: [],
  warnings: [],
  message: 'the digest',
  delivery: { status: 'queued', idMessage: 'SENT1' },
})

const skipped = (reason: string): DigestResult => ({
  ...success(),
  delivery: { status: 'skipped', reason },
})

const failure = (): DigestResult => ({
  ok: false,
  stage: 'summary',
  error: 'the model timed out',
  warnings: [],
})

const deps = (run: (chatId: string) => Promise<DigestResult>) => ({
  store,
  greenApi,
  clock,
  log: () => {},
  run: async (chatId: string) => {
    ran.push(chatId)
    return run(chatId)
  },
})

const texts = (): string[] => greenApi.sent.map((sent) => sent.message)
const says = (needle: string): boolean => texts().some((text) => text.includes(needle))

beforeEach(() => {
  greenApi = createFakeGreenApiClient()
  store = createFakeDigestStore()
  clock.set(NOW)
  ran = []
})

describe('with nothing waiting', () => {
  it('does nothing at all, which is almost every tick', async () => {
    expect(await handleSummaryRequest(deps(async () => success()))).toBe('idle')
    expect(greenApi.sent).toHaveLength(0)
    expect(ran).toHaveLength(0)
  })
})

describe('answering a request', () => {
  beforeEach(() => {
    store.seedRequest(REQUEST)
  })

  it('acknowledges BEFORE running, because the run can take minutes', async () => {
    await handleSummaryRequest(
      deps(async () => {
        // Asserted from inside the run: by the time the work starts, the reply is already out.
        expect(says(ACKNOWLEDGEMENT)).toBe(true)
        return success()
      }),
    )

    expect(ran).toHaveLength(1)
  })

  it('answers in the chat that asked, not wherever the digest is configured to go', async () => {
    await handleSummaryRequest(deps(async () => success()))

    expect(ran).toEqual([GROUP])
    expect(greenApi.sent.every((sent) => sent.chatId === GROUP)).toBe(true)
  })

  it('closes the request as done', async () => {
    expect(await handleSummaryRequest(deps(async () => success()))).toBe('answered')

    expect(store.finished).toEqual([{ idMessage: 'REQ1', outcome: 'done', error: null }])
  })

  it('lays the acknowledgement out right to left like everything else we send', async () => {
    await handleSummaryRequest(deps(async () => success()))

    expect(texts()[0]?.startsWith('\u200F')).toBe(true)
  })
})

describe('when the run produces nothing', () => {
  beforeEach(() => {
    store.seedRequest(REQUEST)
  })

  // The commonest cause is the off switch, which is an ordinary state. From the asker's side it is
  // indistinguishable from a hang unless we say so.
  it('still replies when the digest was built but not sent', async () => {
    const outcome = await handleSummaryRequest(
      deps(async () => skipped('the digest is switched off')),
    )

    expect(outcome).toBe('unavailable')
    expect(says(UNAVAILABLE_REPLY)).toBe(true)
    expect(store.finished[0]?.outcome).toBe('skipped')
  })

  it('still replies when the run fails outright', async () => {
    const outcome = await handleSummaryRequest(deps(async () => failure()))

    expect(outcome).toBe('failed')
    expect(says(FAILURE_REPLY)).toBe(true)
    expect(store.finished[0]?.outcome).toBe('failed')
    // The reason stays on the row rather than going to the group: the asker gets a plain apology,
    // the operator gets the stage and the error.
    expect(store.finished[0]?.error).toContain('the model timed out')
  })

  it('never leaves a claimed request open, whatever happened', async () => {
    await handleSummaryRequest(deps(async () => failure()))

    // A row left 'running' blocks every future request until the reclaim window expires.
    expect(store.finished).toHaveLength(1)
  })
})

describe('the cooldown', () => {
  beforeEach(() => {
    store.seedRequest(REQUEST)
  })

  it('refuses a request too soon after the last summary, and says so', async () => {
    store.setLastManualRunAt(new Date(NOW.getTime() - 10 * 60_000))

    const outcome = await handleSummaryRequest(deps(async () => success()))

    expect(outcome).toBe('cooling-down')
    expect(ran).toHaveLength(0)
    // Told, not ignored. A silent refusal reads as a broken keyword and gets typed again at once.
    expect(says(COOLDOWN_REPLY)).toBe(true)
    expect(store.finished[0]?.outcome).toBe('skipped')
    // The chat is told no number, so the row has to carry one or nobody can tell a cooldown refusal
    // from any other skip.
    expect(store.finished[0]?.error).toContain('20m')
  })

  it('does not send the acknowledgement for a request it is refusing', async () => {
    store.setLastManualRunAt(new Date(NOW.getTime() - 60_000))

    await handleSummaryRequest(deps(async () => success()))

    expect(says(ACKNOWLEDGEMENT)).toBe(false)
    expect(greenApi.sent).toHaveLength(1)
  })

  it('lets a request through once the window has passed', async () => {
    store.setLastManualRunAt(new Date(NOW.getTime() - COOLDOWN_MS - 1_000))

    expect(await handleSummaryRequest(deps(async () => success()))).toBe('answered')
    expect(ran).toHaveLength(1)
  })

  it('lets the very first request through, since there is nothing to cool down from', async () => {
    store.setLastManualRunAt(null)

    expect(await handleSummaryRequest(deps(async () => success()))).toBe('answered')
  })
})

describe('when the gateway will not take our reply', () => {
  beforeEach(() => {
    store.seedRequest(REQUEST)
  })

  // A failed acknowledgement must not abandon a claimed request: the row would sit 'running' and
  // block everything behind it until the reclaim window expired.
  it('runs the summary anyway and still closes the request', async () => {
    greenApi.failNext('sendMessage', 'rate limited')

    expect(await handleSummaryRequest(deps(async () => success()))).toBe('answered')
    expect(ran).toHaveLength(1)
    expect(store.finished[0]?.outcome).toBe('done')
  })
})
