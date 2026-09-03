import {
  type KnowledgeDocSummary,
  type PrincipalResponse,
  type Role,
  capabilitiesFor,
} from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '../../auth/session.js'
import { ToastProvider } from '../../components/ui/toast.js'
import { LocaleProvider } from '../../i18n/locale.js'
import { authApi, knowledgeApi } from '../../lib/api.js'
import { KnowledgeBrowser } from './knowledge-browser.js'

// The Knowledge Base browser (ADR-0024) as a mirror of the shared Drive folder (2026-09-03):
// the tiles are the folders Drive actually has, named as Drive names them, and the list under
// them is the files sitting loose at the top level — not a flattened everything, and not seven
// shelves a model sorted the corpus into.
//
// The fixture is shaped like the client's real corpus on purpose: Hebrew department folders, a
// file loose at the root, and the formats the sync actually ingests.

// A principal for whichever role a case needs. The capabilities come from the real defaults, not
// a hand-written list, so a case cannot claim a role holds something the app would not give it.
const principalFor = (role: Role): PrincipalResponse => ({
  userId: '99999999-9999-9999-9999-999999999999',
  displayName: 'Tester',
  role,
  locationId: null,
  status: 'active',
  capabilities: capabilitiesFor(role),
})

// Session and toast providers, because the screen reads both — the same two that wrap the whole
// app in main.tsx. The stored token is what lets SessionProvider run its principal query at all.
function renderBrowser(role: Role = 'manager'): void {
  vi.spyOn(authApi, 'me').mockResolvedValue(principalFor(role))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <LocaleProvider>
          <ToastProvider>
            <KnowledgeBrowser />
          </ToastProvider>
        </LocaleProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

const doc = (over: Partial<KnowledgeDocSummary>): KnowledgeDocSummary => ({
  id: '11111111-1111-1111-1111-111111111111',
  driveFileId: 'drive-1',
  title: 'Untitled',
  folder: null,
  status: 'ingested',
  skipReason: null,
  sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
      folder: 'מחלקת תפעול',
    }),
    doc({
      id: '22222222-2222-2222-2222-222222222222',
      driveFileId: 'd2',
      title: 'Payroll checklist',
      folder: 'כספים',
    }),
    // Loose at the top of the Drive folder — the root list is exactly these.
    doc({
      id: '33333333-3333-3333-3333-333333333333',
      driveFileId: 'd3',
      title: 'Org chart',
      sourceMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }),
    // Unreadable by the sync — shown with the badge and the recorded reason, not hidden.
    doc({
      id: '44444444-4444-4444-4444-444444444444',
      driveFileId: 'd4',
      title: 'Scanned lease',
      folder: 'כספים',
      status: 'skipped',
      skipReason: 'scanned or image-only PDF: no extractable text layer',
      sourceMimeType: 'application/pdf',
    }),
  ],
}

