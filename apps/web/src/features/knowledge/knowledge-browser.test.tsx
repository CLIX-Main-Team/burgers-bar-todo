import type { KnowledgeDocSummary } from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { knowledgeApi } from '../../lib/api.js'
import { KnowledgeBrowser } from './knowledge-browser.js'

// The Knowledge Base browser (ADR-0024): a folder grid of every fixed shelf at the root
// (empty shelves visible, captioned Empty), a search field live-filtering titles across all
// shelves, documents inside a shelf linking out to Drive, a skipped doc shown with its badge
// and reason, and an unfiled doc (category null) bucketed under General rather than hidden.

function renderBrowser(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <KnowledgeBrowser />
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

const doc = (over: Partial<KnowledgeDocSummary>): KnowledgeDocSummary => ({
  id: '11111111-1111-1111-1111-111111111111',
  driveFileId: 'drive-1',
  title: 'Untitled',
  category: 'procedures',
  status: 'ingested',
  skipReason: null,
  sourceMimeType: 'application/vnd.google-apps.document',
  driveModifiedTime: '2026-02-01T00:00:00.000Z',
  ...over,
})

const CORPUS = {
  lastSyncAt: '2026-08-01T10:00:00.000Z',
  docs: [
    doc({
      id: '11111111-1111-1111-1111-111111111111',
      driveFileId: 'd1',
      title: 'Opening checklist',
    }),
    doc({
      id: '22222222-2222-2222-2222-222222222222',
      driveFileId: 'd2',
      title: 'Payroll checklist',
      category: 'finance',
    }),
    // Still awaiting the categorizer — must land on the General shelf, not vanish.
    doc({
      id: '33333333-3333-3333-3333-333333333333',
      driveFileId: 'd3',
      title: 'Fresh upload',
      category: null,
    }),
    // Unreadable by the sync — shown with the badge and the recorded reason, not hidden.
    doc({
      id: '44444444-4444-4444-4444-444444444444',
      driveFileId: 'd4',
      title: 'Scanned lease',
      category: 'agreements',
      status: 'skipped',
      skipReason: 'scanned or image-only PDF: no extractable text layer',
      sourceMimeType: 'application/pdf',
    }),
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('KnowledgeBrowser', () => {
  it('shows every fixed shelf as a folder tile — counted when stocked, Empty otherwise', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    // The shelf name also rides each recent row's second line now, so tiles are addressed
    // by their button role.
    expect(await screen.findByRole('button', { name: /Procedures & checklists/ })).toBeTruthy()
    const tiles = screen.getAllByRole('button').map((el) => el.textContent)
    // procedures, finance, agreements, general carry counts; hr, reports, menu read Empty.
    expect(tiles.filter((label) => label?.includes('document'))).toHaveLength(4)
    expect(tiles.filter((label) => label?.includes('Empty'))).toHaveLength(3)
    expect(screen.getByRole('button', { name: /Menu & kitchen/ })).toBeTruthy()
    expect(screen.getByText(/4 documents/)).toBeTruthy()
  })

  it('search filters titles across every shelf and clears back to the grid', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    const field = await screen.findByLabelText('Search folders and documents')
    fireEvent.change(field, { target: { value: 'checklist' } })

    // Matches from two different shelves surface together, as Drive links; folders yield.
    expect(screen.getByText('Opening checklist').closest('a')).toBeTruthy()
    expect(screen.getByText('Payroll checklist').closest('a')).toBeTruthy()
    expect(screen.queryByText('Scanned lease')).toBeNull()
    expect(screen.queryByRole('button', { name: /Procedures & checklists/ })).toBeNull()

    fireEvent.change(field, { target: { value: '' } })
    expect(screen.getByRole('button', { name: /Procedures & checklists/ })).toBeTruthy()
  })

  it('a shelf name is searchable too — its documents answer for it', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.change(await screen.findByLabelText('Search folders and documents'), {
      target: { value: 'finance' }, // appears only in the "Finance & payroll" shelf name
    })

    expect(screen.getByText('Payroll checklist')).toBeTruthy()
    expect(screen.queryByText('Opening checklist')).toBeNull()
  })

  it('a search with no matches says so instead of showing an empty void', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.change(await screen.findByLabelText('Search folders and documents'), {
      target: { value: 'nothing like this' },
    })

    expect(screen.getByText('No documents match your search.')).toBeTruthy()
  })

  it('an unfiled doc waits on the General shelf', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /^General/ }))

    expect(await screen.findByText('Fresh upload')).toBeTruthy()
  })

  it('a document row links to the original in Drive, in a new tab', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /Finance & payroll/ }))

    const row = (await screen.findByText('Payroll checklist')).closest('a')
    expect(row?.getAttribute('href')).toBe('https://drive.google.com/file/d/d2/view')
    expect(row?.getAttribute('target')).toBe('_blank')
  })

  it('a skipped doc shows the not-readable badge and the recorded reason', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /Agreements & property/ }))

    expect(await screen.findByText('Scanned lease')).toBeTruthy()
    // The badge rides the root's recent rows too, so scope to any single instance.
    expect(screen.getAllByText('Not readable').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/scanned or image-only PDF: no extractable text layer/).length,
    ).toBeGreaterThan(0)
  })

  it('back returns from a shelf to the shelf list', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /^General/ }))
    await screen.findByText('Fresh upload')
    fireEvent.click(screen.getByText('All categories'))

    expect(await screen.findByRole('button', { name: /Procedures & checklists/ })).toBeTruthy()
  })

  it('an empty corpus reads as a state, with the sync line saying never', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue({ docs: [], lastSyncAt: null })
    renderBrowser()

    expect(
      await screen.findByText(
        'No documents yet — files added to the shared Drive folder appear here after the next sync.',
      ),
    ).toBeTruthy()
    expect(screen.getByText(/Not synced yet/)).toBeTruthy()
  })
})
