import type { PrincipalResponse, UserSummary } from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { authApi } from '../../lib/api.js'
import { UserList } from './user-list.js'

// The roster's UI wiring over a stubbed /users: the card composition, the row overflow menu's
// principal-scoped gating, the deactivate AlertDialog, and the loading / empty / error states.
// The list scope is the API's job (ADR-0007); each test stubs what that scope would return and
// asserts what the audience is shown.

const LOC_A = '11111111-1111-1111-1111-111111111111'
const LOC_B = '22222222-2222-2222-2222-222222222222'

const ADMIN: PrincipalResponse = {
  userId: 'ad000000-0000-0000-0000-000000000000',
  role: 'admin',
  locationId: null,
  status: 'active',
}
const MANAGER: PrincipalResponse = {
  userId: 'ma000000-0000-0000-0000-000000000000',
  role: 'manager',
  locationId: LOC_A,
  status: 'active',
}

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
  principal: PrincipalResponse,
  users: UserSummary[],
  onInvite?: () => void,
): void {
  vi.spyOn(authApi, 'listUsers').mockResolvedValue({ users })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <UserList principal={principal} onInvite={onInvite} />
      </IntlProvider>
    </QueryClientProvider>
  )
  render(ui)
}

// Open a row's overflow menu by its accessible name, so the menu's items become queryable.
async function openRowMenu(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UserList — card composition', () => {
  it('renders a person as name-over-email with a status badge, role, and named location — never a uuid', async () => {
    renderList(ADMIN, [
      user({
        id: 'u1',
        displayName: 'Ada Admin',
        role: 'admin',
        locationId: null,
        locationName: null,
        status: 'active',
      }),
      user({
        id: 'u2',
        displayName: 'Ivy Invitee',
        status: 'invited',
        locationId: LOC_B,
        locationName: 'Airport',
      }),
    ])

    const ivyName = await screen.findByText('Ivy Invitee')
    expect(screen.getByText('ivy@bb.test')).toBeTruthy()
    // The status shows through the Badge (scoped to Ivy's card — the section header also reads
    // "Invited"), the role in plain text, and the location by its resolved name — the admin's
    // own row reads as "Chain-wide", never the raw id.
    const ivyCard = ivyName.closest('.rounded-lg') as HTMLElement
    expect(within(ivyCard).getByText('Invited')).toBeTruthy()
    expect(within(ivyCard).getByText('Employee')).toBeTruthy()
    expect(screen.getByText('· Airport')).toBeTruthy()
    expect(screen.getByText('· Chain-wide')).toBeTruthy()
    // No uuid leaks onto the screen (the headline defect this slice fixes).
    expect(screen.queryByText(LOC_B)).toBeNull()
    expect(screen.queryByText(LOC_A)).toBeNull()
  })

  it('a manager sees no location line on cards and no location filter', async () => {
    renderList(MANAGER, [user({ id: 'u1', displayName: 'Ash Active' })])
    await screen.findByText('Ash Active')
    expect(screen.queryByText('· Downtown')).toBeNull()
    expect(screen.queryByLabelText('Filter by location')).toBeNull()
  })

  it('dims a deactivated card to ~60% without a strikethrough', async () => {
    const { container } = renderContainer(ADMIN, [
      user({ id: 'u1', displayName: 'Dan Gone', status: 'deactivated' }),
    ])
    await screen.findByText('Dan Gone')
    const dimmed = container.querySelector('.opacity-60')
    expect(dimmed).not.toBeNull()
    expect(dimmed?.textContent).toContain('Dan Gone')
    expect(dimmed?.querySelector('.line-through')).toBeNull()
  })
})

