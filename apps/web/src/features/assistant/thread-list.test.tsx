import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { assistantApi } from '../../lib/api.js'
import { ThreadList } from './thread-list.js'

// The list contents rendered by both the desktop rail and the mobile/tablet Sheet (#228). The two
// wrappers differ, but the rows, states, and callbacks are this one component — so proving it here
// covers both surfaces. LocaleProvider supplies the IntlProvider these strings resolve through.
function renderList(overrides?: {
  activeThreadId?: string | null
  onSelect?: (id: string) => void
  onNewThread?: () => void
  onDeleted?: (id: string) => void
}): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ThreadList
          activeThreadId={overrides?.activeThreadId ?? null}
          onSelect={overrides?.onSelect ?? (() => {})}
          onNewThread={overrides?.onNewThread ?? (() => {})}
          onDeleted={overrides?.onDeleted ?? (() => {})}
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

    const active = await screen.findByRole('button', { name: /^Refund policy/ })
    expect(active).toHaveAttribute('aria-current', 'true')
    const other = screen.getByRole('button', { name: /^Opening routine/ })
    expect(other).not.toHaveAttribute('aria-current')
  })

  it('files each conversation under its recency heading', async () => {
    // Stamps are built from the clock the component reads, so the buckets are the same ones a
    // reader would see — no frozen "now" that drifts as the fixture ages. Two groups since The
    // Counter (round 8): TODAY and EARLIER — each row carries its own time on a second line.
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
    vi.spyOn(assistantApi, 'listThreads').mockResolvedValue({
      threads: [
        { ...THREAD_A, title: 'Closing tonight', updatedAt: daysAgo(0) },
        { ...THREAD_B, title: 'Yesterday’s delivery', updatedAt: daysAgo(1) },
        {
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          title: 'Midweek stocktake',
          createdAt: STAMP,
          updatedAt: daysAgo(3),
        },
      ],
    })
    renderList()

    // Each group's list is named by its own visible heading, and holds only its own rows.
    const today = await screen.findByRole('list', { name: 'Today' })
    expect(within(today).getByRole('button', { name: /^Closing tonight/ })).toBeTruthy()
    const earlier = screen.getByRole('list', { name: 'Earlier' })
    expect(within(earlier).getByRole('button', { name: /^Yesterday’s delivery/ })).toBeTruthy()
    expect(within(earlier).getByRole('button', { name: /^Midweek stocktake/ })).toBeTruthy()
  })

  it('routes a row click to onSelect with the thread id', async () => {
    vi.spyOn(assistantApi, 'listThreads').mockResolvedValue({ threads: [THREAD_A] })
    const onSelect = vi.fn()
    renderList({ onSelect })

    fireEvent.click(await screen.findByRole('button', { name: /^Opening routine/ }))
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

  it('deletes a conversation through the row menu after the dialog confirms (#257)', async () => {
    vi.spyOn(assistantApi, 'listThreads').mockResolvedValue({ threads: [THREAD_A] })
    const deleteSpy = vi.spyOn(assistantApi, 'deleteThread').mockResolvedValue({ status: 'ok' })
    const onDeleted = vi.fn()
    renderList({ onDeleted })

    // The row's overflow menu offers the destructive action; nothing is deleted yet.
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Opening routine' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByText('Delete this conversation?')).toBeTruthy()
    expect(deleteSpy).not.toHaveBeenCalled()

    // Confirming fires the hard delete and reports the id up so the screen can reset.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(THREAD_A.id))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(THREAD_A.id))
  })

  it('cancelling the confirmation deletes nothing', async () => {
    vi.spyOn(assistantApi, 'listThreads').mockResolvedValue({ threads: [THREAD_A] })
    const deleteSpy = vi.spyOn(assistantApi, 'deleteThread')
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Opening routine' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleteSpy).not.toHaveBeenCalled()
    // The dialog goes and the row survives. Awaited rather than asserted outright because a
    // cancelled dialog now plays its exit before unmounting (round 15's motion layer), so it
    // is still in the tree for the length of that animation.
    await waitFor(() => expect(screen.queryByText('Delete this conversation?')).toBeNull())
    expect(screen.getByRole('button', { name: /^Opening routine/ })).toBeTruthy()
  })

  it('shows a soft error when the delete fails', async () => {
    vi.spyOn(assistantApi, 'listThreads').mockResolvedValue({ threads: [THREAD_A] })
    vi.spyOn(assistantApi, 'deleteThread').mockRejectedValue(new Error('boom'))
    const onDeleted = vi.fn()
    renderList({ onDeleted })

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Opening routine' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText('The conversation could not be deleted. Try again.'),
    ).toBeTruthy()
    // The failure resets nothing: the screen was never told the thread is gone.
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
