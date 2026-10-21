import { describe, expect, it } from 'vitest'
import { createMutableClock } from '../src/clock.js'
import { createMemoryFiredState } from '../src/fired-state.js'
import { jerusalemWallClock } from '../src/jerusalem-time.js'
import { createScheduledDigest, isDigestDue, isRestDay } from '../src/schedule.js'

// The weekday of a calendar date is the same in every time zone, so UTC midnight is a safe way to
// derive it from the Jerusalem date string.
const wall = (date: string, hour: number) => ({
  date,
  hour,
  minute: 0,
  weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
})

describe('isDigestDue', () => {
  it('is due at the fire hour when the day has not fired', () => {
    expect(isDigestDue(wall('2026-08-27', 8), 8, null)).toBe(true)
  })

  it('is not due before the fire hour', () => {
    expect(isDigestDue(wall('2026-08-27', 7), 8, null)).toBe(false)
  })

  it('is not due again once the day has fired', () => {
    expect(isDigestDue(wall('2026-08-27', 9), 8, '2026-08-27')).toBe(false)
  })

  it('is due on the next day after the previous one fired', () => {
    expect(isDigestDue(wall('2026-08-28', 8), 8, '2026-08-27')).toBe(true)
  })

  it('still fires late when the container was down at the fire hour', () => {
    // A missed digest is silent, so catching up beats skipping the day. The date check is what keeps
    // this forgiveness from resending a digest that already went out.
    expect(isDigestDue(wall('2026-08-27', 22), 8, null)).toBe(true)
  })
})

describe('createScheduledDigest', () => {
  it('fires once and records the local date it fired on', async () => {
    // 09:00 UTC is midday in Jerusalem, so the 08:00 fire hour has passed.
    const clock = createMutableClock(new Date('2026-08-27T09:00:00Z'))
    const firedState = createMemoryFiredState()
    let runs = 0
    let stop: () => void = () => {}
    const schedule = createScheduledDigest({
      clock,
      firedState,
      fireHour: 8,
      tickMs: 1,
      run: async () => {
        runs += 1
        stop()
        return 'done'
      },
    })
    stop = schedule.stop
    await schedule.start()

    expect(runs).toBe(1)
    expect(firedState.read()).toBe(jerusalemWallClock(clock.now()).date)
  })

  it('does not fire when the marker says today already went out', async () => {
    const clock = createMutableClock(new Date('2026-08-27T09:00:00Z'))
    const today = jerusalemWallClock(clock.now()).date
    const firedState = createMemoryFiredState(today)
    let runs = 0
    const schedule = createScheduledDigest({
      clock,
      firedState,
      fireHour: 8,
      tickMs: 1,
      run: async () => {
        runs += 1
        return 'done'
      },
    })
    // Let a few ticks pass, then stop: a restart at 09:30 must not resend the 08:00 digest.
    setTimeout(schedule.stop, 20)
    await schedule.start()

    expect(runs).toBe(0)
  })

  it('marks the day before running, so a run that dies cannot resend every minute', async () => {
    const clock = createMutableClock(new Date('2026-08-27T09:00:00Z'))
    const firedState = createMemoryFiredState()
    let stop: () => void = () => {}
    let markedBeforeRun: string | null = null
    const schedule = createScheduledDigest({
      clock,
      firedState,
      fireHour: 8,
      tickMs: 1,
      run: async () => {
        markedBeforeRun = firedState.read()
        stop()
        return 'done'
      },
    })
    stop = schedule.stop
    await schedule.start()

    expect(markedBeforeRun).toBe(jerusalemWallClock(clock.now()).date)
  })
})

// Saturday. No scheduled digest goes out on it, ever; only a person asking with the keyword does,
// and that path never consults the scheduler.

describe('isRestDay', () => {
  it('is Saturday, and only Saturday', () => {
    expect(isRestDay(wall('2026-09-19', 8))).toBe(true)
    expect(isRestDay(wall('2026-09-18', 8))).toBe(false)
    expect(isRestDay(wall('2026-09-20', 8))).toBe(false)
  })
})

describe('createScheduledDigest on a Saturday', () => {
  // 09:00Z on 2026-09-19 is midday Saturday in Jerusalem, well past the fire hour.
  const SATURDAY_NOON = new Date('2026-09-19T09:00:00Z')

  it('does not run, marks the day so it never re-checks, and says so once', async () => {
    const clock = createMutableClock(SATURDAY_NOON)
    const firedState = createMemoryFiredState()
    let runs = 0
    const skipped: string[] = []
    const schedule = createScheduledDigest({
      clock,
      firedState,
      fireHour: 8,
      tickMs: 1,
      run: async () => {
        runs += 1
        return 'done'
      },
      onRestDay: (wall) => skipped.push(wall.date),
    })
    // Several ticks, so a rule that forgot to mark the day would show up as repeated callbacks.
    setTimeout(schedule.stop, 20)
    await schedule.start()

    expect(runs).toBe(0)
    expect(firedState.read()).toBe('2026-09-19')
    expect(skipped).toEqual(['2026-09-19'])
  })

  it('fires as normal the next morning after a skipped Saturday', async () => {
    // Sunday 09:00 Jerusalem, with Saturday recorded as the last handled day.
    const clock = createMutableClock(new Date('2026-09-20T06:00:00Z'))
    const firedState = createMemoryFiredState('2026-09-19')
    let runs = 0
    let stop: () => void = () => {}
    const schedule = createScheduledDigest({
      clock,
      firedState,
      fireHour: 8,
      tickMs: 1,
      run: async () => {
        runs += 1
        stop()
        return 'done'
      },
    })
    stop = schedule.stop
    await schedule.start()

    expect(runs).toBe(1)
    expect(firedState.read()).toBe('2026-09-20')
  })
})

