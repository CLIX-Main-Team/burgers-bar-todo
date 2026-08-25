import type { Task } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import type { SharedTask } from '../tasks/task-filters.js'
import { assigneeLoad, branchBreakdown, paginate, priorityMix } from './dashboard-metrics.js'

// The Home screen's arithmetic. A dashboard's honesty lives here rather than in its layout: a
// number that is wrong is worse than a number that is ugly, and every figure on that screen is
// something a shift manager acts on.
//
// The cases worth pinning are the ones a naive count gets wrong — the finished task that should
// stop being counted as urgent or late, the branch ordering that has to put trouble first rather
// than the leader, and the page that has to survive its own list shrinking under it.

const HERZLIYA = 'bbbbbbbb-0001-4001-8001-bbbbbbbbbbbb'
const RAMAT_GAN = 'bbbbbbbb-0002-4002-8002-bbbbbbbbbbbb'
const NAMES = new Map([
  [HERZLIYA, 'Herzliya'],
  [RAMAT_GAN, 'Ramat Gan'],
])

const NOW = new Date('2026-08-23T09:00:00.000Z')
const YESTERDAY = '2026-08-22T00:00:00.000Z'
const TOMORROW = '2026-08-24T00:00:00.000Z'

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
    projectId: null,
    personal: false,
    assignees: [],
    createdBy: { id: 'creator', displayName: 'Creator' },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  }
}

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  assignedAt: NOW.toISOString(),
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

  it('counts only what is still open — a finished job is no longer worth anything', () => {
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

describe('branchBreakdown', () => {
  const board = [
    task({ locationId: HERZLIYA, status: 'done' }),
    task({ locationId: HERZLIYA, status: 'in_progress' }),
    task({ locationId: HERZLIYA, status: 'not_started', dueDate: YESTERDAY }),
    task({ locationId: RAMAT_GAN, status: 'done' }),
    task({ locationId: RAMAT_GAN, status: 'not_started', dueDate: TOMORROW }),
  ]

  it('splits each branch three ways and counts what is late', () => {
    const [worst] = branchBreakdown(board, NAMES, NOW)

    expect(worst).toMatchObject({
      name: 'Herzliya',
      done: 1,
      inProgress: 1,
      notStarted: 1,
      total: 3,
      overdue: 1,
      percent: 33,
    })
  })

  it('puts the branch carrying late work first, not the one that is furthest ahead', () => {
    // Ramat Gan is 50% done to Herzliya's 33%, so a league table would lead with it. This
    // screen is opened to answer "where do I go first", and Herzliya is the one running late.
    expect(branchBreakdown(board, NAMES, NOW).map((row) => row.name)).toEqual([
      'Herzliya',
      'Ramat Gan',
    ])
  })

  it('orders on least-finished once nobody is late', () => {
    const onTime = [
      task({ locationId: HERZLIYA, status: 'done' }),
      task({ locationId: RAMAT_GAN, status: 'not_started' }),
    ]

    expect(branchBreakdown(onTime, NAMES, NOW).map((row) => row.name)).toEqual([
      'Ramat Gan',
      'Herzliya',
    ])
  })

  it('leaves out a branch whose name has not loaded rather than showing a raw id', () => {
    const rows = branchBreakdown(board, new Map([[HERZLIYA, 'Herzliya']]), NOW)
    expect(rows.map((row) => row.name)).toEqual(['Herzliya'])
  })

  it('never divides by zero', () => {
    expect(branchBreakdown([], NAMES, NOW)).toEqual([])
  })
})

describe('assigneeLoad', () => {
  const DANA = person('dana', 'Dana')
  const NOA = person('noa', 'Noa')

  it('counts each person their own plate, and their late work with it', () => {
    const rows = assigneeLoad(
      [
        task({ locationId: HERZLIYA, assignees: [DANA], status: 'done' }),
        task({ locationId: HERZLIYA, assignees: [DANA, NOA], dueDate: YESTERDAY }),
        task({ locationId: HERZLIYA, assignees: [NOA], dueDate: TOMORROW }),
      ],
      NOW,
    )

    expect(rows).toEqual([
      { userId: 'noa', name: 'Noa', open: 2, done: 0, total: 2, overdue: 1 },
      { userId: 'dana', name: 'Dana', open: 1, done: 1, total: 2, overdue: 1 },
    ])
  })

  it('never counts a finished task as late, however old its due date', () => {
    const [row] = assigneeLoad(
      [task({ locationId: HERZLIYA, assignees: [DANA], status: 'done', dueDate: YESTERDAY })],
      NOW,
    )

    expect(row?.overdue).toBe(0)
  })
})

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  it('slices the asked-for page and states the range it covers', () => {
    expect(paginate(items, 2, 4)).toMatchObject({
      rows: [5, 6, 7, 8],
      page: 2,
      pageCount: 3,
      from: 5,
      to: 8,
      total: 10,
    })
  })

  it('clamps a page past the end, so a filter that shrinks the list lands on real rows', () => {
    expect(paginate(items, 9, 4)).toMatchObject({ rows: [9, 10], page: 3, from: 9, to: 10 })
  })

  it('clamps a page below the first', () => {
    expect(paginate(items, 0, 4).page).toBe(1)
  })

  it('reports an empty list as one empty page rather than zero pages', () => {
    expect(paginate([], 1, 4)).toMatchObject({
      rows: [],
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
      total: 0,
    })
  })
})
