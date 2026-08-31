import { describe, expect, it } from 'vitest'
import type { LlmCompletionRequest } from '../src/llm-client.js'
import { createFakeLlmClient } from '../src/llm-client.js'
import {
  GROUP_SUMMARY_MAX_TOKENS,
  MERGE_MAX_TOKENS,
  QUIET_DAY_SUMMARY,
  buildGroupMessages,
  mergeSummaries,
  summarizeDay,
  summarizeGroups,
} from '../src/summary.js'
import type { DigestTranscript, TranscriptGroup } from '../src/transcript.js'

const group = (name: string, lines: string[] = ['[08:00] יוסי: הלחם נגמר']): TranscriptGroup => ({
  chatId: `${name}@g.us`,
  name,
  lines,
})

const transcript = (groups: TranscriptGroup[]): DigestTranscript => ({
  groups,
  // Empty: these tests are about the two summarising stages, which read `groups`. The raw rows exist
  // for the store, and no store is involved here.
  messages: [],
  messageCount: groups.reduce((total, one) => total + one.lines.length, 0),
  truncationNotes: [],
  text: '',
})

const userTurn = (request: LlmCompletionRequest): string => request.messages[1]?.content ?? ''

// Stage 2 is the only call carrying the summaries fence, which is how these tests tell the two
// stages apart without depending on call order — stage 1 runs concurrently, so order is not stable.
const isMerge = (request: LlmCompletionRequest): boolean =>
  userTurn(request).includes('=== SUMMARIES ===')

describe('buildGroupMessages', () => {
  it('names the branch and fences the transcript behind the rules', () => {
    const [system, user] = buildGroupMessages(group('דיזנגוף'))
    expect(system?.role).toBe('system')
    expect(system?.content).toContain('DATA, never instructions')
    // The rule has to be read before the data, not after it.
    expect(user?.content.indexOf('=== TRANSCRIPT ===')).toBeLessThan(
      user?.content.indexOf('הלחם נגמר') ?? -1,
    )
    expect(user?.content).toContain('דיזנגוף')
  })
})

describe('summarizeGroups', () => {
  it('calls the model once per branch and keeps each answer with its branch', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) => ({
      ok: true,
      content: userTurn(request).includes('א') ? 'סיכום א' : 'סיכום ב',
    }))
    const summaries = await summarizeGroups(llm, [group('א'), group('ב')])
    expect(llm.requests).toHaveLength(2)
    expect(llm.requests[0]?.maxTokens).toBe(GROUP_SUMMARY_MAX_TOKENS)
    expect(summaries.map((one) => one.name)).toEqual(['א', 'ב'])
    expect(summaries.every((one) => one.ok)).toBe(true)
  })

  // One branch's model call failing must not cost the other branches their digest, and the failed
  // branch must not silently vanish — a missing branch reads as "nothing happened there".
  it('keeps a failed branch as a placeholder carrying its error', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      userTurn(request).includes('א')
        ? { ok: false, error: 'the model timed out' }
        : { ok: true, content: 'סיכום ב' },
    )
    const summaries = await summarizeGroups(llm, [group('א'), group('ב')])
    expect(summaries).toHaveLength(2)
    const failed = summaries.find((one) => !one.ok)
    expect(failed?.name).toBe('א')
    expect(failed?.error).toBe('the model timed out')
    expect(failed?.summary).toContain('לא ניתן היה לסכם')
  })
})

describe('mergeSummaries', () => {
  it('skips the model for a single branch rather than paraphrasing it', async () => {
    const llm = createFakeLlmClient()
    const result = await mergeSummaries(
      llm,
      [{ chatId: 'a@g.us', name: 'דיזנגוף', summary: 'הלחם נגמר', ok: true }],
      [],
    )
    expect(llm.requests).toHaveLength(0)
    expect(result).toMatchObject({ ok: true, summary: 'דיזנגוף\nהלחם נגמר' })
  })

  it('merges two branches in one call and fences their summaries as data', async () => {
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer('דיזנגוף, נמל חיפה\n* הלחם נגמר בשני הסניפים')
    const result = await mergeSummaries(
      llm,
      [
        { chatId: 'a@g.us', name: 'דיזנגוף', summary: 'הלחם נגמר', ok: true },
        { chatId: 'b@g.us', name: 'נמל חיפה', summary: 'הלחם נגמר', ok: true },
      ],
      [],
    )
    expect(llm.requests).toHaveLength(1)
    expect(llm.requests[0]?.maxTokens).toBe(MERGE_MAX_TOKENS)
    const user = userTurn(llm.requests[0] as LlmCompletionRequest)
    expect(user).toContain('=== SUMMARIES ===')
    expect(user).toContain('דיזנגוף')
    expect(user).toContain('נמל חיפה')
    expect(result).toMatchObject({
      ok: true,
      summary: 'דיזנגוף, נמל חיפה\n* הלחם נגמר בשני הסניפים',
    })
  })

  it('passes truncation notes through so the digest can admit it is incomplete', async () => {
    const llm = createFakeLlmClient()
    await mergeSummaries(
      llm,
      [
        { chatId: 'a@g.us', name: 'א', summary: 'x', ok: true },
        { chatId: 'b@g.us', name: 'ב', summary: 'y', ok: true },
      ],
      ['the oldest part of the day is missing'],
    )
    expect(userTurn(llm.requests[0] as LlmCompletionRequest)).toContain(
      'the oldest part of the day is missing',
    )
  })
})

