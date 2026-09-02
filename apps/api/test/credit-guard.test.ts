import { describe, expect, it, vi } from 'vitest'
import { createCreditGuard } from '../src/assistant/credit-guard.js'

// The prepaid-credit guard (the 2026-08 outage class): production went down when the OpenRouter
// balance crossed zero, because nothing watched it. The guard polls the provider's own credits
// endpoint and raises one alert per crossing below the threshold — re-armed only by recovery, so
// a low balance does not ring every hour, and a top-up followed by a second drain rings again.
// Errors are reported as classes and never throw: a broken poll must not take anything with it.

const balance = (totalCredits: number, totalUsage: number): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ data: { total_credits: totalCredits, total_usage: totalUsage } }),
  }) as Response

const guardWith = (
  fetchImpl: typeof fetch,
  over: { thresholdUsd?: number } = {},
): {
  guard: ReturnType<typeof createCreditGuard>
  alerts: number[]
  errors: string[]
} => {
  const alerts: number[] = []
  const errors: string[] = []
  const guard = createCreditGuard({
    apiKey: 'or-key',
    thresholdUsd: over.thresholdUsd ?? 5,
    alert: async (remainingUsd) => {
      alerts.push(remainingUsd)
    },
    onError: (message) => {
      errors.push(message)
    },
    fetchImpl,
  })
  return { guard, alerts, errors }
}

describe('assistant credit guard — the prepaid-balance poll', () => {
  it('alerts once when the balance crosses below the threshold, not on every poll', async () => {
    const { guard, alerts } = guardWith(vi.fn().mockResolvedValue(balance(35, 31)))
    await guard.checkOnce()
    await guard.checkOnce()
    expect(alerts).toEqual([4])
  })

  it('stays quiet above the threshold and reports the balance it saw', async () => {
    const { guard, alerts } = guardWith(vi.fn().mockResolvedValue(balance(35, 10)))
    await guard.checkOnce()
    expect(alerts).toEqual([])
    expect(guard.status()?.remainingUsd).toBe(25)
  })

  it('re-arms on recovery, so a top-up followed by a second drain alerts again', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(balance(35, 33)) // low: 2
      .mockResolvedValueOnce(balance(65, 33)) // topped up: 32
      .mockResolvedValueOnce(balance(65, 62)) // low again: 3
    const { guard, alerts } = guardWith(fetchImpl)
    await guard.checkOnce()
    await guard.checkOnce()
    await guard.checkOnce()
    expect(alerts).toEqual([2, 3])
  })

  it('sends the bearer key to the provider credits endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(balance(10, 0))
    const { guard } = guardWith(fetchImpl)
    await guard.checkOnce()
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/credits')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer or-key')
  })

  it('reports a failed or malformed poll as a class and never alerts or throws', async () => {
    const rejecting = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const rejected = guardWith(rejecting)
    await rejected.guard.checkOnce()

    const denied = guardWith(vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response))
    await denied.guard.checkOnce()

    const malformed = guardWith(
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response),
    )
    await malformed.guard.checkOnce()

    expect(rejected.alerts).toEqual([])
    expect(denied.alerts).toEqual([])
    expect(malformed.alerts).toEqual([])
    expect(rejected.errors).toHaveLength(1)
    expect(denied.errors[0]).toContain('401')
    expect(malformed.errors).toHaveLength(1)
    expect(rejected.guard.status()).toBeNull()
  })

  it('keeps alerting armed across failed polls', async () => {
    // A poll outage while the balance is fine must not eat the one alert the next real
    // low reading deserves.
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('down'))
      .mockResolvedValueOnce(balance(35, 32)) // low: 3
    const { guard, alerts } = guardWith(fetchImpl)
    await guard.checkOnce()
    await guard.checkOnce()
    expect(alerts).toEqual([3])
  })
})
