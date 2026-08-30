import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type LlmConfig, createHttpLlmClient } from '../src/llm-client.js'

// The retry loop around the provider call. It exists because a real chain of 56 branches summarised
// through one shared key met a 429 on first contact with production data, and because that key also
// carries the API's assistant traffic — so this job is never the only thing spending the quota.
//
// Timers are faked: the real delays are seconds by design (a scheduled batch can afford to wait,
// and a tight retry is what turns one refusal into a failed run), which is exactly the wait a test
// must not actually sit through.

const CONFIG: LlmConfig = {
  baseUrl: 'https://provider.test/v1',
  model: 'test-model',
  apiKey: 'test-key',
  timeoutMs: 60_000,
  reasoningMaxTokens: null,
}

const REQUEST = { messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 100 }

const ok = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const refused = (status: number, retryAfter?: string): Response =>
  new Response('{}', {
    status,
    headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
  })

// Drive the whole call with fake timers: the client awaits a sleep between attempts, so the promise
// only settles once the pending timer is advanced. Advancing in a loop keeps this independent of how
// many attempts a given case makes.
const runWithTimers = async <T>(start: () => Promise<T>): Promise<T> => {
  const promise = start()
  let settled = false
  void promise.then(() => {
    settled = true
  })
  for (let i = 0; i < 10 && !settled; i += 1) {
    await vi.advanceTimersByTimeAsync(60_000)
  }
  return promise
}

describe('the provider retry loop', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries a 429 and returns the completion that follows', async () => {
    fetchMock.mockResolvedValueOnce(refused(429)).mockResolvedValueOnce(ok('הסיכום'))

    const result = await runWithTimers(() => createHttpLlmClient(CONFIG).complete(REQUEST))

    expect(result).toEqual({ ok: true, content: 'הסיכום' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a 5xx, because the provider having a moment is not our bug', async () => {
    fetchMock.mockResolvedValueOnce(refused(503)).mockResolvedValueOnce(ok('הסיכום'))

    const result = await runWithTimers(() => createHttpLlmClient(CONFIG).complete(REQUEST))

    expect(result).toEqual({ ok: true, content: 'הסיכום' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // The point of the split: a 400 or a 401 would fail identically on every attempt, so retrying it
  // only spends three times as long arriving at the same error — and on a 56-branch run, three times
  // as long on every branch.
  it('does not retry a 400, which would fail the same way forever', async () => {
    fetchMock.mockResolvedValue(refused(400))

    const result = await runWithTimers(() => createHttpLlmClient(CONFIG).complete(REQUEST))

    expect(result).toEqual({ ok: false, error: 'provider responded 400' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after three attempts and reports the last refusal', async () => {
    fetchMock.mockResolvedValue(refused(429))

    const result = await runWithTimers(() => createHttpLlmClient(CONFIG).complete(REQUEST))

    expect(result).toEqual({ ok: false, error: 'provider responded 429' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  // Retry-After is the provider telling us when it will be ready; our own backoff is a guess. When
  // it sends one, it wins.
  it('waits the Retry-After the provider asked for rather than its own backoff', async () => {
    fetchMock.mockResolvedValueOnce(refused(429, '5')).mockResolvedValueOnce(ok('הסיכום'))

    const promise = createHttpLlmClient(CONFIG).complete(REQUEST)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_500)
    await expect(promise).resolves.toEqual({ ok: true, content: 'הסיכום' })
  })

  // A truncated completion is a real answer that arrived cut in half. Retrying it would spend the
  // budget again on a prompt that will truncate again; it is a configuration problem, not a busy
  // provider.
  it('does not retry a truncated completion', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'חצי' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    const result = await runWithTimers(() => createHttpLlmClient(CONFIG).complete(REQUEST))

    expect(result).toEqual({
      ok: false,
      error: 'provider truncated the completion at the token cap',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
