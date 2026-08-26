import type { Task, UserSummary } from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { PersonDialog } from './person-dialog.js'

// The person a roster row opens: an identity header, the two tabs, and the same actions the
// row's own menu offers. Access is deliberately empty for now, which is itself worth pinning —
// an empty panel and a broken panel look identical from the outside, so the test says which
// this is.

const NOW = Date.parse('2026-08-24T12:00:00.000Z')
const LOC_A = '11111111-1111-1111-1111-111111111111'
const SELF_ID = 'ad000000-0000-0000-0000-000000000000'

function user(over: Partial<UserSummary> & Pick<UserSummary, 'id' | 'displayName'>): UserSummary {
  return {
    email: `${over.displayName.split(' ')[0]?.toLowerCase()}@bb.test`,
    role: 'employee',
    locationId: LOC_A,
    locationName: 'Downtown',
    status: 'active',
    lastSeenAt: new Date(NOW - 90 * 60 * 1000).toISOString(),
    preferredLanguage: 'en',
    ...over,
  }
}

function task(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    locationId: LOC_A,
    description: null,
    status: 'not_started',
    priority: 'normal',
    dueDate: null,
    completedAt: null,
    position: 0,
    projectId: null,
    personal: false,
    assignees: [],
    checklist: [],
    createdBy: { id: SELF_ID, displayName: 'Admin' },
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...over,
  }
}

function renderDialog(
  subject: UserSummary,
  over?: { tasks?: Task[]; isAdmin?: boolean; canInvite?: boolean; onClose?: () => void },
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <PersonDialog
          user={subject}
          tasks={over?.tasks ?? []}
          isAdmin={over?.isAdmin ?? true}
          canInvite={over?.canInvite ?? over?.isAdmin ?? true}
          selfId={SELF_ID}
          now={NOW}
          onClose={over?.onClose ?? (() => {})}
          onActionError={() => {}}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
  render(ui)
}

const dialog = () => screen.getByRole('dialog')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PersonDialog — the identity header', () => {
  it('prints the person once, and still announces them', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }))
    // The chrome title is HIDDEN, not dropped: the identity block below is the real title, so
    // printing the name in the chrome as well would say it twice on screen. The name still
    // labels the dialog for anyone who cannot see that block, which is the trade `hideTitle`
    // exists to make — so exactly one visible copy, and an accessible name either way.
    expect(dialog()).toHaveAccessibleName('Dana Mizrahi')
    const visible = within(dialog())
      .getAllByText('Dana Mizrahi')
      .filter((node) => !node.className.includes('sr-only'))
    expect(visible).toHaveLength(1)
  })

  it('carries the email, role and branch', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }))
    expect(within(dialog()).getByText('dana@bb.test')).toBeInTheDocument()
    expect(within(dialog()).getByText('Employee')).toBeInTheDocument()
    expect(within(dialog()).getByText('Downtown')).toBeInTheDocument()
  })

  it('says Online for someone here now, and how long ago for someone away', () => {
    renderDialog(
      user({
        id: 'u1',
        displayName: 'Dana Mizrahi',
        lastSeenAt: new Date(NOW - 5000).toISOString(),
      }),
    )
    expect(within(dialog()).getByText('Online')).toBeInTheDocument()
  })

  it('reports an away person by when they were last around', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }))
    expect(within(dialog()).getByText('1 hour ago')).toBeInTheDocument()
  })

  // Presence and account state are different axes; an ordinary active account says nothing
  // about its state, so the badge appearing at all means something is off.
  it('shows the account state only when it is not the ordinary one', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }))
    expect(within(dialog()).queryByText('Active')).not.toBeInTheDocument()
  })

  it('flags a deactivated account in the header', () => {
    renderDialog(user({ id: 'u1', displayName: 'Rami Shalev', status: 'deactivated' }))
    expect(within(dialog()).getByText('Deactivated')).toBeInTheDocument()
    // And never "Online" — a revoked account cannot be in the app.
    expect(within(dialog()).queryByText('Online')).not.toBeInTheDocument()
  })
})

