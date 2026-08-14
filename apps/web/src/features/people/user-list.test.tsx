import type { UserSummary } from '@burgers/shared'
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

const LOC_A = '11111111-1111-1111-1111-111111111111'
const SELF_ID = 'ad000000-0000-0000-0000-000000000000'

function user(over: Partial<UserSummary> & Pick<UserSummary, 'id' | 'displayName'>): UserSummary {
  return {
    email: `${over.displayName.split(' ')[0]?.toLowerCase()}@bb.test`,
    role: 'employee',
    locationId: LOC_A,
    locationName: 'Downtown',
    status: 'active',
    preferredLanguage: 'en',
    ...over,
  }
}

function renderList(
  users: UserSummary[],
  over?: { openTasks?: Map<string, number>; isAdmin?: boolean },
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <UserList
          users={users}
          openTasks={over?.openTasks ?? new Map()}
          isAdmin={over?.isAdmin ?? true}
          selfId={SELF_ID}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
  render(ui)
}

const table = () => screen.getByRole('table')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UserList — table composition', () => {
  it('renders who, role, branch, and the open-task load per row', () => {
    const dana = user({ id: 'u1000000-0000-0000-0000-000000000000', displayName: 'Dana Mizrahi' })
    renderList([dana], { openTasks: new Map([[dana.id, 3]]) })

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

    expect(within(table()).getByText(/noa@bb\.test · Invited/)).toBeInTheDocument()
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

  it('gives a manager invite actions only on an employee invite, and no deactivate', () => {
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
    renderList([invitedEmployee, invitedManager, active], { isAdmin: false })

    expect(
      within(table()).getByRole('button', { name: 'Actions for Noa Barak' }),
    ).toBeInTheDocument()
    // A manager invite is out of a manager's remit, and an active user has no manager action —
    // neither row renders a menu at all.
    expect(
      within(table()).queryByRole('button', { name: 'Actions for Mia Cohen' }),
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

  it('surfaces one shared notice when a row action fails', async () => {
    vi.spyOn(authApi, 'resendInvite').mockRejectedValue(new Error('boom'))
    const invited = user({
      id: 'u1000000-0000-0000-0000-000000000000',
      displayName: 'Noa Barak',
      status: 'invited',
    })
    renderList([invited])

    fireEvent.click(within(table()).getByRole('button', { name: 'Actions for Noa Barak' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resend invite' }))

    expect(
      await screen.findByText('That action could not be completed. Refresh and try again.'),
    ).toBeInTheDocument()
  })
})
