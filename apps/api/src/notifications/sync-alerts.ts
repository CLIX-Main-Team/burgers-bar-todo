import type { OpsAlertCopy, OpsNotifier } from './ops-notifier.js'

// Knowledge-sync failures ring the ops phones (2026-09-02 audit gap): every failure used to be a
// console line on a server nobody watches, so one bad document — or a dead Drive credential —
// could quietly stop the corpus updating chain-wide. The transport is the existing ops notifier
// (the credit guard's channel); what this module owns is the ringing discipline:
//
//   - One ring per document per process. The same broken file is re-reported by every full load
//     and stays broken; the first report is the news, the rest are noise.
//   - Bursts fold into one alert. A full load over a bad corpus fails many documents in seconds,
//     and 38 pushes teach a human to ignore the channel.
//   - Pass failures ride a long cooldown. The sync retries every ~20 minutes by design, and an
//     outage that rings every 20 minutes is an outage muted by its recipient.
export interface SyncAlerts {
  documentError(driveFileId: string, error: unknown): void
  passFailure(error: unknown): void
}

export interface SyncAlertsOptions {
  batchWindowMs?: number
  passCooldownMs?: number
  now?: () => number
}

const DEFAULT_BATCH_WINDOW_MS = 30 * 1000
const DEFAULT_PASS_COOLDOWN_MS = 6 * 60 * 60 * 1000
// Reasons are error classes by discipline (ADR-0011), but cap them anyway — a push body is a
// phone notification, not a stack trace.
const REASON_MAX_CHARS = 140

const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, REASON_MAX_CHARS)

export function createSyncAlerts(
  notifier: OpsNotifier,
  options: SyncAlertsOptions = {},
): SyncAlerts {
  const batchWindowMs = options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS
  const passCooldownMs = options.passCooldownMs ?? DEFAULT_PASS_COOLDOWN_MS
  const now = options.now ?? Date.now

  const alertedDocs = new Set<string>()
  let pending: { count: number; firstReason: string } | null = null
  let timer: NodeJS.Timeout | null = null
  let lastPassAlertAt: number | null = null

  const flush = (): void => {
    timer = null
    if (pending === null) return
    const { count, firstReason } = pending
    pending = null
    const copy: OpsAlertCopy =
      count === 1
        ? {
            he: `סנכרון הידע: מסמך לא נקלט (${firstReason}). בדקו את לשונית הידע.`,
            en: `Knowledge sync: a document failed to ingest (${firstReason}). Check the Knowledge tab.`,
          }
        : {
            he: `סנכרון הידע: ${count} מסמכים לא נקלטו (למשל: ${firstReason}). בדקו את לשונית הידע.`,
            en: `Knowledge sync: ${count} documents failed to ingest (e.g. ${firstReason}). Check the Knowledge tab.`,
          }
    // alertAdmins never rejects by contract; fire-and-forget keeps callers synchronous.
    void notifier.alertAdmins(copy)
  }

  return {
    documentError: (driveFileId, error) => {
      if (alertedDocs.has(driveFileId)) return
      alertedDocs.add(driveFileId)
      pending =
        pending === null
          ? { count: 1, firstReason: reasonOf(error) }
          : { count: pending.count + 1, firstReason: pending.firstReason }
      if (timer === null) {
        timer = setTimeout(flush, batchWindowMs)
        // Never hold the process open for an alert window (mirrors the app's other timers).
        timer.unref?.()
      }
    },

    passFailure: (error) => {
      const at = now()
      if (lastPassAlertAt !== null && at - lastPassAlertAt < passCooldownMs) return
      lastPassAlertAt = at
      const reason = reasonOf(error)
      void notifier.alertAdmins({
        he: `סנכרון מסמכי הידע נכשל (${reason}). המערכת תנסה שוב אוטומטית; אם ההתראה חוזרת — יש בעיה קבועה.`,
        en: `Knowledge sync failed (${reason}). It will retry automatically; a repeat of this alert means a lasting problem.`,
      })
    },
  }
}
