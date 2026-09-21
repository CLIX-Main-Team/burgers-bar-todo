import type { TaskSubject } from '@burgers/shared'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { SubjectCard, subjectFill } from './subject-card.js'

// A subject card (2026-09-20) says four things: which subject, how far along, who is on it, and
// whether the reader may reshape it. The cases pin the two that are easy to get wrong: the
// counts are spoken (not only drawn as a rail) and the +N is the API's number rather than a
// second cap; and the menu exists only for a manager of subjects.

const SUBJECT: TaskSubject = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  departmentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  name: 'Budget 2027',
  description: 'The yearly plan',
  position: 0,
  openCount: 5,
  doneCount: 4,
  assignees: [
    { id: '1', displayName: 'Noa', avatarTone: null },
    { id: '2', displayName: 'Dana', avatarTone: 3 },
  ],
  assigneeOverflow: 3,
}

function renderCard(overrides: Partial<TaskSubject> = {}, canManage = false) {
  render(
    <LocaleProvider>
      <MemoryRouter>
        <ul>
          <SubjectCard
            subject={{ ...SUBJECT, ...overrides }}
            canManage={canManage}
            onRename={vi.fn()}
            onDelete={vi.fn()}
          />
        </ul>
      </MemoryRouter>
    </LocaleProvider>,
  )
}

describe('SubjectCard', () => {
  it('links to the subject, says its counts, and prints the overflow the API counted', () => {
    renderCard()
    expect(screen.getByRole('link', { name: 'Open Budget 2027' })).toHaveAttribute(
      'href',
      `/tasks/subjects/${SUBJECT.id}`,
    )
    expect(screen.getByText('The yearly plan')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('· 4 done')).toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText(/People with open tasks here/)).toHaveTextContent('Noa, Dana')
  })

  it('draws no faces and no overflow for a subject nobody is working in', () => {
    renderCard({ assignees: [], assigneeOverflow: 0, openCount: 0, doneCount: 0 })
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('· 0 done')).toBeInTheDocument()
    expect(screen.queryByText(/People with open tasks here/)).toBeNull()
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('wears its menu only for someone who may manage subjects', () => {
    renderCard({}, false)
    expect(screen.queryByRole('button', { name: 'Subject actions' })).toBeNull()
  })

  it('offers rename and delete to a manager of subjects', () => {
    renderCard({}, true)
    expect(screen.getByRole('button', { name: 'Subject actions' })).toBeInTheDocument()
  })

  it('colours a subject by its slot, so eight siblings never share a swatch', () => {
    const fills = Array.from({ length: 8 }, (_, position) => subjectFill({ position }))
    expect(new Set(fills).size).toBe(8)
    expect(subjectFill({ position: 8 })).toBe(fills[0])
  })
})
