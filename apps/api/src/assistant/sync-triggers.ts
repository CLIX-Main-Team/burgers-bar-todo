import type { Clock } from '../auth/clock.js'
import type { KnowledgeSyncService } from './knowledge-sync.js'

// The three usage-driven triggers that keep the knowledge cache current without leaning on a
// fragile Drive push channel (ADR-0014). All three drive the one single-flight reconciliation
// pass from the foundation (#87), so a shift-open crowd of concurrent logins, the backstop poll,
// and a manual resync collapse onto one sync in flight — Drive is walked once. The `changes.watch`
// push webhook is deferred as an additive fast-follow over this same cursor and function.

// The backstop poll interval: the low-frequency window that catches an edit made during a
// long-lived session that no login refreshed (~20 minutes, ADR-0014). Measured against the
// injected clock, never wall-clock, so the firing is deterministic under test.
export const BACKSTOP_POLL_INTERVAL_MS = 20 * 60 * 1000

// Where the login trigger reports the one failure it must swallow: a fire-and-forget reconcile
// that rejected because Drive was unavailable. Defaults to a no-op; the running server passes a
// logger so a broken Drive is visible in logs, and the tests pass a collector to prove the
// rejection was isolated from the login path rather than surfaced on it.
export type SyncErrorReporter = (error: unknown) => void

export interface SyncTriggers {
  // Fire-and-forget reconcile on a successful login (ADR-0014): kicks the single-flight sync and
  // returns immediately without awaiting, so a slow Drive never delays sign-in and a failing Drive
  // never fails it. Any rejection is caught and reported through the error reporter, never
  // propagated — the caller must not await this, and there is nothing to await.
  onLogin(): void
  // The manual "resync now" action (ADR-0014): awaited, so the resync endpoint answers only once
  // the cache is reconciled and a just-changed doc is answerable. Coalesces with any sync already
  // in flight (single-flight), so a resync during a login rush does not walk Drive a second time.
  resyncNow(): Promise<void>
  // The backstop tick: consult the injected clock and, if at least the poll interval has elapsed
  // since the last backstop reconcile, reconcile and reset the window — otherwise a no-op. The
  // running server drives this from a real timer (setInterval); a test advances the mutable clock
  // and calls it directly, so the ~20-minute firing is exercised without waiting or a real timer.
  pollBackstop(): Promise<void>
}

export interface SyncTriggersOptions {
  // Override the backstop interval; defaults to BACKSTOP_POLL_INTERVAL_MS. Tests keep the real
  // interval and advance the injected clock across it rather than shrinking it.
  backstopIntervalMs?: number
  // Sink for a swallowed login-sync rejection; defaults to a no-op.
  onError?: SyncErrorReporter
}

export function createSyncTriggers(
  syncService: KnowledgeSyncService,
  clock: Clock,
  options: SyncTriggersOptions = {},
): SyncTriggers {
  const intervalMs = options.backstopIntervalMs ?? BACKSTOP_POLL_INTERVAL_MS
  const reportError = options.onError ?? (() => {})

  // The start of the current backstop window. Seeded at creation so the first backstop fires a
  // full interval after boot, not immediately: login already covers a fresh session, and the
  // backstop only exists to catch edits made during a long-lived one.
  let lastBackstopRun = clock.now()

  return {
    onLogin: () => {
      // Fire-and-forget: do not await, and catch-then-report any rejection, so a broken or slow
      // Drive is fully isolated from the login response. Without the catch a rejected reconcile
      // would surface as an unhandled rejection; the caller stays oblivious either way.
      syncService.reconcile().catch(reportError)
    },

    resyncNow: () => syncService.reconcile(),

    pollBackstop: async () => {
      const now = clock.now()
      if (now.getTime() - lastBackstopRun.getTime() < intervalMs) {
        return
      }
      // Advance the window before awaiting the pass: a backstop that fails waits a full interval
      // before retrying rather than spinning, and a slow pass does not stack overlapping backstops.
      lastBackstopRun = now
      await syncService.reconcile()
    },
  }
}
