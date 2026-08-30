import type { ProjectSummary } from '@burgers/shared'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { ProjectCard } from './project-card.js'

// The red counter (owner call 2026-08-28): how somebody finds out a step inside a project is
// theirs. It counts OPEN steps, not new ones, so it is the answer to "what is still mine to do"
// and it empties itself as the work gets ticked — which is the whole behaviour worth pinning.

const PROJECT: ProjectSummary = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Winter menu',
  icon: 'menu',
  colour: 'amber',
  locations: [],
  roles: ['manager'],
  startDate: null,
  targetDate: null,
  phase: 'in_progress',
  doneCount: 1,
  taskCount: 4,
  myOpenSteps: 0,
  status: 'in_progress',
  createdBy: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayName: 'Administrator' },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function renderCard(myOpenSteps: number): void {
  render(
    <LocaleProvider>
      <MemoryRouter>
        <ul>
          <ProjectCard project={{ ...PROJECT, myOpenSteps }} />
        </ul>
      </MemoryRouter>
    </LocaleProvider>,
  )
}

describe('ProjectCard — my open steps', () => {
  it('carries the count when steps inside are the reader’s', () => {
    renderCard(3)
    const spoken = screen.getByText('3 steps here are yours')
    expect(spoken).toHaveClass('sr-only')
    expect(spoken.parentElement?.querySelector('[aria-hidden="true"]')).toHaveTextContent('3')
  })

  // The count is spoken, so it has to be spoken properly. "1 steps here are yours" is the
  // ordinary interpolation bug, and it only ever shows up at exactly one.
  it('says it in the singular at one', () => {
    renderCard(1)
    expect(screen.getByText('1 step here is yours')).toBeInTheDocument()
  })

  // Zero is not a quieter badge, it is no badge. A card showing "0" would be a card asking to be
  // read for nothing.
  it('shows nothing at all when none are', () => {
    renderCard(0)
    expect(screen.queryByText(/steps? here (is|are) yours/)).toBeNull()
  })
})
