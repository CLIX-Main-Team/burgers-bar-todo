import { type PrincipalResponse, capabilitiesFor } from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { locationsApi } from '../../lib/api.js'
import { InviteForm } from './invite-form.js'

const BRANCH = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Dizengoff',
  number: null,
  address: null,
  city: null,
  phone: null,
}

function renderInviteForm(principal: Pick<PrincipalResponse, 'role' | 'locationId'>): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <InviteForm
          principal={{
            userId: '22222222-2222-2222-2222-222222222222',
            displayName: 'Someone',
            status: 'active',
            capabilities: capabilitiesFor(principal.role),
            ...principal,
          }}
          onClose={() => {}}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // The branch picker reads the locations list; one branch keeps every case deterministic.
  vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [BRANCH] })
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

  it.each(['ceo', 'finance_manager', 'driver'])(
    'hides the branch picker when a super_admin picks the branch-less %s',
    async (role) => {
      renderInviteForm({ role: 'super_admin', locationId: null })
      await screen.findByLabelText('Location')
      fireEvent.change(screen.getByLabelText('Role'), { target: { value: role } })
      expect(screen.queryByLabelText('Location')).not.toBeInTheDocument()
    },
  )
})
