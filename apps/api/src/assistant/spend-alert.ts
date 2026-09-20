import type { OpsAlertCopy } from '../notifications/ops-notifier.js'

// The daily spend alert (2026-09-20). The credit guard (credit-guard.ts) rings when the prepaid
// balance runs low; it says nothing about a day that spends ten times a normal one, which is how
// a runaway loop or one person's abuse would first show. After each answer the day's spend so far
// is read from the answer log, and the answer that carries the day across the threshold rings the
// chain admins once. There is no state to keep: the crossing is read from the log itself
// (before = after minus this answer), so a restart can neither ring twice nor lose the ring, and
// a day that stays under the line costs one small sum query per answer.

export interface SpendAlertConfig {
  log: { spentOnDay(now: Date): Promise<number> }
  // Ring when a day's spend reaches this many dollars.
  thresholdUsd: number
  // The human channel: a push to the chain admins in the server wiring. Awaited so a test can
  // observe it; the notifier itself never rejects.
  alert: (spentUsd: number, thresholdUsd: number) => Promise<void>
  onError?: (message: string) => void
}

export interface SpendAlert {
  // Called after an answer is logged, with what it cost (zero when the provider said nothing).
  // Never throws: the alert must not take an answer down with it.
  afterAnswer(costUsd: number, now: Date): Promise<void>
}

export function spendCrossed(input: {
  before: number
  after: number
  thresholdUsd: number
}): boolean {
  return input.before < input.thresholdUsd && input.after >= input.thresholdUsd
}

const dollars = (amount: number): string => `$${amount.toFixed(2)}`

export function spendAlertCopy(spentUsd: number, thresholdUsd: number): OpsAlertCopy {
  return {
    he: [
      `ההוצאה של העוזר היום עברה ${dollars(thresholdUsd)}: ${dollars(spentUsd)} עד עכשיו.`,
      'כדאי לבדוק מי שואל ומה, לפני שהיתרה נגמרת.',
    ].join(' '),
    en: [
      `Assistant spend today passed ${dollars(thresholdUsd)}: ${dollars(spentUsd)} so far.`,
      'Worth a look at who is asking what, before the balance runs out.',
    ].join(' '),
  }
}

export function createSpendAlert(config: SpendAlertConfig): SpendAlert {
  const report = config.onError ?? ((message: string) => console.error(message))
  return {
    afterAnswer: async (costUsd, now) => {
      if (costUsd <= 0) return
      try {
        const after = await config.log.spentOnDay(now)
        const before = after - costUsd
        if (spendCrossed({ before, after, thresholdUsd: config.thresholdUsd })) {
          await config.alert(after, config.thresholdUsd)
        }
      } catch (error) {
        // Class only, never a payload (ADR-0011).
        const reason = error instanceof Error ? error.name : 'unknown error'
        report(`assistant spend alert: read failed: ${reason}`)
      }
    },
  }
}
