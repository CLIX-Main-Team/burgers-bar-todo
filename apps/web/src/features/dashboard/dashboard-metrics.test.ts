import type { Task } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import type { SharedTask } from '../tasks/task-filters.js'
import {
  activitySeries,
  attention,
  branchHealth,
  departmentRows,
  overviewMetrics,
  placeRows,
  priorityMix,
  workload,
} from './dashboard-metrics.js'

// The Dashboard's arithmetic. A dashboard's honesty lives here rather than in its layout: a
// number that is wrong is worse than a number that is ugly, and every figure on that screen is
// something a manager acts on.
//
// The cases worth pinning are the ones a naive count gets wrong: the finished task that should
// stop counting as urgent or late, the late task that must be counted once and not twice, the
// branch with nothing on it that is clear rather than missing, and the day boundary that has to
// be the reader's own midnight rather than UTC's.

const HERZLIYA = 'bbbbbbbb-0001-4001-8001-bbbbbbbbbbbb'
const RAMAT_GAN = 'bbbbbbbb-0002-4002-8002-bbbbbbbbbbbb'
const OFAKIM = 'bbbbbbbb-0003-4003-8003-bbbbbbbbbbbb'
const HEAD_OFFICE = 'bbbbbbbb-0009-4009-8009-bbbbbbbbbbbb'
const NAMES = new Map([
  [HERZLIYA, 'Herzliya'],
  [RAMAT_GAN, 'Ramat Gan'],
])

// Built from local parts, so every expectation below is about the reader's own calendar day
// whatever zone the test machine runs in.
const NOW = new Date(2026, 8, 22, 10, 0)
const at = (daysFromNow: number, hour = 9) =>
  new Date(2026, 8, 22 + daysFromNow, hour, 0).toISOString()

let seq = 0
function task(over: Partial<Task> & { locationId: string }): SharedTask {
  seq += 1
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    title: `task ${seq}`,
    description: null,
    status: 'not_started',
    priority: 'normal',
    dueDate: null,
    completedAt: null,
    position: seq,
    personal: false,
    subjectId: null,
    assignees: [],
    checklist: [],
    createdBy: { id: 'creator', displayName: 'Creator', avatarTone: null },
    createdAt: at(0, 8),
    updatedAt: at(0, 8),
    ...over,
  }
}

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  avatarTone: null,
  assignedAt: NOW.toISOString(),
})

describe('overviewMetrics', () => {
  it('counts what is open, late and due today, and never a finished task as either', () => {
    const overview = overviewMetrics(
      [
        task({ locationId: HERZLIYA, dueDate: at(0) }),
        task({ locationId: HERZLIYA, dueDate: at(0), status: 'in_progress' }),
        task({ locationId: HERZLIYA, dueDate: at(-2) }),
        task({ locationId: HERZLIYA, dueDate: at(-2), status: 'done', completedAt: at(-1) }),
        task({ locationId: HERZLIYA, dueDate: at(0), status: 'done', completedAt: at(0) }),
      ],
      NOW,
    )

    expect(overview).toMatchObject({ open: 3, overdue: 1, dueToday: 2, dueTodayStarted: 1 })
  })

  it('counts the places holding work in progress, not the tasks', () => {
    const overview = overviewMetrics(
      [
        task({ locationId: HERZLIYA, status: 'in_progress' }),
        task({ locationId: HERZLIYA, status: 'in_progress' }),
        task({ locationId: RAMAT_GAN, status: 'in_progress' }),
        task({ locationId: OFAKIM }),
      ],
      NOW,
    )

    expect(overview).toMatchObject({ inProgress: 3, inProgressPlaces: 2 })
  })

  it('reports how late the oldest late task is, and nothing when nothing is late', () => {
    expect(
      overviewMetrics(
        [
          task({ locationId: HERZLIYA, dueDate: at(-3) }),
          task({ locationId: HERZLIYA, dueDate: at(-9) }),
        ],
        NOW,
      ).oldestOverdueDays,
    ).toBe(9)
    expect(overviewMetrics([task({ locationId: HERZLIYA })], NOW).oldestOverdueDays).toBeNull()
  })

  it('counts this week as the last seven days, today included, and the seven before as last week', () => {
    const done = (daysAgo: number) =>
      task({ locationId: HERZLIYA, status: 'done', completedAt: at(-daysAgo) })
    const overview = overviewMetrics([done(0), done(6), done(7), done(13), done(14), done(30)], NOW)

    expect(overview).toMatchObject({ doneThisWeek: 2, doneLastWeek: 2 })
  })
})

