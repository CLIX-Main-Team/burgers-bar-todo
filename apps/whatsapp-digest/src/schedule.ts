import type { Clock } from './clock.js'
import type { FiredState } from './fired-state.js'
import { type JerusalemWallClock, SATURDAY, jerusalemWallClock } from './jerusalem-time.js'

// The daily fire (ADR-0026). A plain wall-clock poll rather than a cron library: the whole schedule
// is "once per Jerusalem local day, at or after this local hour", and expressing that against the
// local calendar date is what makes it survive Israel's two DST changeovers. A "next fire = now +
// 24h" timer drifts an hour on each of them and eventually fires at the wrong time of day; asking
// what the local clock says instead cannot.

// How often the local clock is consulted. A minute is far finer than a daily schedule needs, which is
// the point: it keeps the fire close to the top of the hour without a long sleep that would swallow a
// clock jump, a suspend, or a DST shift.
export const SCHEDULE_TICK_MS = 60_000

// Whether the digest is due. Deliberately `>=` rather than `===`: a container that was down, being
// deployed, or crash-looping at the fire hour comes back and still sends today's digest instead of
// silently skipping the day. The date comparison is what stops that same forgiveness from resending
// a digest that already went out, so the two halves only work together.
export function isDigestDue(
  wall: JerusalemWallClock,
  fireHour: number,
  lastFiredDate: string | null,
): boolean {
  return wall.hour >= fireHour && wall.date !== lastFiredDate
}

// Saturday. The chain is closed for Shabbat and nobody wants a briefing landing on their phone in
// the middle of it, so the scheduled digest skips the day outright: no model calls, no cost. The
// keyword path never consults the scheduler, which is what "manual still works" rests on.
export const isRestDay = (wall: JerusalemWallClock): boolean => wall.weekday === SATURDAY

// The second chance (#432): every five minutes, twelve times, so a day whose 08:00 run failed keeps
// trying until 09:00. On 2026-10-21 one dropped connection to the gateway at 08:00 cost the whole
// day, and the gateway was answering again by 08:11. Five minutes rather than one, because a gateway
// that is down is usually still down a minute later, and an hour rather than the day, because a
// briefing that lands at noon is no longer the morning briefing.
export const DIGEST_RETRY_INTERVAL_MS = 5 * 60_000
export const DIGEST_RETRY_COUNT = 12

// One attempt at the day's digest.
export interface ScheduledAttempt {
  // The instant of the day's FIRST attempt, and every retry carries the same one, so a retry reads
  // the same 24 hours the first attempt would have: nothing falls between today's digest and
  // tomorrow's, and nothing lands in both.
  firedAt: Date
  // 0 for the first attempt, then 1 to DIGEST_RETRY_COUNT.
  retry: number
}

// What the run reports back. 'retry' only for a failure that cost nothing and reached nobody; the
// run knows where it failed, the scheduler does not, so the run decides.
export type RunOutcome = 'done' | 'retry'

export interface ScheduleOptions {
  clock: Clock
  firedState: FiredState
  fireHour: number
  // Awaited, so a slow run cannot overlap the next tick. Its failures are its own to report.
  run: (attempt: ScheduledAttempt) => Promise<RunOutcome>
  // Called once, instead of run, on a rest day.
  onRestDay?: (wall: JerusalemWallClock) => void
  // Called when a failed attempt is put back, with the time of the next try.
  onRetry?: (next: { retry: number; at: Date }) => void
  // Called once when a failed attempt has no retry left today, and the day goes without a scheduled
  // digest.
  onGiveUp?: () => void
  tickMs?: number
}

export interface ScheduledDigest {
  // Runs until stopped. Resolves only when stop() is called, so main() can await it.
  start(): Promise<void>
  stop(): void
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// When an attempt is due: the first at the fire, retry N at N intervals after it.
const retryTime = ({ firedAt, retry }: ScheduledAttempt): Date =>
  new Date(firedAt.getTime() + retry * DIGEST_RETRY_INTERVAL_MS)

export function createScheduledDigest({
  clock,
  firedState,
  fireHour,
  run,
  onRestDay,
  onRetry,
  onGiveUp,
  tickMs = SCHEDULE_TICK_MS,
}: ScheduleOptions): ScheduledDigest {
  let running = false
  // The day's failed attempt, waiting for its next try. Held in memory only: a restart during the
  // hour loses the remaining tries, and the fired marker keeps the day from starting over.
  let pending: ScheduledAttempt | null = null

  // Run one attempt and decide what follows it. The tries are counted from the first attempt's
  // instant rather than from each other, so a slow attempt cannot push the last one past the hour.
  // Nor past midnight: a retry is the same day's run, and only a day that fired late, near midnight,
  // could reach the next one, which has its own fire or is a Saturday that must stay quiet.
  const attempt = async (current: ScheduledAttempt): Promise<void> => {
    pending = null
    if ((await run(current)) === 'done') {
      return
    }
    const next = { firedAt: current.firedAt, retry: current.retry + 1 }
    const sameDay =
      jerusalemWallClock(retryTime(next)).date === jerusalemWallClock(current.firedAt).date
    if (next.retry > DIGEST_RETRY_COUNT || !sameDay) {
      onGiveUp?.()
      return
    }
    pending = next
    onRetry?.({ retry: next.retry, at: retryTime(next) })
  }

  return {
    start: async () => {
      running = true
      while (running) {
        const now = clock.now()
        const wall = jerusalemWallClock(now)
        if (pending !== null) {
          if (now.getTime() >= retryTime(pending).getTime()) {
            await attempt(pending)
          }
        } else if (isDigestDue(wall, fireHour, firedState.read())) {
          // Marked BEFORE the run, not after. A run that throws or is killed halfway has already sent
          // its message as often as not, and a marker written only on success would resend it on the
          // next tick — a duplicate on somebody's phone every minute until the hour ends. A rest day
          // is marked for the same reason in the other direction: unmarked, it would be re-decided
          // and re-announced every minute until midnight. A retry never re-marks: it is the same
          // day's run, late.
          firedState.write(wall.date)
          if (isRestDay(wall)) {
            onRestDay?.(wall)
          } else {
            await attempt({ firedAt: now, retry: 0 })
          }
        }
        if (!running) {
          return
        }
        await sleep(tickMs)
      }
    },
    stop: () => {
      running = false
    },
  }
}
