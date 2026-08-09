import type { Task } from '@burgers/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { groupByStatus } from './board-columns.js'
import { StatusBoard } from './status-board.js'

// The board's two frames (owner decision 2026-08): below `lg` a segmented status-tab row over one
// lane at a time; at `lg` the three-lane kanban grid. jsdom has no matchMedia, which the media
// hook resolves as "not desktop" — so the bare environment exercises the mobile frame, and the
// desktop case stubs matchMedia to `matches: true` the way use-media-query.test does.

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>): Task {
  return {
    locationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    description: null,
    priority: 'normal',
    dueDate: null,
    completedAt: null,
    position: 0,
    assignees: [],
    createdBy: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', displayName: 'Administrator' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const TASKS: Task[] = [
  task({
    id: 'aaaa0001-0000-0000-0000-000000000001',
    title: 'Open the store',
    status: 'not_started',
  }),
  task({
    id: 'aaaa0002-0000-0000-0000-000000000002',
    title: 'Prep the sauces',
    status: 'in_progress',
  }),
]

function renderBoard(): void {
  render(
    <LocaleProvider>
      <StatusBoard
        columns={groupByStatus(TASKS)}
        renderCard={(t) => <span>{t.title}</span>}
        drag="off"
        onReorder={() => {}}
        onStatusMove={() => {}}
      />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('StatusBoard — mobile status tabs', () => {
  it('shows every status with its count up top and only the active lane below', () => {
    renderBoard()

    const tabs = screen.getByRole('group', { name: 'Filter by status' })
    expect(tabs).toBeInTheDocument()
    // Each tab carries its lane's name and count; Not started is the default active lane.
    expect(screen.getByRole('button', { name: /Not started ?1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /In progress ?1/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: /Done ?0/ })).toBeInTheDocument()

    expect(screen.getByText('Open the store')).toBeInTheDocument()
    expect(screen.queryByText('Prep the sauces')).not.toBeInTheDocument()
  })

  it('switches the visible lane when a tab is tapped', () => {
    renderBoard()

    fireEvent.click(screen.getByRole('button', { name: /In progress ?1/ }))

    expect(screen.getByRole('button', { name: /In progress ?1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Prep the sauces')).toBeInTheDocument()
    expect(screen.queryByText('Open the store')).not.toBeInTheDocument()
  })

  it('renders the three-lane grid with no tabs on desktop', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    renderBoard()

    expect(screen.queryByRole('group', { name: 'Filter by status' })).not.toBeInTheDocument()
    // All three lanes mount at once, so both cards are on screen together.
    expect(screen.getByText('Open the store')).toBeInTheDocument()
    expect(screen.getByText('Prep the sauces')).toBeInTheDocument()
  })
})
