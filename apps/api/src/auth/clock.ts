// The one behaviour every expiry decision reads: the current time. It is a port so
// tests can drive session expiry deterministically without waiting or touching the
// system clock (auth plan, clock seam). The session service reads `now()` when it
// issues a session, when it checks expiry, and when it slides the idle window, so a
// single injected clock controls all three.
export interface Clock {
  now(): Date
}

// The real clock used by the running server and the seed CLI.
export const systemClock: Clock = {
  now: () => new Date(),
}

// A clock whose time the caller sets — the test double. Tests advance it to cross
// the idle window and prove expiry, standing in for the injectable clock the plan
// names. It is here rather than under test/ so the session service and its tests
// share one definition.
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