describe('activitySeries', () => {
  it('returns exactly the asked-for days, oldest first, ending on today', () => {
    const series = activitySeries([], NOW, 7)

    expect(series).toHaveLength(7)
    expect(series[6]?.date).toEqual(new Date(2026, 8, 22))
    expect(series[0]?.date).toEqual(new Date(2026, 8, 16))
    expect(series.every((day) => day.created === 0 && day.completed === 0)).toBe(true)
  })

  it('buckets each task by the local day it was created and the local day it was finished', () => {
    const series = activitySeries(
      [
        task({ locationId: HERZLIYA, createdAt: at(-1, 23) }),
        task({ locationId: HERZLIYA, createdAt: at(-1, 1) }),
        task({
          locationId: HERZLIYA,
          createdAt: at(-3),
          status: 'done',
          completedAt: at(0, 7),
        }),
      ],
      NOW,
      7,
    )

    expect(series.map((day) => day.created)).toEqual([0, 0, 0, 1, 0, 2, 0])
    expect(series.map((day) => day.completed)).toEqual([0, 0, 0, 0, 0, 0, 1])
  })

  it('leaves out anything before the window', () => {
    const series = activitySeries(
      [task({ locationId: HERZLIYA, createdAt: at(-20), completedAt: at(-15), status: 'done' })],
      NOW,
      14,
    )

    expect(series.reduce((sum, day) => sum + day.created + day.completed, 0)).toBe(0)
  })
})

describe('workload', () => {
  const DANA = person('dana', 'Dana')
  const NOA = person('noa', 'Noa')
  const OMRI = person('omri', 'Omri')

  it('puts every open task in exactly one part per person, late before anything else', () => {
    const [row] = workload(
      [
        task({ locationId: HERZLIYA, assignees: [DANA], dueDate: at(-1), status: 'in_progress' }),
        task({ locationId: HERZLIYA, assignees: [DANA], status: 'in_progress' }),
        task({ locationId: HERZLIYA, assignees: [DANA] }),
        task({ locationId: HERZLIYA, assignees: [DANA], dueDate: at(-4) }),
      ],
      NOW,
    )

    expect(row).toEqual({
      userId: 'dana',
      name: 'Dana',
      avatarTone: null,
      overdue: 2,
      todo: 1,
      inProgress: 1,
      open: 4,
    })
  })

  it('leaves out finished work and anyone with nothing open', () => {
    const rows = workload(
      [
        task({ locationId: HERZLIYA, assignees: [NOA], status: 'done', dueDate: at(-3) }),
        task({ locationId: HERZLIYA, assignees: [DANA] }),
      ],
      NOW,
    )

    expect(rows.map((row) => row.userId)).toEqual(['dana'])
  })

  it('counts a shared task on each of its people', () => {
    const rows = workload([task({ locationId: HERZLIYA, assignees: [DANA, NOA] })], NOW)
    expect(rows.map((row) => [row.userId, row.open])).toEqual([
      ['dana', 1],
      ['noa', 1],
    ])
  })

  it('orders late work first, then the heaviest load, then by name', () => {
    const rows = workload(
      [
        task({ locationId: HERZLIYA, assignees: [OMRI] }),
        task({ locationId: HERZLIYA, assignees: [OMRI] }),
        task({ locationId: HERZLIYA, assignees: [NOA], dueDate: at(-1) }),
        task({ locationId: HERZLIYA, assignees: [DANA] }),
      ],
      NOW,
    )

    expect(rows.map((row) => row.userId)).toEqual(['noa', 'omri', 'dana'])
  })
})

describe('placeRows', () => {
  it('counts open and late work per named place, late places first', () => {
    const rows = placeRows(
      [
        task({ locationId: RAMAT_GAN }),
        task({ locationId: RAMAT_GAN }),
        task({ locationId: RAMAT_GAN, status: 'done' }),
        task({ locationId: HERZLIYA, dueDate: at(-1) }),
        task({ locationId: OFAKIM }),
      ],
      NAMES,
      NOW,
    )

    expect(rows).toEqual([
      { id: HERZLIYA, name: 'Herzliya', open: 1, overdue: 1 },
      { id: RAMAT_GAN, name: 'Ramat Gan', open: 2, overdue: 0 },
    ])
  })

  it('leaves out a place with nothing open', () => {
    expect(placeRows([task({ locationId: HERZLIYA, status: 'done' })], NAMES, NOW)).toEqual([])
  })
})