describe('UserList — row menu gating (ADR-0007)', () => {
  it('an admin gets Resend/Revoke on an invite, Deactivate on an active user, Reactivate on a deactivated one', async () => {
    renderList(ADMIN, [
      user({ id: 'u1', displayName: 'Ivy Invitee', status: 'invited' }),
      user({ id: 'u2', displayName: 'Ash Active', status: 'active' }),
      user({ id: 'u3', displayName: 'Dan Gone', status: 'deactivated' }),
    ])
    await screen.findByText('Ivy Invitee')

    await openRowMenu('Ivy Invitee')
    expect(screen.getByRole('menuitem', { name: 'Resend invite' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Revoke invite' })).toBeTruthy()

    await openRowMenu('Ash Active')
    expect(screen.getByRole('menuitem', { name: 'Deactivate' })).toBeTruthy()

    await openRowMenu('Dan Gone')
    expect(screen.getByRole('menuitem', { name: 'Reactivate' })).toBeTruthy()
  })

  it("never offers Deactivate on the acting admin's own active row", async () => {
    renderList(ADMIN, [
      user({
        id: ADMIN.userId,
        displayName: 'Me Admin',
        role: 'admin',
        locationId: null,
        locationName: null,
      }),
    ])
    await screen.findByText('Me Admin')
    // The own row carries no actions at all (an admin only-active-self has nothing to act on),
    // so there is no overflow trigger — and certainly no Deactivate.
    expect(screen.queryByRole('button', { name: 'Actions for Me Admin' })).toBeNull()
  })

  it('a manager gets Resend/Revoke on an employee invite but no Deactivate/Reactivate anywhere', async () => {
    renderList(MANAGER, [
      user({ id: 'u1', displayName: 'Ivy Invitee', status: 'invited', role: 'employee' }),
      user({ id: 'u2', displayName: 'Ash Active', status: 'active' }),
      user({ id: 'u3', displayName: 'Dan Gone', status: 'deactivated' }),
    ])
    await screen.findByText('Ivy Invitee')

    await openRowMenu('Ivy Invitee')
    expect(screen.getByRole('menuitem', { name: 'Resend invite' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Revoke invite' })).toBeTruthy()

    // No lifecycle control is ever offered to a manager — the active and deactivated rows carry
    // no overflow menu, so cutting/restoring access is withheld, not merely hidden.
    expect(screen.queryByRole('button', { name: 'Actions for Ash Active' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Actions for Dan Gone' })).toBeNull()
  })

  it('a manager cannot act on a manager invite in their own list (out of their action scope)', async () => {
    renderList(MANAGER, [
      user({ id: 'u1', displayName: 'Meg Manager', status: 'invited', role: 'manager' }),
    ])
    await screen.findByText('Meg Manager')
    expect(screen.queryByRole('button', { name: 'Actions for Meg Manager' })).toBeNull()
  })
})

describe('UserList — deactivate confirm', () => {
  it('routes Deactivate through an AlertDialog and calls the endpoint only on confirm', async () => {
    const deactivate = vi
      .spyOn(authApi, 'deactivateUser')
      .mockResolvedValue(user({ id: 'u2', displayName: 'Ash Active', status: 'deactivated' }))
    renderList(ADMIN, [user({ id: 'u2', displayName: 'Ash Active', status: 'active' })])
    await screen.findByText('Ash Active')

    await openRowMenu('Ash Active')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }))

    // The confirm modal opens; the endpoint has not fired yet.
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Deactivate Ash Active?')).toBeTruthy()
    expect(deactivate).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(deactivate).toHaveBeenCalledWith('u2'))
  })
})

describe('UserList — display states', () => {
  it('shows a loading region that is aria-busy while the list is pending', async () => {
    vi.spyOn(authApi, 'listUsers').mockReturnValue(new Promise(() => {}))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={messages.en}>
          <UserList principal={ADMIN} />
        </IntlProvider>
      </QueryClientProvider>,
    )
    const region = await screen.findByLabelText('Loading people')
    expect(region.getAttribute('aria-busy')).toBe('true')
  })

  it('shows the empty state with a primary Invite call to action', async () => {
    const onInvite = vi.fn()
    renderList(ADMIN, [], onInvite)
    expect(await screen.findByText('No one here yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }))
    expect(onInvite).toHaveBeenCalled()
  })

  it('shows the error state with a Try again affordance when the list fails to load', async () => {
    vi.spyOn(authApi, 'listUsers').mockRejectedValue(new Error('boom'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={messages.en}>
          <UserList principal={ADMIN} />
        </IntlProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText("Couldn't load people")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

// A render that returns the container, for the one class-level assertion (the deactivated dim).
function renderContainer(principal: PrincipalResponse, users: UserSummary[]) {
  vi.spyOn(authApi, 'listUsers').mockResolvedValue({ users })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <UserList principal={principal} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}
