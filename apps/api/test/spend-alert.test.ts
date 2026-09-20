import { describe, expect, it } from 'vitest'
import { createSpendAlert, spendAlertCopy, spendCrossed } from '../src/assistant/spend-alert.js'

// The daily spend alert (2026-09-20). The credit guard rings when the prepaid balance runs low; it
// says nothing about a day that spends ten times a normal one, which is how a runaway or an abuse
// would first show. After each answer the day's spend so far is read from the answer log, and the
// answer that carries the day across the threshold rings the chain admins once. No state: the
// crossing is read from the log itself, so a restart cannot ring twice or lose the ring.

const NOON = new Date('2026-09-20T09:00:00.000Z')

const alertWith = (spentOnDay: (now: Date) => Promise<number>, thresholdUsd = 3) => {
  const rings: { spentUsd: number; thresholdUsd: number }[] = []
  const errors: string[] = []
  const alert = createSpendAlert({
    log: { spentOnDay },
    thresholdUsd,
    alert: async (spentUsd, threshold) => {
      rings.push({ spentUsd, thresholdUsd: threshold })
    },
    onError: (message) => errors.push(message),
  })
  return { alert, rings, errors }
}

describe('spendCrossed: the answer that carries the day over the line', () => {
  it('is the one whose cost moves the total from below to at or above the threshold', () => {
    expect(spendCrossed({ before: 2.9, after: 3.02, thresholdUsd: 3 })).toBe(true)
    expect(spendCrossed({ before: 2.99, after: 3, thresholdUsd: 3 })).toBe(true)
    expect(spendCrossed({ before: 1, after: 1.04, thresholdUsd: 3 })).toBe(false)
    expect(spendCrossed({ before: 3.5, after: 3.54, thresholdUsd: 3 })).toBe(false)
  })
})

describe('createSpendAlert: after each answer', () => {
  it('rings once, on the answer that crosses the threshold, with the day so far', async () => {
    let spent = 0
    const { alert, rings } = alertWith(async () => spent)
    for (const cost of [1.2, 1.5, 0.4, 0.5]) {
      spent += cost
      await alert.afterAnswer(cost, NOON)
    }
    expect(rings).toEqual([{ spentUsd: 3.1, thresholdUsd: 3 }])
  })

  it('stays quiet under the threshold and for an answer that reported no cost', async () => {
    const { alert, rings } = alertWith(async () => 1)
    await alert.afterAnswer(0.5, NOON)
    await alert.afterAnswer(0, NOON)
    expect(rings).toEqual([])
  })

  it('reads the day of the answer, so the window follows the clock', async () => {
    const seen: Date[] = []
    const { alert } = alertWith(async (now) => {
      seen.push(now)
      return 0
    })
    await alert.afterAnswer(0.1, NOON)
    expect(seen).toEqual([NOON])
  })

  it('reports a failed read as a class and never throws into the answer path', async () => {
    const { alert, rings, errors } = alertWith(async () => {
      throw new Error('connection reset')
    })
    await expect(alert.afterAnswer(0.5, NOON)).resolves.toBeUndefined()
    expect(rings).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Error')
    expect(errors[0]).not.toContain('connection reset')
  })
})

describe('spendAlertCopy: what the admins read', () => {
  it('names the threshold and the day so far in both languages, in dollars', () => {
    const copy = spendAlertCopy(3.1, 3)
    expect(copy.en).toContain('$3.00')
    expect(copy.en).toContain('$3.10')
    expect(copy.he).toContain('$3.10')
  })
})
