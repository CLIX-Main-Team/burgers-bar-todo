import type { Task } from '@burgers/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { TaskCard } from './task-card.js'

// The branch chip: an admin's lanes mix every location's tasks, so the screen passes each card
// its board's name; every other viewer sees only their own location and passes nothing. The card
// itself is presentational — it renders exactly what it is handed, so these two cases are the
// whole contract.

const TASK: Task = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  locationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  title: 'Open the store',
  description: null,
  status: 'not_started',
  priority: 'normal',
  dueDate: null,
  completedAt: null,
  position: 0,
  assignees: [],
  createdBy: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', displayName: 'Administrator' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderCard(locationName?: string): void {
  render(
    <LocaleProvider>
      <TaskCard task={TASK} locationName={locationName} />
    </LocaleProvider>,
  )
}

describe('TaskCard — branch chip', () => {
  it('names the board when a location name is supplied (an admin card)', () => {
    renderCard('Downtown')
    expect(screen.getByText('Downtown')).toBeInTheDocument()
  })

  it('renders no chip without one (a manager or employee card)', () => {
    renderCard()
    expect(screen.queryByText('Downtown')).not.toBeInTheDocument()
  })

  it('lets a Hebrew branch name lay out by its own script', () => {
    renderCard('סניף המושבה')
    expect(screen.getByText('סניף המושבה').closest('[dir="auto"]')).not.toBeNull()
  })
})

// With the StatusControl pill on every card (owner decision 2026-08), the assignee column no
// longer keys off the pill's presence: `ownTasks` alone says "every card here is the viewer's
// own" and drops the stack. A manager card carrying a pill must keep its assignee signal — the
// unassigned fixture shows it as the Backlog chip.
// The person-led recut (2026-08-12): every card opens with the creator's tile and captions it
// "Created by …", and a task with a description shows its first line as a teaser. Both render
// straight from the read's fields, so the two fixtures are the whole contract.
describe('TaskCard — creator and description teaser', () => {
  it('captions every card with who created it', () => {
    renderCard()
    expect(screen.getByText('Created by Administrator')).toBeInTheDocument()
  })

  it('teases the description when the task has one', () => {
    render(
      <LocaleProvider>
        <TaskCard task={{ ...TASK, description: 'Wipe the fryer hoods before opening' }} />
      </LocaleProvider>,
    )
    expect(screen.getByText('Wipe the fryer hoods before opening')).toBeInTheDocument()
  })

  it('renders no teaser without a description', () => {
    renderCard()
    expect(screen.queryByText(/Wipe the fryer/)).not.toBeInTheDocument()
  })
})

describe('TaskCard — ownTasks vs the assignee signal', () => {
  it('keeps the assignee signal on a card with a status pill (a manager card)', () => {
    render(
      <LocaleProvider>
        <TaskCard task={TASK} statusControl={<span>pill</span>} />
      </LocaleProvider>,
    )
    expect(screen.getByText('Backlog')).toBeInTheDocument()
  })

  it('drops the assignee signal on an own-tasks board (an employee card)', () => {
    render(
      <LocaleProvider>
        <TaskCard task={TASK} statusControl={<span>pill</span>} ownTasks />
      </LocaleProvider>,
    )
    expect(screen.queryByText('Backlog')).not.toBeInTheDocument()
  })
})
