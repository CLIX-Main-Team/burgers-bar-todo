import { type PrincipalResponse, type UserSummary, capabilitiesFor } from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { messages } from '../../i18n/messages.js'
import { authApi, departmentsApi, locationsApi } from '../../lib/api.js'
import { InviteForm } from './invite-form.js'

const BRANCH = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Dizengoff',
  kind: 'branch' as const,
  number: null,
  address: null,
  city: null,
  phone: null,
}

const FINANCE = {
  id: '33333333-3333-3333-3333-333333333333',
  slug: 'finance',
  nameHe: 'כספים',
  nameEn: 'Finance',
  position: 6,
}
const OPERATIONS = {
  id: '44444444-4444-4444-4444-444444444444',
  slug: 'operations',
  nameHe: 'תפעול',
  nameEn: 'Operations',
  position: 2,
}

function renderInviteForm(principal: Pick<PrincipalResponse, 'role' | 'locationId'>): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <IntlProvider locale="en" messages={messages.en}>
          <InviteForm
            principal={{
              userId: '22222222-2222-2222-2222-222222222222',
              displayName: 'Someone',
              email: 'someone@bb.test',
              avatarTone: null,
              locationName: null,
              locationKind: principal.locationId ? 'branch' : null,
              departmentId: FINANCE.id,
              status: 'active',
              capabilities: capabilitiesFor(principal.role),
              viewScopes: {},
              ...principal,
            }}
            onClose={() => {}}
          />
        </IntlProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // The branch picker reads the locations list; one branch keeps every case deterministic.
  vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [BRANCH] })
  // The department picker reads the departments list, in the API's own order.
  vi.spyOn(departmentsApi, 'list').mockResolvedValue({ departments: [OPERATIONS, FINANCE] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// The invite form is where the new role boundary is most visible: a branch admin may staff their
// own branch and may not appoint peers, so the role select and the branch picker both change shape
// with the principal. Presentation only — the API refuses either way (ADR-0007).
describe('invite form, by principal role', () => {
  it('offers a super_admin every role, the HQ roles included', () => {
    renderInviteForm({ role: 'super_admin', locationId: null })
    const options = screen.getAllByRole('option').map((o) => o.getAttribute('value'))
    expect(options).toEqual(expect.arrayContaining(['super_admin', 'admin', 'manager', 'employee']))
    expect(options).toEqual(expect.arrayContaining(['ceo', 'finance_manager', 'driver']))
  })

  it('offers a branch admin only the branch roles beneath them', () => {
    renderInviteForm({ role: 'admin', locationId: 'branch-1' })
    const options = screen.getAllByRole('option').map((o) => o.getAttribute('value'))
    expect(options).toEqual(expect.arrayContaining(['manager', 'employee']))
    expect(options).not.toContain('admin')
    expect(options).not.toContain('super_admin')
    // An HQ role is the chain's to hand out, senior or junior: none of them is a branch hire.
    expect(options).not.toContain('ceo')
    expect(options).not.toContain('office_manager')
    expect(options).not.toContain('driver')
    expect(options).not.toContain('field_ops')
  })

  it.each(['admin', 'manager', 'employee'])(
    'shows the branch picker when a super_admin picks %s',
    async (role) => {
      renderInviteForm({ role: 'super_admin', locationId: null })
      fireEvent.change(screen.getByLabelText('Role'), { target: { value: role } })
      expect(await screen.findByLabelText('Location')).toBeInTheDocument()
    },
  )

  it('hides the branch picker when a super_admin picks Owner', async () => {
    renderInviteForm({ role: 'super_admin', locationId: null })
    // The default role is Employee, which needs a branch; wait for that picker to land
    // before switching to Owner, so the assertion below is a genuine appear-then-disappear.
    await screen.findByLabelText('Location')
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'super_admin' } })
    expect(screen.queryByLabelText('Location')).not.toBeInTheDocument()
  })

  // Every role but the owner holds a location (2026-09-20): an HQ role holds the head office,
  // a driver holds a branch, and the picker stays for all of them. Until then these three were
  // branch-less and the picker disappeared for them the way it still does for Owner above.
  it.each(['ceo', 'finance_manager', 'driver'])(
    'keeps the location picker when a super_admin picks %s',
    async (role) => {
      renderInviteForm({ role: 'super_admin', locationId: null })
      await screen.findByLabelText('Location')
      fireEvent.change(screen.getByLabelText('Role'), { target: { value: role } })
      expect(screen.getByLabelText('Location')).toBeInTheDocument()
    },
  )
})

// The department picker (2026-09-20) is asked of every inviter for every role, and it is
// required (2026-09-21): it opens on a placeholder, the form will not send until a desk is
// chosen, and a list that will not load holds Send and says so under the field.
describe('invite form, the department picker', () => {
  const sentInvite = (): UserSummary => ({
    id: '55555555-5555-5555-5555-555555555555',
    email: 'noa@bb.test',
    displayName: 'Noa',
    avatarTone: null,
    role: 'employee',
    locationId: BRANCH.id,
    locationName: BRANCH.name,
    departmentId: FINANCE.id,
    status: 'invited',
    preferredLanguage: 'en',
    lastSeenAt: null,
  })

  const fillPerson = () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'noa@bb.test' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Noa' } })
  }

  it('opens on the placeholder and lists the departments in the API order, by UI language', async () => {
    renderInviteForm({ role: 'super_admin', locationId: null })
    const picker = screen.getByLabelText('Department') as HTMLSelectElement
    expect(picker.value).toBe('')
    expect(picker).toBeRequired()
    await waitFor(() =>
      expect(Array.from(picker.options).map((o) => o.textContent)).toEqual([
        'Choose a department',
        'Operations',
        'Finance',
      ]),
    )
  })

  it('sends the chosen department with the invite', async () => {
    const create = vi.spyOn(authApi, 'createInvite').mockResolvedValue(sentInvite())
    renderInviteForm({ role: 'admin', locationId: BRANCH.id })
    await screen.findByRole('option', { name: 'Finance' })
    fillPerson()
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: FINANCE.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ departmentId: FINANCE.id })
  })

  it('does not send until a department is chosen, a manager included', async () => {
    const create = vi.spyOn(authApi, 'createInvite').mockResolvedValue(sentInvite())
    renderInviteForm({ role: 'manager', locationId: BRANCH.id })
    // A manager's role is fixed, and the department is still theirs to ask.
    await screen.findByRole('option', { name: 'Finance' })
    fillPerson()
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    // Nothing sent: the empty placeholder is refused by the field's own required rule, and
    // the API would refuse it too, so the invite never leaves with a blank where a desk goes.
    await waitFor(() => expect(screen.getByLabelText('Department')).toBeInvalid())
    expect(create).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Department'), { target: { value: OPERATIONS.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ departmentId: OPERATIONS.id })
  })

  it('holds Send and says so under the field while the list has not loaded', async () => {
    vi.spyOn(departmentsApi, 'list').mockRejectedValue(new Error('down'))
    renderInviteForm({ role: 'admin', locationId: BRANCH.id })
    expect(
      await screen.findByText('Could not load the departments. Refresh and try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled()
  })
})
