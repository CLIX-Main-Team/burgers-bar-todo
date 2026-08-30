import type { Clock } from './clock.js'
import type { FiredState } from './fired-state.js'
import { type JerusalemWallClock, jerusalemWallClock } from './jerusalem-time.js'

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

export interface ScheduleOptions {
  clock: Clock
  firedState: FiredState
  fireHour: number
  // Awaited, so a slow run cannot overlap the next tick. Its failures are its own to report; the
  // scheduler treats a completed run as fired either way, because a gateway that is down at 08:00 is
  // usually still down at 08:01 and retrying every minute would spend the day hammering it.
  run: () => Promise<void>
  tickMs?: number
}

export interface ScheduledDigest {
  // Runs until stopped. Resolves only when stop() is called, so main() can await it.
  start(): Promise<void>
  stop(): void
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function createScheduledDigest({
  clock,
  firedState,
  fireHour,
  run,
  tickMs = SCHEDULE_TICK_MS,
}: ScheduleOptions): ScheduledDigest {
  let running = false

  return {
    start: async () => {
      running = true
      while (running) {
        const wall = jerusalemWallClock(clock.now())
        if (isDigestDue(wall, fireHour, firedState.read())) {
          // Marked BEFORE the run, not after. A run that throws or is killed halfway has already sent
          // its message as often as not, and a marker written only on success would resend it on the
          // next tick — a duplicate on somebody's phone every minute until the hour ends.
          firedState.write(wall.date)
          await run()
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