// The second chance (#432). A run that failed before anything was paid for or sent is tried again
// every five minutes for an hour, because the failure that motivated it, a dropped connection to the
// gateway at 08:00, was gone by 08:11 and cost the whole day.

describe('createScheduledDigest retrying a run that failed before spending anything', () => {
  // 05:00Z on Wednesday 2026-10-21 is 08:00 in Jerusalem (summer time), the fire hour exactly.
  const EIGHT_AM = new Date('2026-10-21T05:00:00Z')
  const MINUTE = 60_000
  const minutesAfterEight = (time: Date): number => (time.getTime() - EIGHT_AM.getTime()) / MINUTE

  // A clock that moves on a minute each time the scheduler reads it, which is once per tick, so a
  // tick stands in for a real minute and an hour of retries runs in milliseconds. Past `minutes` it
  // stops the schedule: the minutes after the last try are watched for a try that must not happen.
  function minuteClock(minutes: number, stop: () => void, start: Date = EIGHT_AM) {
    let reads = 0
    let last = start
    return {
      now: () => {
        if (reads > minutes) {
          stop()
        }
        last = new Date(start.getTime() + reads * MINUTE)
        reads += 1
        return last
      },
      // When the current tick happened, without moving the clock on.
      last: () => last,
    }
  }

  it('tries again every five minutes for an hour, then gives up on the day', async () => {
    let stop: () => void = () => {}
    const clock = minuteClock(90, () => stop())
    const firedState = createMemoryFiredState()
    const attempts: { minute: number; retry: number; firedAt: Date }[] = []
    const announced: { retry: number; minute: number }[] = []
    let gaveUp = 0
    const schedule = createScheduledDigest({
      clock,
      firedState,
      fireHour: 8,
      tickMs: 1,
      run: async ({ firedAt, retry }) => {
        attempts.push({ minute: minutesAfterEight(clock.last()), retry, firedAt })
        return 'retry'
      },
      onRetry: ({ retry, at }) => announced.push({ retry, minute: minutesAfterEight(at) }),
      onGiveUp: () => {
        gaveUp += 1
      },
    })
    stop = schedule.stop
    await schedule.start()

    // 08:00, then 08:05 to 09:00: thirteen attempts, twelve of them retries, and none after.
    expect(attempts.map((attempt) => attempt.minute)).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
    ])
    expect(attempts.map((attempt) => attempt.retry)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    // Every retry is the 08:00 run again, so it carries the 08:00 instant to read the same 24 hours.
    expect(attempts.every((attempt) => attempt.firedAt.getTime() === EIGHT_AM.getTime())).toBe(true)
    expect(announced).toEqual(
      [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map((minute, index) => ({
        retry: index + 1,
        minute,
      })),
    )
    expect(gaveUp).toBe(1)
    expect(firedState.read()).toBe('2026-10-21')
  })

  it('stops trying as soon as an attempt gets through', async () => {
    let stop: () => void = () => {}
    const clock = minuteClock(90, () => stop())
    const minutes: number[] = []
    let gaveUp = 0
    const schedule = createScheduledDigest({
      clock,
      firedState: createMemoryFiredState(),
      fireHour: 8,
      tickMs: 1,
      run: async ({ retry }) => {
        minutes.push(minutesAfterEight(clock.last()))
        return retry < 2 ? 'retry' : 'done'
      },
      onGiveUp: () => {
        gaveUp += 1
      },
    })
    stop = schedule.stop
    await schedule.start()

    expect(minutes).toEqual([0, 5, 10])
    expect(gaveUp).toBe(0)
  })

  it('does not try again after a run that reports itself done', async () => {
    // A run that got as far as the models has spent money, and one that sent has reached a phone, so
    // the run says "done" for those and the scheduler takes its word for it.
    let stop: () => void = () => {}
    const clock = minuteClock(30, () => stop())
    let runs = 0
    let announced = 0
    const schedule = createScheduledDigest({
      clock,
      firedState: createMemoryFiredState(),
      fireHour: 8,
      tickMs: 1,
      run: async () => {
        runs += 1
        return 'done'
      },
      onRetry: () => {
        announced += 1
      },
    })
    stop = schedule.stop
    await schedule.start()

    expect(runs).toBe(1)
    expect(announced).toBe(0)
  })

  it('never carries a retry past midnight, so a late Friday cannot reach into Saturday', async () => {
    // A container that was down all Friday fires late, at 23:50 (20:50Z in summer time). Its 23:55
    // retry is still Friday; the one after would be 00:00 on Saturday, which stays quiet.
    const FRIDAY_LATE = new Date('2026-10-23T20:50:00Z')
    let stop: () => void = () => {}
    const clock = minuteClock(30, () => stop(), FRIDAY_LATE)
    const attempts: Date[] = []
    let gaveUp = 0
    const schedule = createScheduledDigest({
      clock,
      firedState: createMemoryFiredState(),
      fireHour: 8,
      tickMs: 1,
      run: async () => {
        attempts.push(clock.last())
        return 'retry'
      },
      onGiveUp: () => {
        gaveUp += 1
      },
    })
    stop = schedule.stop
    await schedule.start()

    expect(attempts.map((at) => jerusalemWallClock(at).minute)).toEqual([50, 55])
    expect(attempts.every((at) => jerusalemWallClock(at).date === '2026-10-23')).toBe(true)
    expect(gaveUp).toBe(1)
  })
})
