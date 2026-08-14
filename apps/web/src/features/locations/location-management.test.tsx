import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { authApi, locationsApi, tasksApi } from '../../lib/api.js'
import { LocationManagement } from './location-management.js'

// The screen under test is the whole chain-at-a-glance surface (The Counter, round 8): the
// branch table with its joined counts, Add branch and Rename living in Dialogs, and the
// create form's soft-duplicate check reading the same list the table renders.
function renderScreen(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <LocationManagement />
      </IntlProvider>
    </QueryClientProvider>
  )
  render(ui)
}

const DOWNTOWN = { id: '11111111-1111-1111-1111-111111111111', name: 'Downtown' }

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

  it('lists existing branches in the table with an unassigned manager cell', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Downtown')).toBeTruthy()
    expect(within(table).getByText('Unassigned')).toBeTruthy()
  })

  it('creates a non-colliding name through the Add branch dialog', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const create = vi
      .spyOn(locationsApi, 'create')
      .mockResolvedValue({ id: '22222222-2222-2222-2222-222222222222', name: 'Uptown' })
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

  it('renames a branch through the row menu dialog', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const rename = vi
      .spyOn(locationsApi, 'rename')
      .mockResolvedValue({ id: DOWNTOWN.id, name: 'Midtown' })
    renderScreen()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Downtown' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByDisplayValue('Downtown')
    fireEvent.change(input, { target: { value: 'Midtown' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(rename).toHaveBeenCalledWith(DOWNTOWN.id, { name: 'Midtown' }))
  })

  it('does not call PATCH when the dialog name is unchanged', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const rename = vi.spyOn(locationsApi, 'rename')
    renderScreen()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Downtown' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Unchanged name closes the dialog without a call; the table row remains.
    await waitFor(() => expect(screen.queryByDisplayValue('Downtown')).toBeNull())
    expect(rename).not.toHaveBeenCalled()
  })
})
