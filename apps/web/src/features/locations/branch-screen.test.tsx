import {
  type PrincipalResponse,
  type Task,
  type UserSummary,
  capabilitiesFor,
} from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../i18n/locale.js'
import { messages } from '../../i18n/messages.js'
import { ApiError, authApi, locationsApi, tasksApi } from '../../lib/api.js'
import { BranchDetail } from './branch-screen.js'

const BRANCH = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Dizengoff',
  number: null,
  address: 'Dizengoff 100',
  city: 'Tel Aviv',
  phone: '03-555-0100',
}

const SUPER_ADMIN: PrincipalResponse = {
  userId: '99999999-9999-9999-9999-999999999999',
  displayName: 'Owner',
  role: 'super_admin',
  locationId: null,
  status: 'active',
  capabilities: capabilitiesFor('super_admin'),
}

const BRANCH_ADMIN: PrincipalResponse = {
  userId: '88888888-8888-8888-8888-888888888888',
  displayName: 'Dana Cohen',
  role: 'admin',
  locationId: BRANCH.id,
  status: 'active',
  capabilities: capabilitiesFor('admin'),
}

function person(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'noa@burgers.local',
    displayName: 'Noa Levi',
    role: 'manager',
    locationId: BRANCH.id,
    locationName: BRANCH.name,
    status: 'active',
    preferredLanguage: 'he',
    lastSeenAt: null,
    ...overrides,
  }
}

// A board row shaped the way the API reports one. `dueDate` is the only field these tests
// vary, since the whole KPI row is `shiftMetrics` over the same list — this file asserts the
// wiring and the ink, never the arithmetic, which dashboard-metrics owns and tests already.
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    locationId: BRANCH.id,
    // main gave every task a project it may be filed under (#314); null is 'unfiled'.
    projectId: null,
    personal: false,
    title: 'Prep the line',
    description: null,
    status: 'not_started',
    priority: 'normal',
    dueDate: null,
    completedAt: null,
    position: 1,
    assignees: [],
    checklist: [],
    createdBy: { id: SUPER_ADMIN.userId, displayName: 'Owner' },
    createdAt: '2026-08-01T06:00:00.000Z',
    updatedAt: '2026-08-01T06:00:00.000Z',
    ...overrides,
  }
}

function daysFromNow(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

// The branch page is a route, so it renders inside a MemoryRouter sitting on its own path:
// `useParams` is where the id comes from, and `/locations` is mounted beside it as a stub so
// the delete flow's navigation away can be asserted without pulling the list into this suite.
// The principal is a prop, exactly as LocationManagement takes it — the route wrapper reads
// the session and this component is what the tests drive.
function renderScreen(principal: PrincipalResponse = SUPER_ADMIN): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[`/locations/${BRANCH.id}`]}>
          <Routes>
            <Route path="/locations" element={<p data-testid="branch-list" />} />
            <Route path="/locations/:id" element={<BranchDetail principal={principal} />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>
  )
  render(ui)
}

