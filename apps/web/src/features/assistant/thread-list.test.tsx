import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { assistantApi } from '../../lib/api.js'
import { ThreadList } from './thread-list.js'

// The list contents rendered by both the desktop rail and the mobile/tablet Sheet (#228). The two
// wrappers differ, but the rows, states, and callbacks are this one component — so proving it here
// covers both surfaces. LocaleProvider supplies both the locale (for the row date) and IntlProvider.
function renderList(overrides?: {
  activeThreadId?: string | null
  onSelect?: (id: string) => void
  onNewThread?: () => void
}): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ThreadList
          activeThreadId={overrides?.activeThreadId ?? null}
          onSelect={overrides?.onSelect ?? (() => {})}
          onNewThread={overrides?.onNewThread ?? (() => {})}
        />
      </LocaleProvider>
    </QueryClientProvider>
  )
  render(ui)
}

const STAMP = '2026-01-01T00:00:00.000Z'
const THREAD_A = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  title: 'Opening routine',
  createdAt: STAMP,
  updatedAt: STAMP,
}
const THREAD_B = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  title: 'Refund policy',
  createdAt: STAMP,
  updatedAt: STAMP,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ThreadList', () => {
  it('shows the loading label while the list is pending', () => {
    // A promise that never settles keeps the query pending so the skeleton state is observable.
    vi.spyOn(assistantApi, 'listThreads').mockReturnValue(new Promise(() => {}))
    renderList()
    expect(screen.getByText('Loading your conversations…')).toBeTruthy()
  })

  it('shows a warm empty line when there are no conversations', async () => {
    vi.spyOn(assistantApi, 'listThreads').mockResolvedValue({ threads: [] })
    renderList()
    expect(await screen.findByText('No conversations yet.')).toBeTruthy()
  })

  it('shows a soft error when the list fails to load', async () => {
    vi.spyOn(assistantApi, 'listThreads').mockRejectedValue(new Error('boom'))
    renderList()
    expect(
      await screen.findByText('Your conversations could not be loaded. Try again.'),
    ).toBeTruthy()
  })

  it('lists conversations by title and marks the active one with aria-current', async () => {
    vi.spyOn(assistantApi, 'listThreads').mockResolvedValue({ threads: [THREAD_B, THREAD_A] })
    renderList({ activeThreadId: THREAD_B.id })

    const active = await screen.findByRole('button', { name: /Refund policy/ })
    expect(active).toHaveAttribute('aria-current', 'true')
    const other = screen.getByRole('button', { name: /Opening routine/ })
    expect(other).not.toHaveAttribute('aria-current')
  })

  it('routes a row click to onSelect with the thread id', async () => {
    vi.spyOn(assistantApi, 'listThreads').mockResolvedValue({ threads: [THREAD_A] })
    const onSelect = vi.fn()
    renderList({ onSelect })

    fireEvent.click(await screen.findByRole('button', { name: /Opening routine/ }))
    expect(onSelect).toHaveBeenCalledWith(THREAD_A.id)
  })

  it('routes the New conversation action to onNewThread', async () => {
    vi.spyOn(assistantApi, 'listThreads').mockResolvedValue({ threads: [] })
    const onNewThread = vi.fn()
    renderList({ onNewThread })

    // The action is present without waiting on the list read — it sits above the rows.
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(onNewThread).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByText('No conversations yet.')).toBeTruthy())
  })
})
