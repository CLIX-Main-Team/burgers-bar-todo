import type { Task, TaskBoardResponse } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { countUnseenAssignments } from './unseen.js'

// The badge's counting rule (#136) at its boundaries. The count answers one question — how many of
// MY assignments are newer than MY last board visit — so the edges that matter are the marker
// itself (at-marker is seen), the never-visited null marker (everything current is new), and the
// two ways a row can be someone else's news (another user's assignment, no assignment at all).

const ME = '33333333-3333-3333-3333-333333333333'
const OTHER = '44444444-4444-4444-4444-444444444444'

const MARKER = '2026-01-10T00:00:00.000Z'
const BEFORE_MARKER = '2026-01-09T00:00:00.000Z'
const AFTER_MARKER = '2026-01-11T00:00:00.000Z'

const assignee = (id: string, assignedAt: string): Task['assignees'][number] => ({
  id,
  displayName: 'Someone',
  assignedAt,
})

const task = (id: string, assignees: Task['assignees'], updatedAt = MARKER): Task => ({
  id,
  locationId: '22222222-2222-2222-2222-222222222222',
  title: 'Task',
  description: null,
  status: 'not_started',
  priority: 'normal',
  dueDate: null,
  completedAt: null,
  position: 0,
  projectId: null,
  personal: false,
  assignees,
  checklist: [],
  createdBy: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', displayName: 'A Manager' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
})

const board = (tasks: Task[], lastSeenAt: string | null): TaskBoardResponse => ({
  tasks,
  lastSeenAt,
})

describe('countUnseenAssignments (#136)', () => {
  it('is zero before the board has loaded', () => {
    expect(countUnseenAssignments(undefined, ME)).toBe(0)
  })

  it('counts only my assignments made after the marker', () => {
    const response = board(
      [
        task('a', [assignee(ME, AFTER_MARKER)]),
        task('b', [assignee(ME, BEFORE_MARKER)]),
        task('c', []),
      ],
      MARKER,
    )
    expect(countUnseenAssignments(response, ME)).toBe(1)
  })

  it('treats an assignment exactly at the marker as seen', () => {
    const response = board([task('a', [assignee(ME, MARKER)])], MARKER)
    expect(countUnseenAssignments(response, ME)).toBe(0)
  })

  it('counts every current assignment when the board has never been opened', () => {
    const response = board(
      [task('a', [assignee(ME, BEFORE_MARKER)]), task('b', [assignee(ME, AFTER_MARKER)])],
      null,
    )
    expect(countUnseenAssignments(response, ME)).toBe(2)
  })

  it("ignores other people's new assignments, even on a task I share", () => {
    const response = board(
      [task('a', [assignee(ME, BEFORE_MARKER), assignee(OTHER, AFTER_MARKER)])],
      MARKER,
    )
    expect(countUnseenAssignments(response, ME)).toBe(0)
  })

  it('never re-badges an edited task — only the assignment date moves the count', () => {
    // The API preserves an unchanged assignee's assignedAt across edits, so a task edited after
    // the marker (fresh updatedAt) with an old assignment stays seen.
    const response = board([task('a', [assignee(ME, BEFORE_MARKER)], AFTER_MARKER)], MARKER)
    expect(countUnseenAssignments(response, ME)).toBe(0)
  })
})
