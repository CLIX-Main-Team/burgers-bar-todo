// The one behaviour every timing decision in this job reads: the current time. It is a port so the
// daily fire and the 24-hour message window are driven deterministically in tests, with no waiting
// and no touching the system clock. The schedule reads `now()` to decide whether the Jerusalem
// local hour has reached the fire hour, and the collection reads it to place both ends of the
// window, so a single injected clock controls both and the two can never disagree.
export interface Clock {
  now(): Date
}

// The real clock used by the long-running container and by the --once CLI.
export const systemClock: Clock = {
  now: () => new Date(),
}

// A clock whose time the caller sets — the test double. Tests advance it across the fire hour and
// across Israel's 23- and 25-hour DST days, proving the daily firing without waiting for it. It is
// here rather than under test/ so the job and its tests share one definition.
export interface MutableClock extends Clock {
  set(time: Date): void
  advance(ms: number): void
}

export function createMutableClock(start: Date): MutableClock {
  let current = start
  return {
    now: () => current,
    set: (time) => {
      current = time
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms)
    },
  }
}
