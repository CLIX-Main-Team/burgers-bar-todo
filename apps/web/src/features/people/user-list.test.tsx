import type { Task, UserSummary } from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { authApi } from '../../lib/api.js'
import { UserList } from './user-list.js'

// The roster recut to The Counter's table (round 8): the columns, the status note on the
// person's second line, the row menu's principal-scoped gating, and the deactivate
// AlertDialog. The list scope and filtering are the screen's job now — this renders exactly
// the users it is given. JSDOM applies no breakpoints, so the desktop table and the phone
// rows both mount; every query scopes into the table to stay unambiguous.

// The roster is rendered against a pinned instant, so every relative time in these tests is
// deterministic and no assertion drifts with how long the suite takes to run.
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
    // Long enough ago to read as away, so a fixture never accidentally lands inside the
    // online window and makes an unrelated assertion depend on the wall clock. The presence
    // cases pin their own stamp against NOW.
    lastSeenAt: new Date(NOW - 90 * 60 * 1000).toISOString(),
    preferredLanguage: 'en',
    ...over,
  }
}

function renderList(
  users: UserSummary[],
  over?: {
    openTasks?: Map<string, Task[]>
    isAdmin?: boolean
    canInvite?: boolean
    onOpen?: (user: UserSummary) => void
    onActionError?: () => void
  },
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <UserList
          users={users}
          openTasks={over?.openTasks ?? new Map()}
          isAdmin={over?.isAdmin ?? true}
          canInvite={over?.canInvite ?? over?.isAdmin ?? true}
          selfId={SELF_ID}
          now={NOW}
          onOpen={over?.onOpen ?? (() => {})}
          onActionError={over?.onActionError ?? (() => {})}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
  render(ui)
}

// The roster only ever reads a carried task's COUNT, so these are the thinnest rows that satisfy
// the contract — the person dialog is where a task's own fields are rendered and asserted.
function openTasksFor(count: number): Task[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `t${index}`,
    locationId: LOC_A,
    title: `Task ${index}`,
    description: null,
    status: 'not_started',
    priority: 'normal',
    dueDate: null,
    completedAt: null,
    position: index,
    projectId: null,
    personal: false,
    assignees: [],
    createdBy: { id: SELF_ID, displayName: 'Admin' },
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  }))
}

const table = () => screen.getByRole('table')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UserList — table composition', () => {
  it('renders who, role, branch, and the open-task load per row', () => {
    const dana = user({ id: 'u1000000-0000-0000-0000-000000000000', displayName: 'Dana Mizrahi' })
    renderList([dana], { openTasks: new Map([[dana.id, openTasksFor(3)]]) })

    const row = within(table()).getByText('Dana Mizrahi').closest('tr') as HTMLElement
    expect(within(row).getByText('dana@bb.test')).toBeInTheDocument()
    expect(within(row).getByText('Employee')).toBeInTheDocument()
    expect(within(row).getByText('Downtown')).toBeInTheDocument()
    expect(within(row).getByText('3')).toBeInTheDocument()
  })

  it('shows a quiet dash for a person with no open tasks', () => {
    renderList([user({ id: 'u1000000-0000-0000-0000-000000000000', displayName: 'Noa Barak' })])
    const row = within(table()).getByText('Noa Barak').closest('tr') as HTMLElement
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('notes a pending invite on the person line and dims a deactivated row', () => {
    const invited = user({
      id: 'u1000000-0000-0000-0000-000000000000',
      displayName: 'Noa Barak',
      status: 'invited',
    })
    const off = user({
      id: 'u2000000-0000-0000-0000-000000000000',
      displayName: 'Eli Peretz',
      status: 'deactivated',
    })
    renderList([invited, off])

    // Read the whole line rather than one text node: each variable piece is bidi-isolated in
    // its own <bdi>, so the email and the status note are deliberately separate nodes.
    const invitedRow = within(table()).getByText('Noa Barak').closest('tr') as HTMLElement
    expect(invitedRow.textContent).toContain('noa@bb.test · Invited')
    const offRow = within(table()).getByText('Eli Peretz').closest('tr') as HTMLElement
    expect(offRow.className).toContain('opacity-60')
  })

  it('prints the resolved chain-wide label for a location-less admin, never a uuid', () => {
    renderList([
      user({
        id: 'u1000000-0000-0000-0000-000000000000',
        displayName: 'Ada Levi',
        role: 'admin',
        locationId: null,
        locationName: null,
      }),
    ])
    expect(within(table()).getByText('Chain-wide')).toBeInTheDocument()
  })
})

