import type { PrincipalResponse } from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { ApiError, authApi, locationsApi, tasksApi } from '../../lib/api.js'
import { LocationManagement } from './location-management.js'

const SUPER_ADMIN: PrincipalResponse = {
  userId: '99999999-9999-9999-9999-999999999999',
  displayName: 'Owner',
  role: 'super_admin',
  locationId: null,
  status: 'active',
}

// The screen under test is the whole chain-at-a-glance surface (The Counter, round 8): the
// branch table with its joined counts, Add branch and Rename living in Dialogs, and the
// create form's soft-duplicate check reading the same list the table renders. Rendered as a
// super_admin by default — the audience Add branch and Delete are gated to (2026-08-23); the
// branch-admin cases below render with a narrower principal instead.
function renderScreen(principal: PrincipalResponse = SUPER_ADMIN): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <LocationManagement principal={principal} />
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

  // The row is the control since the owner's 2026-08-16 ask (the ⋯ menu is gone): opening a
  // branch is one click on it, and both shells' rows carry the same accessible name.
  function openBranch(): void {
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Downtown' })[0] as HTMLElement)
  }

  it('renames a branch through the row’s own dialog', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const rename = vi
      .spyOn(locationsApi, 'rename')
      .mockResolvedValue({ id: DOWNTOWN.id, name: 'Midtown' })
    renderScreen()
    await screen.findByRole('table')

    openBranch()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
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

    openBranch()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Unchanged name closes the dialog without a call; the table row remains.
    await waitFor(() => expect(screen.queryByDisplayValue('Downtown')).toBeNull())
    expect(rename).not.toHaveBeenCalled()
  })

  it('deletes a branch only after the confirmation', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const remove = vi.spyOn(locationsApi, 'remove').mockResolvedValue({ status: 'ok' })
    renderScreen()
    await screen.findByRole('table')

    openBranch()
    fireEvent.click(screen.getByRole('button', { name: 'Delete branch' }))
    // The confirmation names the branch and nothing has been called yet.
    expect(screen.getByText('"Downtown" will be removed. This cannot be undone.')).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete branch' })[0] as HTMLElement)
    await waitFor(() => expect(remove).toHaveBeenCalledWith(DOWNTOWN.id))
  })

  it('explains a branch that still has people or tasks on it instead of deleting it', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    // The API is the authority on whether a branch is empty: it answers 409 and the screen
    // turns that into the instruction, rather than guessing from the counts it holds.
    vi.spyOn(locationsApi, 'remove').mockRejectedValue(new ApiError(409, 'location_in_use'))
    renderScreen()
    await screen.findByRole('table')

    openBranch()
    fireEvent.click(screen.getByRole('button', { name: 'Delete branch' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete branch' })[0] as HTMLElement)

    expect(
      await screen.findByText(
        '"Downtown" still has people or tasks on it. Move them to another branch first, then delete it.',
      ),
    ).toBeTruthy()
    // The branch survives the refusal — it is still listed for the admin to empty.
    expect(within(await screen.findByRole('table')).getByText('Downtown')).toBeTruthy()
  })

  // A branch admin (2026-08-23) reaches this screen too, but Add branch and Delete are
  // chain-wide acts the API refuses them with a flat 403 — so neither renders for one.
  it('hides Add branch for a branch admin', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen({
      userId: '11111111-2222-3333-4444-555555555555',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: DOWNTOWN.id,
      status: 'active',
    })
    await screen.findByRole('table')

    expect(screen.queryByRole('button', { name: 'Add branch' })).toBeNull()
  })

  it('hides Delete in the row dialog for a branch admin', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen({
      userId: '11111111-2222-3333-4444-555555555555',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: DOWNTOWN.id,
      status: 'active',
    })
    await screen.findByRole('table')

    openBranch()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete branch' })).toBeNull()
  })
})
