import type { Clock } from '../auth/clock.js'
import type { KnowledgeSyncService } from './knowledge-sync.js'

// The interval trigger that keeps the knowledge cache current on a fixed cadence (ADR-0021, which
// reverses ADR-0014's login-triggered model). It drives the one single-flight reconciliation pass
// from the foundation (#87), so the boot fire and the first interval tick collapse onto one sync in
// flight — Drive is walked once. The `changes.watch` push webhook is deferred as an additive
// fast-follow over this same cursor and function.

// The interval trigger's period: the cadence the running server's timer reconciles on (~20 minutes,
// ADR-0021). Measured against the injected clock, never wall-clock, so the firing is deterministic
// under test.
export const BACKSTOP_POLL_INTERVAL_MS = 20 * 60 * 1000

export interface SyncTriggers {
  // The manual "resync now" action (ADR-0014): awaited, so the resync endpoint answers only once
  // the cache is reconciled and a just-changed doc is answerable. Coalesces with any sync already
  // in flight (single-flight), so a resync during an interval tick does not walk Drive a second
  // time. The endpoint that calls it is a deferred fast-follow (ADR-0021); the trigger stands ready.
  resyncNow(): Promise<void>
  // The interval tick: consult the injected clock and, if at least the poll interval has elapsed
  // since the last reconcile, reconcile and reset the window — otherwise a no-op. The running
  // server drives this from a real timer (setInterval); a test advances the mutable clock and
  // calls it directly, so the ~20-minute firing is exercised without waiting or a real timer.
  pollBackstop(): Promise<void>
}

export interface SyncTriggersOptions {
  // Override the interval; defaults to BACKSTOP_POLL_INTERVAL_MS. Tests keep the real interval and
  // advance the injected clock across it rather than shrinking it.
  backstopIntervalMs?: number
}

export function createSyncTriggers(
  syncService: KnowledgeSyncService,
  clock: Clock,
  options: SyncTriggersOptions = {},
): SyncTriggers {
  const intervalMs = options.backstopIntervalMs ?? BACKSTOP_POLL_INTERVAL_MS

  // The start of the current interval window. Seeded at creation so the first interval tick fires a
  // full interval after boot, not immediately — the server's boot fire already covers startup, and
  // the interval only exists to catch edits made afterwards during a long-lived process.
  let lastBackstopRun = clock.now()

  return {
    resyncNow: () => syncService.reconcile(),

    pollBackstop: async () => {
      const now = clock.now()
      if (now.getTime() - lastBackstopRun.getTime() < intervalMs) {
        return
      }
      // Advance the window before awaiting the pass: an interval tick that fails waits a full
      // interval before retrying rather than spinning, and a slow pass does not stack overlapping ticks.
      lastBackstopRun = now
      await syncService.reconcile()
    },
  }
}