describe('PersonDialog — the two tabs', () => {
  const tabFor = (name: string) => within(dialog()).getByRole('button', { name: new RegExp(name) })

  it('opens on Tasks and counts what the person is carrying', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }), {
      tasks: [
        task({ id: 't1', title: 'Wipe down the grill' }),
        task({ id: 't2', title: 'Restock' }),
      ],
    })
    expect(tabFor('Tasks')).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog()).getByText('2')).toBeInTheDocument()
    expect(within(dialog()).getByText('Wipe down the grill')).toBeInTheDocument()
    expect(within(dialog()).getByText('Restock')).toBeInTheDocument()
  })

  it('says what is missing rather than showing an empty box', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }))
    expect(within(dialog()).getByText('Nothing open')).toBeInTheDocument()
    expect(
      within(dialog()).getByText('Dana Mizrahi has no unfinished tasks right now.'),
    ).toBeInTheDocument()
  })

  it('switches to Access, which is deliberately empty and says so', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }))
    fireEvent.click(tabFor('Access'))

    expect(tabFor('Access')).toHaveAttribute('aria-pressed', 'true')
    expect(tabFor('Tasks')).toHaveAttribute('aria-pressed', 'false')
    expect(
      within(dialog()).getByText(
        'Permissions are set per role on the Access page, in the account menu.',
      ),
    ).toBeInTheDocument()
  })

  it('leaves the task list behind when Access is showing', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }), {
      tasks: [task({ id: 't1', title: 'Wipe down the grill' })],
    })
    fireEvent.click(tabFor('Access'))
    expect(within(dialog()).queryByText('Wipe down the grill')).not.toBeInTheDocument()
  })
})

describe('PersonDialog — the actions footer', () => {
  it('offers the same actions the row menu does, behind a labelled button', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: /Manage/ }))
    expect(screen.getByRole('menuitem', { name: 'Deactivate' })).toBeInTheDocument()
  })

  // The footer is the same component the row uses, so a viewer who may do nothing to this
  // person gets no button at all rather than one that opens an empty menu.
  it('shows no action button when this viewer may do nothing', () => {
    renderDialog(user({ id: SELF_ID, displayName: 'Yourself' }))
    expect(within(dialog()).queryByRole('button', { name: /Manage/ })).not.toBeInTheDocument()
  })
})

describe('PersonDialog — round 2 layout fixes', () => {
  // The close button floats in the header's inline-end corner. Presence sat there too and the
  // two collided; it belongs to the meta row now, which is the structural fact worth pinning —
  // jsdom has no layout, so "do these overlap" can only be asked of the tree.
  it('keeps presence out of the close button’s corner', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }))

    const close = within(dialog()).getByRole('button', { name: 'Close' })
    const presence = within(dialog()).getByText('1 hour ago')
    // Presence rides the meta row beside the role badge, not the corner strip the close owns.
    const meta = within(dialog()).getByText('Employee').closest('div')?.parentElement
    expect(meta).toContainElement(presence)
    expect(meta).not.toContainElement(close)
  })

  it('draws a footer rule only when there is something to do', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }))
    const manage = within(dialog()).getByRole('button', { name: /Manage/ })
    // The rule is on the footer row itself, not inside the menu's own inline-flex wrapper —
    // which is what made it come out only as wide as the button.
    const footer = manage.closest('div.border-t')
    expect(footer).not.toBeNull()
    expect(footer?.className).toContain('justify-end')
  })

  it('leaves no rule behind when this viewer may do nothing', () => {
    renderDialog(user({ id: SELF_ID, displayName: 'Yourself' }))
    expect(within(dialog()).queryByRole('button', { name: /Manage/ })).not.toBeInTheDocument()
    expect(dialog().querySelector('div.border-t')).toBeNull()
  })
})

describe('PersonDialog — priority is the board’s flag, not a word', () => {
  it('marks each task with its priority and names it for a reader', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }), {
      tasks: [
        task({ id: 't1', title: 'Restock the walk-in', priority: 'high' }),
        task({ id: 't2', title: 'Wipe the grill', priority: 'normal' }),
      ],
    })

    expect(dialog().querySelectorAll('[data-priority]')).toHaveLength(2)
    expect(dialog().querySelector('[data-priority="high"]')).not.toBeNull()
    // The word is gone from the row's meta line, but never from the reader's reach. The mark
    // carries its name twice on purpose — once sr-only for a screen reader, once in the bubble
    // a pointer or a press-and-hold opens — so both copies are expected here.
    const high = within(dialog()).getAllByText('Priority: High')
    expect(high).toHaveLength(2)
    expect(high.some((node) => node.className.includes('sr-only'))).toBe(true)
    expect(within(dialog()).getAllByText('Priority: Normal')).toHaveLength(2)
  })

  it('keeps status and due date as words, so the flag is the only thing carrying priority', () => {
    renderDialog(user({ id: 'u1', displayName: 'Dana Mizrahi' }), {
      tasks: [
        task({ id: 't1', title: 'Restock the walk-in', priority: 'high', status: 'in_progress' }),
      ],
    })
    const row = within(dialog()).getByText('Restock the walk-in').closest('li') as HTMLElement
    expect(within(row).getByText('In progress')).toBeInTheDocument()
    // "High" appears only inside the mark's own label, never loose in the meta line.
    expect(row.textContent).not.toContain('In progress · High')
  })
})