beforeEach(() => {
  localStorage.setItem('burgers.session.token', 'test-token')
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('KnowledgeBrowser', () => {
  it('the tiles are the Drive folders, under their own Drive names', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    expect(await screen.findByRole('button', { name: /מחלקת תפעול/ })).toBeTruthy()
    // Two folders, and nothing invented: no shelf exists here that Drive does not have.
    expect(screen.getAllByRole('button', { name: /document/ })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /כספים.*2 documents/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /מחלקת תפעול.*1 document/ })).toBeTruthy()
  })

  it('the root lists the files loose at the top of Drive, not the whole corpus', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    // The one root-level file is here; the three filed into folders are behind their tiles,
    // exactly as Drive shows them.
    expect(await screen.findByText('Org chart')).toBeTruthy()
    expect(screen.queryByText('Opening checklist')).toBeNull()
    expect(screen.queryByText('Payroll checklist')).toBeNull()
  })

  it('opening a folder shows the files inside it, and only those', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /כספים/ }))

    expect(await screen.findByText('Payroll checklist')).toBeTruthy()
    expect(screen.getByText('Scanned lease')).toBeTruthy()
    expect(screen.queryByText('Opening checklist')).toBeNull()
  })

  it('the breadcrumb names the Drive folder and walks back to the grid', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /מחלקת תפעול/ }))
    await screen.findByText('Opening checklist')

    const trail = screen.getByRole('navigation', { name: 'Knowledge Base location' })
    expect(trail.textContent).toContain('מחלקת תפעול')

    fireEvent.click(within(trail).getByRole('button', { name: 'Knowledge Base' }))
    expect(await screen.findByRole('button', { name: /כספים/ })).toBeTruthy()
  })

  it('search from the root reaches into the folders, and the grid yields', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    const field = await screen.findByLabelText('Search folders and documents')
    fireEvent.change(field, { target: { value: 'checklist' } })

    // A search that stopped at the root's loose files would answer "no" about documents that
    // are plainly in the corpus, so it deliberately crosses folders.
    expect(screen.getByText('Opening checklist').closest('a')).toBeTruthy()
    expect(screen.getByText('Payroll checklist').closest('a')).toBeTruthy()
    expect(screen.queryByText('Org chart')).toBeNull()
    expect(screen.queryByRole('button', { name: /מחלקת תפעול/ })).toBeNull()

    fireEvent.change(field, { target: { value: '' } })
    expect(screen.getByRole('button', { name: /מחלקת תפעול/ })).toBeTruthy()
  })

  it('a search hit carries the folder it came from', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.change(await screen.findByLabelText('Search folders and documents'), {
      target: { value: 'Payroll' },
    })

    expect(screen.getByText('Payroll checklist').closest('a')?.textContent).toContain('כספים')
  })

  it('a folder name is searchable too — its documents answer for it', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.change(await screen.findByLabelText('Search folders and documents'), {
      target: { value: 'תפעול' },
    })

    expect(screen.getByText('Opening checklist')).toBeTruthy()
    expect(screen.queryByText('Payroll checklist')).toBeNull()
  })

  it('search inside a folder stays inside it', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /כספים/ }))
    // The field renames itself to the folder it is now searching.
    const field = await screen.findByLabelText('Search in כספים')
    fireEvent.change(field, { target: { value: 'checklist' } })

    // "Opening checklist" matches the word but lives in another folder, so it must not surface.
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

  it('a corpus filed entirely into folders says so rather than showing a blank list', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue({
      lastSyncAt: '2026-08-01T10:00:00.000Z',
      docs: CORPUS.docs.filter((entry) => entry.folder !== null),
    })
    renderBrowser()

    expect(await screen.findByText('Every document is filed in a folder.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /כספים/ })).toBeTruthy()
  })

  it('a document row links to the original in Drive, in a new tab', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /כספים/ }))

    const row = (await screen.findByText('Payroll checklist')).closest('a')
    expect(row?.getAttribute('href')).toBe('https://drive.google.com/file/d/d2/view')
    expect(row?.getAttribute('target')).toBe('_blank')
  })

  it('a skipped doc shows the not-readable badge and the recorded reason', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /כספים/ }))

    expect(await screen.findByText('Scanned lease')).toBeTruthy()
    expect(screen.getAllByText('Not readable').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/scanned or image-only PDF: no extractable text layer/).length,
    ).toBeGreaterThan(0)
  })

  it('the root shows its files as cards — a name and its mark, no row columns', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    // A card is still a link out to Drive; what it does not carry is the row's column furniture.
    // Every root file has the same location and its format is already at the end of its own
    // filename, so a format column here would print what the name says.
    const card = (await screen.findByText('Org chart')).closest('a')
    expect(card?.getAttribute('href')).toBe('https://drive.google.com/file/d/d3/view')
    expect(screen.queryByText('PPTX')).toBeNull()
    expect(screen.queryByText('DOCX')).toBeNull()
  })

  it('rows inside a folder still print the format in words', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /כספים/ }))
    await screen.findByText('Scanned lease')

    // The mark is decorative; in a row, where the format IS a column, the abbr beside it is what
    // has to survive greyscale and a screen reader.
    expect(screen.getAllByText('PDF').length).toBeGreaterThan(0)
    expect(screen.getAllByText('DOCX').length).toBeGreaterThan(0)
  })

  it('the list reorders by name without leaving the page', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    renderBrowser()

    // Searched from the root so the list is the whole corpus, which is the case worth ordering.
    fireEvent.change(await screen.findByLabelText('Search folders and documents'), {
      target: { value: 'c' },
    })
    const sort = screen.getByRole('group', { name: 'Sort documents' })
    expect(within(sort).getByRole('button', { name: 'Newest' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(within(sort).getByRole('button', { name: 'Name' }))
    expect(within(sort).getByRole('button', { name: 'Name' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const titles = screen.getAllByRole('link').map((row) => (row.textContent ?? '').trim())
    // Alphabetical by title: Opening checklist, Org chart, Payroll checklist, Scanned lease.
    expect(titles[0]).toContain('Opening checklist')
    expect(titles[3]).toContain('Scanned lease')
  })

  it('the check-for-new-files button pulls from Drive and refreshes the list', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    // Held open, so the in-flight state is observable at all: the real pass takes seconds to
    // minutes and a mock that resolves instantly would skip straight past the thing being tested.
    let finishPass: () => void = () => {}
    const resync = vi.spyOn(knowledgeApi, 'resync').mockReturnValue(
      new Promise((resolve) => {
        finishPass = () => resolve({ status: 'ok' })
      }),
    )
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /Check for new files/ }))

    // The endpoint answers only once the pass is done, so the label carries the wait rather than
    // leaving a dead-looking button, and a second press cannot stack another walk of Drive.
    expect(await screen.findByRole('button', { name: /Checking Drive/ })).toBeDisabled()
    expect(resync).toHaveBeenCalledTimes(1)

    finishPass()

    // Two listings: the first paint, then the refetch the finished pass triggers. Without the
    // second the button would be a no-op from the reader's side.
    await waitFor(() => expect(knowledgeApi.list).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: /Check for new files/ })).toBeEnabled()
  })

  it('a failed pull says so and leaves the last good list on screen', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    vi.spyOn(knowledgeApi, 'resync').mockRejectedValue(new Error('drive unreachable'))
    renderBrowser()

    fireEvent.click(await screen.findByRole('button', { name: /Check for new files/ }))

    expect(await screen.findByText(/Could not reach Google Drive/)).toBeTruthy()
    // The corpus is untouched: a failed pull is not an empty knowledge base.
    expect(screen.getByRole('button', { name: /כספים/ })).toBeTruthy()
  })

  it('a role that reads the tab but may not sync gets no button at all', async () => {
    vi.spyOn(knowledgeApi, 'list').mockResolvedValue(CORPUS)
    // An operations manager holds page.knowledge and not knowledge.sync, per the real defaults.
    renderBrowser('operations_manager')

    await screen.findByRole('button', { name: /כספים/ })
    // Hidden rather than disabled: a control you may never use is furniture. The server enforces
    // it either way, so this is only about what is drawn.
    expect(screen.queryByRole('button', { name: /Check for new files/ })).toBeNull()
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
