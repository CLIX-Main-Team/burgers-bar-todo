import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpsAlertCopy } from '../src/notifications/ops-notifier.js'
import { createSyncAlerts } from '../src/notifications/sync-alerts.js'

// Sync failures ring a phone (2026-09-02 audit gap): every failure used to be a console line on
// a server nobody watches, so the corpus could quietly stop updating chain-wide. The alerts ride
// the existing ops notifier; what this module owns is the discipline — one ring per document per
// process, bursts folded into one message, pass failures on a cooldown so a 20-minute retry loop
// does not ring every 20 minutes.

const capture = () => {
  const copies: OpsAlertCopy[] = []
  return {
    copies,
    notifier: {
      alertAdmins: async (copy: OpsAlertCopy) => {
        copies.push(copy)
      },
    },
  }
}

describe('createSyncAlerts — document errors', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('folds a burst of document errors into one alert naming the count', async () => {
    const { copies, notifier } = capture()
    const alerts = createSyncAlerts(notifier, { batchWindowMs: 1000 })

    alerts.documentError('doc-1', new Error('could not be read: not a zip'))
    alerts.documentError('doc-2', new Error('visual transcription: failed validation'))
    expect(copies).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1000)
    expect(copies).toHaveLength(1)
    expect(copies[0]?.en).toContain('2 documents')
    expect(copies[0]?.he).toContain('2')
    // The first reason rides along as the example a human can act on.
    expect(copies[0]?.en).toContain('not a zip')
  })

  it('rings once per document per process, however many passes re-report it', async () => {
    const { copies, notifier } = capture()
    const alerts = createSyncAlerts(notifier, { batchWindowMs: 1000 })

    alerts.documentError('doc-1', new Error('could not be read: not a zip'))
    await vi.advanceTimersByTimeAsync(1000)
    alerts.documentError('doc-1', new Error('could not be read: not a zip'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(copies).toHaveLength(1)
  })
})

describe('createSyncAlerts — pass failures', () => {
  it('alerts a failed reconcile pass with the reason, on a cooldown', async () => {
    const { copies, notifier } = capture()
    let at = 0
    const alerts = createSyncAlerts(notifier, { passCooldownMs: 1000, now: () => at })

    alerts.passFailure(new Error('drive responded 500'))
    at = 500
    alerts.passFailure(new Error('drive responded 500'))
    await Promise.resolve()
    expect(copies).toHaveLength(1)
    expect(copies[0]?.en).toContain('drive responded 500')

    at = 1500
    alerts.passFailure(new Error('drive responded 500'))
    await Promise.resolve()
    expect(copies).toHaveLength(2)
  })
})
