import type { KnowledgeDocSummary } from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { knowledgeApi } from '../../lib/api.js'
import { KnowledgeBrowser } from './knowledge-browser.js'

// The Knowledge Base browser (ADR-0024): shelves at the root grouped from the flat doc list,
// documents inside a shelf linking out to Drive, a skipped doc shown with its badge and
// reason, and an unfiled doc (category null) bucketed under General rather than hidden.

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
  it('groups the flat corpus into shelves with counts, in the fixed order', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    expect(await screen.findByText('Procedures & checklists')).toBeTruthy()
    const shelves = screen.getAllByRole('button').map((el) => el.textContent)
    // procedures → finance → agreements → general; empty shelves (hr, reports, menu) absent.
    expect(shelves.filter((label) => label?.includes('document'))).toHaveLength(4)
    expect(screen.getByText(/4 documents/)).toBeTruthy()
    expect(screen.queryByText('Menu & kitchen')).toBeNull()
  })

  it('an unfiled doc waits on the General shelf', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByText('General'))

    expect(await screen.findByText('Fresh upload')).toBeTruthy()
  })

  it('a document row links to the original in Drive, in a new tab', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByText('Finance & payroll'))

    const row = (await screen.findByText('Payroll checklist')).closest('a')
    expect(row?.getAttribute('href')).toBe('https://drive.google.com/file/d/d2/view')
    expect(row?.getAttribute('target')).toBe('_blank')
  })

  it('a skipped doc shows the not-readable badge and the recorded reason', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByText('Agreements & property'))

    expect(await screen.findByText('Scanned lease')).toBeTruthy()
    expect(screen.getByText('Not readable')).toBeTruthy()
    expect(screen.getByText(/scanned or image-only PDF: no extractable text layer/)).toBeTruthy()
  })

  it('back returns from a shelf to the shelf list', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByText('General'))
    await screen.findByText('Fresh upload')
    fireEvent.click(screen.getByText('All categories'))

    expect(await screen.findByText('Procedures & checklists')).toBeTruthy()
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