describe('branchHealth', () => {
  it('reads every branch as behind, on track or clear, a branch with no tasks included', () => {
    const health = branchHealth(
      [
        task({ locationId: HERZLIYA, dueDate: at(-1) }),
        task({ locationId: HERZLIYA }),
        task({ locationId: RAMAT_GAN, status: 'in_progress' }),
        task({ locationId: HEAD_OFFICE, dueDate: at(-5) }),
      ],
      [HERZLIYA, RAMAT_GAN, OFAKIM],
      NOW,
    )

    expect(health).toEqual({ behind: 1, onTrack: 1, clear: 1 })
  })
})

describe('departmentRows', () => {
  it('groups open work by the department its subject belongs to', () => {
    const subjectDepartment = new Map([
      ['s-clean', 'ops'],
      ['s-fix', 'ops'],
      ['s-promo', 'mkt'],
    ])
    const rows = departmentRows(
      [
        task({ locationId: HERZLIYA, subjectId: 's-clean' }),
        task({ locationId: HERZLIYA, subjectId: 's-fix', dueDate: at(-2) }),
        task({ locationId: HEAD_OFFICE, subjectId: 's-promo' }),
        task({ locationId: HEAD_OFFICE, subjectId: 's-promo', status: 'done' }),
        task({ locationId: HEAD_OFFICE, subjectId: 's-unknown' }),
      ],
      subjectDepartment,
      [
        { id: 'ops', name: 'Operations' },
        { id: 'mkt', name: 'Marketing' },
        { id: 'fin', name: 'Finance' },
      ],
      NOW,
    )

    expect(rows).toEqual([
      { id: 'ops', name: 'Operations', open: 2, overdue: 1 },
      { id: 'mkt', name: 'Marketing', open: 1, overdue: 0 },
    ])
  })
})

describe('attention', () => {
  it('lists late work most late first', () => {
    const late = attention(
      [
        task({ locationId: HERZLIYA, title: 'two days', dueDate: at(-2) }),
        task({ locationId: HERZLIYA, title: 'nine days', dueDate: at(-9) }),
        task({ locationId: HERZLIYA, title: 'finished', dueDate: at(-9), status: 'done' }),
      ],
      NOW,
    ).overdue

    expect(late.map((row) => row.title)).toEqual(['nine days', 'two days'])
  })

  it('lists what is due today with the highest priority first', () => {
    const today = attention(
      [
        task({ locationId: HERZLIYA, title: 'normal', dueDate: at(0) }),
        task({ locationId: HERZLIYA, title: 'high', dueDate: at(0), priority: 'high' }),
        task({ locationId: HERZLIYA, title: 'tomorrow', dueDate: at(1), priority: 'high' }),
      ],
      NOW,
    ).dueToday

    expect(today.map((row) => row.title)).toEqual(['high', 'normal'])
  })

  it('lists open high-priority work by nearest due date, undated last', () => {
    const high = attention(
      [
        task({ locationId: HERZLIYA, title: 'undated', priority: 'high' }),
        task({ locationId: HERZLIYA, title: 'friday', priority: 'high', dueDate: at(4) }),
        task({ locationId: HERZLIYA, title: 'late', priority: 'high', dueDate: at(-1) }),
        task({ locationId: HERZLIYA, title: 'medium', priority: 'medium', dueDate: at(0) }),
      ],
      NOW,
    ).high

    expect(high.map((row) => row.title)).toEqual(['late', 'friday', 'undated'])
  })
})

describe('priorityMix', () => {
  it('reports the three tiers high first, so the urgent slice leads the legend', () => {
    const mix = priorityMix([
      task({ locationId: HERZLIYA, priority: 'normal' }),
      task({ locationId: HERZLIYA, priority: 'high' }),
      task({ locationId: HERZLIYA, priority: 'medium' }),
    ])

    expect(mix.map((slice) => slice.priority)).toEqual(['high', 'medium', 'normal'])
    expect(mix.map((slice) => slice.count)).toEqual([1, 1, 1])
  })

  it('counts only what is still open, a finished job is no longer worth anything', () => {
    const mix = priorityMix([
      task({ locationId: HERZLIYA, priority: 'high', status: 'done' }),
      task({ locationId: HERZLIYA, priority: 'high', status: 'in_progress' }),
    ])

    expect(mix.find((slice) => slice.priority === 'high')?.count).toBe(1)
  })

  it('reports every tier at zero for an empty board rather than an empty list', () => {
    expect(priorityMix([]).map((slice) => slice.count)).toEqual([0, 0, 0])
  })
})
