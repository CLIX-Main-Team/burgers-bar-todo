import { describe, expect, it } from 'vitest'
import { createMutableClock } from '../src/clock.js'
import { createMemoryFiredState } from '../src/fired-state.js'
import { jerusalemWallClock } from '../src/jerusalem-time.js'
import { createScheduledDigest, isDigestDue } from '../src/schedule.js'

const wall = (date: string, hour: number) => ({ date, hour, minute: 0 })

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
      },
    })
    stop = schedule.stop
    await schedule.start()

    expect(markedBeforeRun).toBe(jerusalemWallClock(clock.now()).date)
  })
})
