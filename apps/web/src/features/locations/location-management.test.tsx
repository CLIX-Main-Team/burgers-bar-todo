import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { locationsApi } from '../../lib/api.js'
import { LocationManagement } from './location-management.js'

// The screen under test is the whole management surface, so the create form and the list exercise
// the shared cache key together — a create/rename invalidation refreshes both, and the form's
// soft-duplicate check reads the same list the list renders.
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocationManagement', () => {
  it('shows the empty state when no branches exist', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [] })
    renderScreen()
    expect(await screen.findByText('No Locations yet — create the first branch.')).toBeTruthy()
  })

  it('lists existing branches by name', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen()
    expect(await screen.findByText('Downtown')).toBeTruthy()
  })

  it('creates a non-colliding name immediately, without a confirm', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const create = vi
      .spyOn(locationsApi, 'create')
      .mockResolvedValue({ id: '22222222-2222-2222-2222-222222222222', name: 'Uptown' })
    renderScreen()
    await screen.findByText('Downtown')

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
    await screen.findByText('Downtown')

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

  it('renames a branch inline through PATCH', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const rename = vi
      .spyOn(locationsApi, 'rename')
      .mockResolvedValue({ id: DOWNTOWN.id, name: 'Midtown' })
    renderScreen()
    await screen.findByText('Downtown')

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    // The editor prefills the current name (the create form's field is empty), so target it by
    // that display value rather than the label it shares with the create form.
    const input = screen.getByDisplayValue('Downtown')
    fireEvent.change(input, { target: { value: 'Midtown' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(rename).toHaveBeenCalledWith(DOWNTOWN.id, { name: 'Midtown' }))
  })

  it('does not call PATCH when the inline name is unchanged', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const rename = vi.spyOn(locationsApi, 'rename')
    renderScreen()
    await screen.findByText('Downtown')

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Unchanged name closes the editor without a call; the read-only row returns.
    await screen.findByRole('button', { name: 'Rename' })
    expect(rename).not.toHaveBeenCalled()
  })
})