beforeEach(() => {
  vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [BRANCH] })
  vi.spyOn(authApi, 'listUsers').mockResolvedValue({ users: [] })
  vi.spyOn(tasksApi, 'board').mockResolvedValue({ tasks: [], lastSeenAt: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BranchDetail', () => {
  it('renders the branch plate from the record', async () => {
    renderScreen()

    expect(await screen.findByRole('heading', { name: 'Dizengoff' })).toBeTruthy()
    expect(screen.getByText(/Dizengoff 100/)).toBeTruthy()
    expect(screen.getByText(/Tel Aviv/)).toBeTruthy()
    expect(screen.getByText('03-555-0100')).toBeTruthy()
  })

  it('invites the first contact details when the branch has none', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({
      locations: [{ ...BRANCH, address: null, city: null, phone: null }],
    })
    renderScreen()

    expect(await screen.findByText(messages.en.locations.contactEmpty)).toBeTruthy()
  })

  // The page's one deliberate risk: Edit turns the plate into fields IN PLACE. Nothing opens
  // and nothing unmounts, so the back affordance rendered above the plate must be the very
  // same node before and after the click.
  it('swaps the plate for fields in place without unmounting the page', async () => {
    renderScreen()
    const back = await screen.findByRole('link', { name: 'Branches' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit branch' }))

    expect(screen.getByRole('link', { name: 'Branches' })).toBe(back)
    expect((screen.getByLabelText('Location name') as HTMLInputElement).value).toBe('Dizengoff')
    expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('Dizengoff 100')
    expect((screen.getByLabelText('City') as HTMLInputElement).value).toBe('Tel Aviv')
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('03-555-0100')
  })

  it('saves one patch carrying only the field that changed', async () => {
    const update = vi.spyOn(locationsApi, 'update').mockResolvedValue({
      ...BRANCH,
      phone: '03-555-0199',
    })
    renderScreen()
    await screen.findByRole('heading', { name: 'Dizengoff' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit branch' }))
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '03-555-0199' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith(BRANCH.id, { phone: '03-555-0199' })
  })

  it('clears a field the reader emptied', async () => {
    const update = vi.spyOn(locationsApi, 'update').mockResolvedValue({ ...BRANCH, address: null })
    renderScreen()
    await screen.findByRole('heading', { name: 'Dizengoff' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit branch' }))
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith(BRANCH.id, { address: null }))
  })

  it('keeps the editor open with the typed values when the save fails', async () => {
    vi.spyOn(locationsApi, 'update').mockRejectedValue(new ApiError(500, 'server_error'))
    renderScreen()
    await screen.findByRole('heading', { name: 'Dizengoff' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit branch' }))
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '03-555-0199' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(messages.en.locations.saveFailed)).toBeTruthy()
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('03-555-0199')
  })

  it('restores the plate on Cancel and sends nothing', async () => {
    const update = vi.spyOn(locationsApi, 'update')
    renderScreen()
    await screen.findByRole('heading', { name: 'Dizengoff' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit branch' }))
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '03-555-0199' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Phone')).toBeNull()
    expect(screen.getByText('03-555-0100')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })

  // Colour is the only thing on this page allowed to shout, and only when there is something
  // to shout about. The value paragraph sits immediately before its label in the tile.
  it('leaves the overdue tile in plain ink at zero', async () => {
    vi.spyOn(tasksApi, 'board').mockResolvedValue({
      tasks: [task({ dueDate: daysFromNow(3) })],
      lastSeenAt: null,
    })
    renderScreen()

    const label = await screen.findByText('Overdue')
    expect(label.previousElementSibling?.className).not.toContain('text-destructive')
  })

  it('paints the overdue tile destructive once the count is above zero', async () => {
    vi.spyOn(tasksApi, 'board').mockResolvedValue({
      tasks: [task({ dueDate: daysFromNow(-2) })],
      lastSeenAt: null,
    })
    renderScreen()

    const label = await screen.findByText('Overdue')
    expect(label.previousElementSibling?.textContent).toContain('1')
    expect(label.previousElementSibling?.className).toContain('text-destructive')
  })

  it('counts only this branch on the tiles and panels', async () => {
    vi.spyOn(authApi, 'listUsers').mockResolvedValue({
      users: [
        person(),
        person({
          id: '44444444-4444-4444-4444-444444444444',
          displayName: 'Ari Mizrahi',
          locationId: '55555555-5555-5555-5555-555555555555',
          locationName: 'Haifa Port',
        }),
      ],
    })
    vi.spyOn(tasksApi, 'board').mockResolvedValue({
      tasks: [
        task(),
        task({
          id: '66666666-6666-6666-6666-666666666666',
          locationId: '55555555-5555-5555-5555-555555555555',
          title: 'Cash up',
        }),
      ],
      lastSeenAt: null,
    })
    renderScreen()

    expect(await screen.findByText('Noa Levi')).toBeTruthy()
    expect(screen.queryByText('Ari Mizrahi')).toBeNull()
    expect(screen.getByText('Prep the line')).toBeTruthy()
    expect(screen.queryByText('Cash up')).toBeNull()
    // The roster row names the person's role from the shared label map, not a raw slug.
    expect(screen.getByText('Manager')).toBeTruthy()
  })

  it('shows each panel its own empty state', async () => {
    renderScreen()

    // An empty branch is not a blank roster but three unfilled ranks (2026-08-27), each
    // stating Unassigned; the work panel keeps its own sentence.
    expect(await screen.findAllByText(messages.en.locations.unassigned)).toHaveLength(3)
    expect(screen.getByText(messages.en.locations.openWorkEmpty)).toBeTruthy()
  })

  // The staffing slots (owner ask 2026-08-27): an unassigned rank is a control for the owner —
  // it opens the chooser, whose assign lane moves someone holding that role at another branch.
  it('fills an empty slot by moving someone who holds the role elsewhere', async () => {
    const elsewhereAdmin = person({
      id: '44444444-4444-4444-4444-444444444444',
      displayName: 'Ari Mizrahi',
      role: 'admin',
      locationId: '55555555-5555-5555-5555-555555555555',
      locationName: 'Haifa Port',
    })
    vi.spyOn(authApi, 'listUsers').mockResolvedValue({ users: [elsewhereAdmin] })
    const assign = vi
      .spyOn(authApi, 'assignUser')
      .mockResolvedValue({ ...elsewhereAdmin, locationId: BRANCH.id, locationName: BRANCH.name })
    renderScreen()

    // Three Unassigned buttons, one per rank; the first is the admin slot.
    const slots = await screen.findAllByRole('button', {
      name: messages.en.locations.unassigned,
    })
    fireEvent.click(slots[0] as HTMLElement)

    // The chooser opens on the assign lane, naming the candidate and where they are now.
    expect(await screen.findByText('Ari Mizrahi')).toBeTruthy()
    expect(screen.getByText('Haifa Port')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: messages.en.locations.assignAction }))
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(assign).toHaveBeenCalledWith(elsewhereAdmin.id, { locationId: BRANCH.id })
  })

  // A branch admin reads the same ranks inert: the absence is stated, never offered as a
  // control — moving people between branches is the owner's act (ADR-0007 presentation gating).
  it('renders unassigned ranks as plain text for a branch admin', async () => {
    renderScreen(BRANCH_ADMIN)

    expect(await screen.findAllByText(messages.en.locations.unassigned)).toHaveLength(3)
    expect(screen.queryByRole('button', { name: messages.en.locations.unassigned })).toBeNull()
  })

  // Who is on a task, in the board's own grammar (owner ask 2026-08-23). The stack announces
  // its names to a screen reader and hides the discs from it, so the assertion reads the
  // announced text rather than the decorative circles.
  it('names who is on each open task, and marks the ones nobody holds', async () => {
    vi.spyOn(tasksApi, 'board').mockResolvedValue({
      tasks: [
        task({
          id: 'held',
          title: 'Wipe the grill',
          assignees: [
            { id: 'p1', displayName: 'Noa Levi', assignedAt: '2026-08-01T06:00:00.000Z' },
          ],
        }),
        task({ id: 'loose', title: 'Deep clean the fryer', position: 2 }),
      ],
      lastSeenAt: null,
    })
    renderScreen()
    await screen.findByRole('heading', { name: 'Dizengoff' })

    expect(screen.getByText('Assigned to Noa Levi')).toBeTruthy()
    // An empty assignee set is the backlog, and saying so is the point: it is the answer to
    // "what has nobody picked up", which is most of why this panel exists.
    expect(screen.getByText('Deep clean the fryer')).toBeTruthy()
    // The word itself, on the row — not an aria-label on a glyph. A reader on a phone has no
    // hover, so the unheld state has to be legible without one.
    expect(screen.getByText(messages.en.tasks.backlog)).toBeTruthy()
  })

  // Delete lives in the plate's edit footer now, so every case here opens the editor first.
  // A page nobody is editing carries no delete control at all, for anyone.
  it('keeps Delete branch out of the plate until it is being edited', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'Dizengoff' })

    expect(screen.queryByRole('button', { name: 'Delete branch' })).toBeNull()
  })

  it('offers Delete branch to a super_admin editing the plate', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'Dizengoff' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit branch' }))

    expect(await screen.findByRole('button', { name: 'Delete branch' })).toBeTruthy()
  })

  it('withholds Delete branch from a branch admin editing the plate', async () => {
    renderScreen(BRANCH_ADMIN)
    await screen.findByRole('heading', { name: 'Dizengoff' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit branch' }))
    // The editor is open — Save proves it — and still there is no third control.
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeTruthy()

    expect(screen.queryByRole('button', { name: 'Delete branch' })).toBeNull()
  })

  it('leaves the page open with the move-them-first instruction on a 409', async () => {
    vi.spyOn(locationsApi, 'remove').mockRejectedValue(new ApiError(409, 'location_in_use'))
    renderScreen()
    await screen.findByRole('heading', { name: 'Dizengoff' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit branch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete branch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText(
        '"Dizengoff" still has people or tasks on it. Move them to another branch first, then delete it.',
      ),
    ).toBeTruthy()
    // Still here, and still editing: the instruction is something to act on, not a dead end.
    // The heading is an Input while the editor is open, so the editor's own control is what
    // proves the page survived.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
    expect(screen.queryByTestId('branch-list')).toBeNull()
  })

  it('returns to the list once the branch is deleted', async () => {
    vi.spyOn(locationsApi, 'remove').mockResolvedValue({ status: 'ok' })
    renderScreen()
    await screen.findByRole('heading', { name: 'Dizengoff' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit branch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete branch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByTestId('branch-list')).toBeTruthy()
  })

  // A branch admin who types another branch's id gets a 404-shaped answer from the API, so
  // the list they can read simply does not carry it. That is a legitimate arrival, not a bug.
  it('renders the not-found block once the list has settled without the branch', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [] })
    renderScreen()

    expect(await screen.findByText(messages.en.locations.notFound)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Branches' })).toBeTruthy()
  })
})
