import { type PrincipalResponse, capabilitiesFor } from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { authApi, locationsApi, tasksApi } from '../../lib/api.js'
import { LocationManagement } from './location-management.js'

const SUPER_ADMIN: PrincipalResponse = {
  userId: '99999999-9999-9999-9999-999999999999',
  displayName: 'Owner',
  role: 'super_admin',
  locationId: null,
  status: 'active',
  capabilities: capabilitiesFor('super_admin'),
}

// The screen under test is the whole chain-at-a-glance surface (The Counter, round 8): the
// branch table with its joined counts, Add branch living in a Dialog, and the create form's
// soft-duplicate check reading the same list the table renders. A row is a route now (round
// 12) rather than a Dialog opener, so the render needs a router: `/locations` mounts the
// screen under test and `/locations/:id` mounts a stub standing in for Task 3's branch page,
// letting a click-through be asserted without pulling that page into this suite. Rendered as
// a super_admin by default — the audience Add branch is gated to (2026-08-23); the
// branch-admin case below renders with a narrower principal instead.
function renderScreen(principal: PrincipalResponse = SUPER_ADMIN): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <MemoryRouter initialEntries={['/locations']}>
          <Routes>
            <Route path="/locations" element={<LocationManagement principal={principal} />} />
            <Route path="/locations/:id" element={<p data-testid="branch-route" />} />
          </Routes>
        </MemoryRouter>
      </IntlProvider>
    </QueryClientProvider>
  )
  render(ui)
}

const DOWNTOWN = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Downtown',
  address: null,
  city: null,
  phone: null,
}

beforeEach(() => {
  // The stat tiles and table counts join the people and board reads; empty stubs keep every
  // test deterministic unless it overrides them.
  vi.spyOn(authApi, 'listUsers').mockResolvedValue({ users: [] })
  vi.spyOn(tasksApi, 'board').mockResolvedValue({ tasks: [], lastSeenAt: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocationManagement', () => {
  it('shows the empty state when no branches exist', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [] })
    renderScreen()
    expect(await screen.findByText('No Locations yet — create the first branch.')).toBeTruthy()
  })

  it('lists existing branches with both leadership cells unassigned', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Downtown')).toBeTruthy()
    // Two cells now, admin and manager, and a branch with neither says so in both. The count
    // is the assertion: one "Unassigned" would mean a column quietly went missing.
    expect(within(table).getAllByText('Unassigned')).toHaveLength(2)
  })

  it('names the branch admin and the manager in their own columns', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    vi.spyOn(authApi, 'listUsers').mockResolvedValue({
      users: [
        {
          id: 'u1',
          email: 'dana@burgers.local',
          displayName: 'Dana Cohen',
          role: 'admin',
          locationId: DOWNTOWN.id,
          locationName: DOWNTOWN.name,
          status: 'active',
          preferredLanguage: 'he',
        },
        {
          id: 'u2',
          email: 'yossi@burgers.local',
          displayName: 'Yossi Levi',
          role: 'manager',
          locationId: DOWNTOWN.id,
          locationName: DOWNTOWN.name,
          status: 'active',
          preferredLanguage: 'he',
        },
      ],
    })
    renderScreen()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Dana Cohen')).toBeTruthy()
    expect(within(table).getByText('Yossi Levi')).toBeTruthy()
    expect(within(table).queryByText('Unassigned')).toBeNull()
  })

  it('creates a non-colliding name through the Add branch dialog', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const create = vi.spyOn(locationsApi, 'create').mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Uptown',
      address: null,
      city: null,
      phone: null,
    })
    renderScreen()
    await screen.findByRole('table')

    fireEvent.click(screen.getAllByRole('button', { name: 'Add branch' })[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Uptown' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Uptown' }))
  })

  it('soft-confirms an exact-name match instead of blocking, then creates on the second submit', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const create = vi.spyOn(locationsApi, 'create').mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Downtown',
      address: null,
      city: null,
      phone: null,
    })
    renderScreen()
    await screen.findByRole('table')

    fireEvent.click(screen.getAllByRole('button', { name: 'Add branch' })[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Downtown' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))

    // First submit holds for confirmation — the create call has not fired yet.
    expect(
      await screen.findByText('A Location named "Downtown" already exists — create anyway?'),
    ).toBeTruthy()
    expect(create).not.toHaveBeenCalled()

    // The button now offers "Create anyway"; a second submit goes through.
    fireEvent.click(screen.getByRole('button', { name: 'Create anyway' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Downtown' }))
  })

  // The row is a route since round 12 (rename and delete moved to the branch page itself,
  // Task 3): both shells render their own row for the same branch in this environment (no
  // CSS to hide either), so every row query here takes the first match, same as the rest of
  // this file did for the old dialog-opening button.
  it('opens the branch page when a row is clicked', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen()
    await screen.findByRole('table')

    fireEvent.click(screen.getAllByRole('link', { name: /Downtown/ })[0] as HTMLElement)
    // The row is a link to the branch, not a dialog opener, since round 12.
    expect(await screen.findByTestId('branch-route')).toBeTruthy()
  })

  it('shows the city beneath the branch name', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({
      locations: [{ ...DOWNTOWN, city: 'Tel Aviv' }],
    })
    renderScreen()
    expect(await screen.findByText('Tel Aviv')).toBeTruthy()
  })

  // A branch admin (2026-08-23) reaches this screen too, but Add branch is a chain-wide act
  // the API refuses with a flat 403 — so it renders for a super_admin only.
  it('hides Add branch for a branch admin', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen({
      userId: '11111111-2222-3333-4444-555555555555',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: DOWNTOWN.id,
      status: 'active',
      capabilities: capabilitiesFor('admin'),
    })
    await screen.findByRole('table')

    expect(screen.queryByRole('button', { name: 'Add branch' })).toBeNull()
  })
})