describe('UserList — row menu gating (mirrors the API scope, ADR-0007)', () => {
  it('offers resend/revoke on a pending invite and deactivate on an active user (admin)', () => {
    const invited = user({
      id: 'u1000000-0000-0000-0000-000000000000',
      displayName: 'Noa Barak',
      status: 'invited',
    })
    const active = user({ id: 'u2000000-0000-0000-0000-000000000000', displayName: 'Eli Peretz' })
    renderList([invited, active])

    fireEvent.click(within(table()).getByRole('button', { name: 'Actions for Noa Barak' }))
    expect(screen.getByRole('menuitem', { name: 'Resend invite' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Revoke invite' })).toBeInTheDocument()

    fireEvent.click(within(table()).getByRole('button', { name: 'Actions for Eli Peretz' }))
    expect(screen.getByRole('menuitem', { name: 'Deactivate' })).toBeInTheDocument()
  })

  it('gives a manager no row actions at all — not even on the invites they sent', () => {
    const invitedEmployee = user({
      id: 'u1000000-0000-0000-0000-000000000000',
      displayName: 'Noa Barak',
      status: 'invited',
    })
    const invitedManager = user({
      id: 'u2000000-0000-0000-0000-000000000000',
      displayName: 'Mia Cohen',
      role: 'manager',
      status: 'invited',
    })
    const active = user({ id: 'u3000000-0000-0000-0000-000000000000', displayName: 'Eli Peretz' })
    renderList([invitedEmployee, invitedManager, active], { isAdmin: false, canInvite: true })

    // A manager chases the invites they sent — people.invite carries the paperwork since
    // 2026-08-26 — but deactivating is people.deactivate, which they never held. So a pending
    // row has a menu and an active one does not, rather than every row opening onto a call the
    // API would refuse.
    expect(within(table()).getByRole('button', { name: 'Actions for Noa Barak' })).toBeVisible()
    expect(within(table()).getByRole('button', { name: 'Actions for Mia Cohen' })).toBeVisible()
    expect(
      within(table()).queryByRole('button', { name: 'Actions for Eli Peretz' }),
    ).not.toBeInTheDocument()
  })

  it('leaves every row menu-free for someone who holds neither switch', () => {
    const invited = user({
      id: 'u1000000-0000-0000-0000-000000000000',
      displayName: 'Noa Barak',
      status: 'invited',
    })
    const active = user({ id: 'u3000000-0000-0000-0000-000000000000', displayName: 'Eli Peretz' })
    renderList([invited, active], { isAdmin: false, canInvite: false })

    expect(
      within(table()).queryByRole('button', { name: 'Actions for Noa Barak' }),
    ).not.toBeInTheDocument()
    expect(
      within(table()).queryByRole('button', { name: 'Actions for Eli Peretz' }),
    ).not.toBeInTheDocument()
  })

  it("never offers deactivate on the acting admin's own row", () => {
    renderList([user({ id: SELF_ID, displayName: 'Ada Levi', role: 'admin' })])
    expect(
      within(table()).queryByRole('button', { name: 'Actions for Ada Levi' }),
    ).not.toBeInTheDocument()
  })
})

describe('UserList — deactivate flows through the AlertDialog', () => {
  it('fires the write only after the dialog confirms', async () => {
    const deactivateSpy = vi
      .spyOn(authApi, 'deactivateUser')
      .mockResolvedValue({ status: 'ok' } as never)
    const active = user({ id: 'u2000000-0000-0000-0000-000000000000', displayName: 'Eli Peretz' })
    renderList([active])

    fireEvent.click(within(table()).getByRole('button', { name: 'Actions for Eli Peretz' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }))
    expect(screen.getByText('Deactivate Eli Peretz?')).toBeInTheDocument()
    expect(deactivateSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(deactivateSpy).toHaveBeenCalledWith(active.id))
  })

  // The notice itself is the screen's to render — a failed write can come from a row's menu or
  // from the person dialog's, and both should land in ONE place above the roster. What this
  // list owes is the report.
  it('reports a failed row action up rather than showing its own notice', async () => {
    vi.spyOn(authApi, 'resendInvite').mockRejectedValue(new Error('boom'))
    const onActionError = vi.fn()
    const invited = user({
      id: 'u1000000-0000-0000-0000-000000000000',
      displayName: 'Noa Barak',
      status: 'invited',
    })
    renderList([invited], { onActionError })

    fireEvent.click(within(table()).getByRole('button', { name: 'Actions for Noa Barak' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resend invite' }))

    await waitFor(() => expect(onActionError).toHaveBeenCalled())
  })
})

describe('UserList — a row opens the person', () => {
  // The row target is a real button, not a click handler on the <tr>: a pointer presses
  // anywhere on the row because the button's `after` stretches across it, and a keyboard
  // reaches the same control by tabbing to it. Both paths are one element, so they cannot
  // disagree — which a row-onClick plus a separate button would eventually do.
  it('opens the person from the row target', () => {
    const onOpen = vi.fn()
    const dana = user({ id: 'u1000000-0000-0000-0000-000000000000', displayName: 'Dana Mizrahi' })
    renderList([dana], { onOpen })

    fireEvent.click(within(table()).getByRole('button', { name: 'Open Dana Mizrahi' }))
    expect(onOpen).toHaveBeenCalledWith(dana)
  })

  // jsdom does not hit-test pseudo-elements, so the row-wide reach is pinned structurally:
  // the target must stretch across a positioned row, or clicking anywhere but the name
  // itself would quietly stop working.
  it('stretches that target across the whole row', () => {
    const dana = user({ id: 'u1000000-0000-0000-0000-000000000000', displayName: 'Dana Mizrahi' })
    renderList([dana])

    const target = within(table()).getByRole('button', { name: 'Open Dana Mizrahi' })
    expect(target.className).toContain('after:inset-0')
    expect((target.closest('tr') as HTMLElement).className).toContain('relative')
  })

  // The regression worth pinning: that stretched target covers the ⋯ as well, so the actions
  // cell has to be lifted above it. Without the lift the menu is visible and completely dead,
  // and every press meant for it opens the person instead.
  it('keeps the row menu reachable above that target', () => {
    const onOpen = vi.fn()
    const dana = user({ id: 'u1000000-0000-0000-0000-000000000000', displayName: 'Dana Mizrahi' })
    renderList([dana], { onOpen })

    const menu = within(table()).getByRole('button', { name: 'Actions for Dana Mizrahi' })
    const cell = menu.closest('td') as HTMLElement
    expect(cell.className).toContain('z-10')
    expect(cell.className).toContain('relative')

    fireEvent.click(menu)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }))
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('UserList — a Hebrew value must not drag its column out of line', () => {
  // The bug this pins: `dir="auto"` on the cell resolves the CELL's direction from its own text,
  // so a Hebrew branch name flipped that one cell to RTL and pushed its value to the opposite
  // edge, leaving the column ragged with a gap down the middle while the English rows stayed put.
  // The fix isolates the value (<bdi>) instead of steering the cell, so the column aligns by the
  // interface language and every row starts on the same edge whatever script the value is in.
  const branchCellOf = (name: string): HTMLElement => {
    const row = within(table()).getByText(name).closest('tr') as HTMLTableRowElement
    return row.cells[2] as HTMLElement
  }

  it('leaves the branch cell alignment to the column, not to the value', () => {
    renderList([
      user({
        id: 'u1000000-0000-0000-0000-000000000000',
        displayName: 'Dana Mizrahi',
        locationName: 'סניף הרצליה',
      }),
      user({
        id: 'u2000000-0000-0000-0000-000000000000',
        displayName: 'Eli Peretz',
        locationName: null,
        locationId: null,
      }),
    ])

    const hebrew = branchCellOf('Dana Mizrahi')
    const english = branchCellOf('Eli Peretz')
    // Neither cell steers itself: no direction attribute on either, so both inherit the page's.
    expect(hebrew.getAttribute('dir')).toBeNull()
    expect(english.getAttribute('dir')).toBeNull()
    // And the Hebrew value is still isolated, so it renders correctly inside that shared column.
    expect(hebrew.querySelector('bdi')?.textContent).toBe('סניף הרצליה')
    expect(english.textContent).toBe('Chain-wide')
  })

  it('isolates a Hebrew name without re-aligning the person cell', () => {
    renderList([user({ id: 'u3000000-0000-0000-0000-000000000000', displayName: 'רונן כץ' })])
    const row = within(table()).getByText('רונן כץ').closest('tr') as HTMLTableRowElement
    expect((row.cells[0] as HTMLElement).getAttribute('dir')).toBeNull()
    expect(within(row).getByText('רונן כץ').tagName).toBe('BDI')
  })
})

describe('UserList — the presence column', () => {
  // The roster's rows are pinned to NOW, so these read the column exactly as a manager would
  // at that instant. Presence itself is unit-tested in presence.test.ts; what matters here is
  // that the row shows both halves of it — the word AND, for someone here, the dot.
  const rowFor = (name: string) =>
    within(table()).getByText(name).closest('tr') as HTMLTableRowElement

  it('says Online for someone using the app right now', () => {
    renderList([
      user({
        id: 'u1000000-0000-0000-0000-000000000000',
        displayName: 'Dana Mizrahi',
        lastSeenAt: new Date(NOW - 30 * 1000).toISOString(),
      }),
    ])
    expect(within(rowFor('Dana Mizrahi')).getByText('Online')).toBeInTheDocument()
  })

  it('says how long ago someone was last around', () => {
    renderList([
      user({
        id: 'u2000000-0000-0000-0000-000000000000',
        displayName: 'Eli Peretz',
        lastSeenAt: new Date(NOW - 20 * 60 * 1000).toISOString(),
      }),
    ])
    expect(within(rowFor('Eli Peretz')).getByText('20 minutes ago')).toBeInTheDocument()
  })

  // The accessibility rule the whole column is shaped around: presence is never carried by
  // colour alone. If this passes, the roster is readable without colour vision.
  it('never states presence by the dot alone — the word is always in the row', () => {
    renderList([
      user({
        id: 'u3000000-0000-0000-0000-000000000000',
        displayName: 'Yael Cohen',
        lastSeenAt: new Date(NOW - 10 * 1000).toISOString(),
      }),
    ])
    const row = rowFor('Yael Cohen')
    expect(within(row).getByText('Online')).toBeInTheDocument()
    // The dot is decorative and hidden from assistive tech precisely because the word carries
    // the meaning; it must never be the only thing that does.
    expect(row.querySelectorAll('[aria-hidden="true"].bg-success')).toHaveLength(1)
  })

  it('shows no dot for someone who is away', () => {
    renderList([
      user({
        id: 'u4000000-0000-0000-0000-000000000000',
        displayName: 'Omer Levi',
        lastSeenAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
      }),
    ])
    const row = rowFor('Omer Levi')
    expect(row.querySelectorAll('.bg-success')).toHaveLength(0)
    expect(within(row).getByText('2 hours ago')).toBeInTheDocument()
  })

  it('never calls a deactivated account online, however recent its last stamp', () => {
    renderList([
      user({
        id: 'u5000000-0000-0000-0000-000000000000',
        displayName: 'Rami Shalev',
        status: 'deactivated',
        lastSeenAt: new Date(NOW - 15 * 1000).toISOString(),
      }),
    ])
    const row = rowFor('Rami Shalev')
    expect(within(row).queryByText('Online')).not.toBeInTheDocument()
    expect(row.querySelectorAll('.bg-success')).toHaveLength(0)
  })

  it('leaves the column quiet for an invited person who has never signed in', () => {
    renderList([
      user({
        id: 'u6000000-0000-0000-0000-000000000000',
        displayName: 'Noa Barak',
        status: 'invited',
        lastSeenAt: null,
      }),
    ])
    const row = rowFor('Noa Barak')
    expect(within(row).getByTitle('Never signed in')).toBeInTheDocument()
    expect(within(row).queryByText('Online')).not.toBeInTheDocument()
  })
})