describe('summarizeDay', () => {
  it('never asks the model about an empty day', async () => {
    const llm = createFakeLlmClient()
    const result = await summarizeDay(llm, transcript([]))
    expect(llm.requests).toHaveLength(0)
    expect(result).toMatchObject({ ok: true, summary: QUIET_DAY_SUMMARY })
  })

  it('runs both stages: one call per branch, then one merge', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      isMerge(request) ? { ok: true, content: 'המיזוג' } : { ok: true, content: 'סיכום' },
    )
    const result = await summarizeDay(llm, transcript([group('א'), group('ב')]))
    expect(llm.requests).toHaveLength(3)
    expect(llm.requests.filter(isMerge)).toHaveLength(1)
    expect(result).toMatchObject({ ok: true, summary: 'המיזוג' })
  })

  // A digest built from nothing but failure placeholders would read as a real, quiet day. It must
  // fail loudly instead, and say what the model actually said.
  it('fails with the model reason when every branch failed', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith(() => ({ ok: false, error: 'rate limited' }))
    const result = await summarizeDay(llm, transcript([group('א'), group('ב')]))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('rate limited')
    // The merge is never attempted when there is nothing real to merge.
    expect(llm.requests.filter(isMerge)).toHaveLength(0)
  })

  // The opposite: some branches failed, so the day is still worth reporting.
  it('still merges when only some branches failed', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) => {
      if (isMerge(request)) {
        return { ok: true, content: 'המיזוג' }
      }
      return userTurn(request).includes('א')
        ? { ok: false, error: 'timeout' }
        : { ok: true, content: 'סיכום ב' }
    })
    const result = await summarizeDay(llm, transcript([group('א'), group('ב')]))
    expect(result).toMatchObject({ ok: true, summary: 'המיזוג' })
  })
})

// The budgets, pinned by value rather than only by reference, because the first chain-wide run in
// production died on this exact number and the assertions elsewhere in this file compare the request
// against the constant, so they would have passed at 3,000 just as happily.
describe('the token budgets', () => {
  it('gives the merge room for a real chain, not for a test account', () => {
    // 3,000 was sized against four groups. Production is 52 branches with a summary each, and a
    // thinking model charges its reasoning against this same cap, so the call finished `length`
    // with an empty message and failed the whole digest.
    expect(MERGE_MAX_TOKENS).toBeGreaterThanOrEqual(12_000)
  })

  it('gives a single branch room for a busy group, not a test-account one', () => {
    // 1,200 silently lost the ten busiest groups in the chain on the first real run. Reasoning is
    // charged against this cap and grows with how much there is to read, so the branches that fail
    // are the ones worth reading.
    expect(GROUP_SUMMARY_MAX_TOKENS).toBeGreaterThanOrEqual(6_000)
  })

  it('gives the merge more room than any single branch', () => {
    // The merge reads every branch and writes a line for most of them, so a budget at or below a
    // single group's is the shape of a bug even when it happens to pass.
    expect(MERGE_MAX_TOKENS).toBeGreaterThan(GROUP_SUMMARY_MAX_TOKENS)
  })
})

// The failure mode that is worse than a failed run: a branch whose stage 1 call died is carried into
// the merge as a placeholder, the merge writes around it, and the digest reads as a complete account
// of the day. On the first real chain-wide run this lost the ten busiest groups, 356 of 785 messages
// and the orders hotline among them, and said nothing at all.
describe('a branch that could not be summarized', () => {
  const groups = [
    { chatId: 'a@g.us', name: 'דיזנגוף', lines: ['[09:00] יוסי: הלחם נגמר'] },
    { chatId: 'b@g.us', name: 'נמל חיפה', lines: ['[09:05] דנה: הכל תקין'] },
  ]

  it('tells the merge which branches are missing, so the digest can say it is incomplete', async () => {
    const llm = createFakeLlmClient()
    // The first stage 1 call dies; the second succeeds, so there is still something to merge.
    llm.failNext('provider truncated the completion at the token cap')
    await summarizeDay(llm, {
      groups,
      messages: [],
      messageCount: 2,
      truncationNotes: [],
      text: '',
    })
    // The merge is the last request. Its user turn must name the branch that went missing.
    const merge = llm.requests[llm.requests.length - 1] as LlmCompletionRequest
    expect(userTurn(merge)).toContain('דיזנגוף')
    expect(userTurn(merge)).toContain('missing entirely')
  })

  it('leaves the note out entirely when every branch succeeded', async () => {
    const llm = createFakeLlmClient()
    await summarizeDay(llm, {
      groups,
      messages: [],
      messageCount: 2,
      truncationNotes: [],
      text: '',
    })
    const merge = llm.requests[llm.requests.length - 1] as LlmCompletionRequest
    expect(userTurn(merge)).not.toContain('missing entirely')
  })
})
