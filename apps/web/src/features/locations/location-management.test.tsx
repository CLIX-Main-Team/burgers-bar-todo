import {
  OPENING_CHECKLIST,
  type PrincipalResponse,
  type ProjectPhase,
  type ProjectSummary,
  type Task,
  type TaskStatus,
  type UserSummary,
  capabilitiesFor,
} from '@burgers/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { authApi, locationsApi, projectsApi, tasksApi } from '../../lib/api.js'
import { LocationManagement } from './location-management.js'

const SUPER_ADMIN: PrincipalResponse = {
  userId: '99999999-9999-9999-9999-999999999999',
  displayName: 'Owner',
  role: 'super_admin',
  locationId: null,
  status: 'active',
  capabilities: capabilitiesFor('super_admin'),
}

// The screen under test is the whole chain-at-a-glance surface: the grid of branch boxes with
// their joined counts (round 13, 2026-08-26 — one grid, where a table and a phone list used to
// say the same thing twice), Add branch living in a Dialog, and the create form's soft-duplicate
// check reading the same list the grid renders. A box is a route rather than a Dialog opener, so
// the render needs a router: `/locations` mounts the screen under test and `/locations/:id`
// mounts a stub standing in for the branch page, letting a click-through be asserted without
// pulling that page into this suite. Rendered as a super_admin by default — the audience Add
// branch is gated to (2026-08-23); the branch-admin case below renders a narrower principal.
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
  // The stat tiles and every number on a box join the people, board and project reads; empty
  // stubs keep each test deterministic unless it overrides them.
  vi.spyOn(authApi, 'listUsers').mockResolvedValue({ users: [] })
  vi.spyOn(tasksApi, 'board').mockResolvedValue({ tasks: [], lastSeenAt: null })
  vi.spyOn(projectsApi, 'list').mockResolvedValue({ projects: [] })
})

// One person at Downtown. The roster read is the source of all three people rows on a box, so
// the tests build people rather than boxes.
function person(
  id: string,
  displayName: string,
  role: 'admin' | 'manager' | 'employee',
): UserSummary {
  return {
    id,
    email: `${id}@burgers.local`,
    displayName,
    role,
    locationId: DOWNTOWN.id,
    locationName: DOWNTOWN.name,
    status: 'active',
    preferredLanguage: 'he',
    lastSeenAt: null,
  }
}

// A board row at Downtown. Only the three fields the box reads vary: whether it is done,
// whether it is overdue, and which branch it belongs to.
function boardTask(id: string, status: TaskStatus, dueDate: string | null): Task {
  return {
    id,
    title: `Task ${id}`,
    locationId: DOWNTOWN.id,
    description: null,
    status,
    priority: 'normal',
    dueDate,
    completedAt: null,
    position: 0,
    projectId: null,
    personal: false,
    assignees: [],
    checklist: [],
    createdBy: { id: 'u0', displayName: 'Owner' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

// A project naming Downtown. Its phase is what decides whether the box counts it.
function branchProject(id: string, phase: ProjectPhase): ProjectSummary {
  return {
    id,
    name: `Project ${id}`,
    icon: 'menu',
    colour: 'amber',
    locations: [{ id: DOWNTOWN.id, name: DOWNTOWN.name }],
    roles: ['manager'],
    startDate: null,
    targetDate: null,
    phase,
    doneCount: 0,
    taskCount: 0,
    status: 'in_progress',
    createdBy: { id: 'u0', displayName: 'Owner' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

// The grid of boxes, which is the only list on the screen.
const grid = () => screen.findByRole('list')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocationManagement', () => {
  it('shows the empty state when no branches exist', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [] })
    renderScreen()
    expect(await screen.findByText('No Locations yet — create the first branch.')).toBeTruthy()
  })

  it('draws a box per branch, naming who is missing rather than leaving a gap', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen()
    const list = await grid()
    expect(within(list).getByText('Downtown')).toBeTruthy()
    // Three people rows, and an empty branch says so on all three. The count is the assertion:
    // two "Unassigned" would mean a row quietly went missing.
    expect(within(list).getAllByText('Unassigned')).toHaveLength(3)
  })

  it('names the branch admin and the manager on their own rows', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    vi.spyOn(authApi, 'listUsers').mockResolvedValue({
      users: [person('u1', 'Dana Cohen', 'admin'), person('u2', 'Yossi Levi', 'manager')],
    })
    renderScreen()
    const list = await grid()
    // A face carries its person in the bubble it shows on hover and on press-and-hold, so the
    // name is on the box for the eye as well as for the reader.
    expect(within(list).getAllByText('Dana Cohen').length).toBeGreaterThan(0)
    expect(within(list).getAllByText('Yossi Levi').length).toBeGreaterThan(0)
    // Dana and Yossi are also this branch's people, so no row is left unassigned.
    expect(within(list).queryByText('Unassigned')).toBeNull()
  })

  // The cap is what keeps every box one height whatever a branch's headcount is (owner ask
  // 2026-08-26): three faces and a +N, never eight faces across one card.
  it('caps the faces at three and rolls the rest into a +N', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    vi.spyOn(authApi, 'listUsers').mockResolvedValue({
      users: [
        person('u1', 'Dana Cohen', 'admin'),
        person('u2', 'Yossi Levi', 'employee'),
        person('u3', 'Noa Bar', 'employee'),
        person('u4', 'Omri Katz', 'employee'),
        person('u5', 'Tal Aviv', 'employee'),
      ],
    })
    renderScreen()
    const list = await grid()

    // Five people, three faces, one +2 — and the two it stands for are named in its bubble,
    // which is the only reason somebody reaches for it.
    expect(within(list).getByText('+2')).toBeTruthy()
    expect(within(list).getByText('Omri Katz, Tal Aviv')).toBeTruthy()
    // Every name still reaches a screen reader, cap or no cap: the row label reads them all.
    expect(within(list).getByText(/People .*Dana Cohen.*Tal Aviv/)).toBeTruthy()
  })

  it('counts open work, its overdue share, and the projects still running here', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    vi.spyOn(tasksApi, 'board').mockResolvedValue({
      tasks: [
        boardTask('t1', 'not_started', '2020-01-01'),
        boardTask('t2', 'in_progress', null),
        boardTask('t3', 'done', null),
      ],
      lastSeenAt: null,
    })
    vi.spyOn(projectsApi, 'list').mockResolvedValue({
      projects: [
        branchProject('p1', 'in_progress'),
        // Completed is the phase somebody set, so the project is over and off the count.
        branchProject('p2', 'completed'),
        // Chain-wide (no branch named) — deliberately not counted on any box.
        { ...branchProject('p3', 'planning'), locations: [] },
      ],
    })
    renderScreen()
    const list = await grid()

    // Two open of three tasks, one of them overdue, and one of three projects still running.
    expect(await within(list).findByText('2')).toBeTruthy()
    // The overdue flag is the one piece of colour on the box, and never colour alone.
    expect(within(list).getByText('Overdue')).toBeTruthy()
    expect(within(list).getAllByText('1').length).toBeGreaterThan(0)
  })

  it('creates a non-colliding name through the Add branch dialog', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const create = vi.spyOn(locationsApi, 'create').mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Uptown',
      address: null,
      city: null,
      phone: null,
      openingProjectId: null,
    })
    renderScreen()
    await grid()

    fireEvent.click(screen.getAllByRole('button', { name: 'Add branch' })[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Uptown' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Uptown',
        withOpeningProject: true,
        language: 'en',
      }),
    )
  })

  // The opening project the create dialog can start alongside the branch (owner ask 2026-08-26).
  // A switch inside this dialog, not a second dialog after it, so what these pin down is that one
  // submit carries both decisions and that saying no still creates the plain branch.
  it('offers the opening project by default and previews what it will make', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen()
    await grid()

    fireEvent.click(screen.getAllByRole('button', { name: 'Add branch' })[0] as HTMLElement)

    const toggle = screen.getByRole('switch', { name: 'Start the opening project' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    // The hint counts the real document rather than a number typed into the copy.
    expect(
      screen.getByText(`${OPENING_CHECKLIST.en.length} steps from the chain's opening checklist.`, {
        exact: false,
      }),
    ).toBeTruthy()

    // Before a name is typed the preview says so rather than showing a half-built title.
    expect(screen.getByText('Opening: your new branch')).toBeTruthy()
    // The first lines are the document's own, and the rest are counted, not listed.
    expect(screen.getByText(OPENING_CHECKLIST.en[0] as string)).toBeTruthy()
    expect(screen.getByText(`${OPENING_CHECKLIST.en.length - 3} more steps`)).toBeTruthy()

    // Typing the branch name fills the project's name in, which is what shows the switch is real.
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Uptown' } })
    expect(await screen.findByText('Opening: Uptown')).toBeTruthy()
  })

  it('creates a plain branch when the opening project is switched off', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const create = vi.spyOn(locationsApi, 'create').mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Uptown',
      address: null,
      city: null,
      phone: null,
      openingProjectId: null,
    })
    renderScreen()
    await grid()

    fireEvent.click(screen.getAllByRole('button', { name: 'Add branch' })[0] as HTMLElement)
    fireEvent.click(screen.getByRole('switch', { name: 'Start the opening project' }))
    // The preview goes with the switch — nothing promises a project that is not coming.
    expect(screen.queryByText('Opening: your new branch')).toBeNull()

    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Uptown' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Uptown',
        withOpeningProject: false,
        language: 'en',
      }),
    )
    expect(await screen.findByText('Location "Uptown" added.')).toBeTruthy()
  })

  it('points at the project it just started, so nobody has to go and find it', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    vi.spyOn(locationsApi, 'create').mockResolvedValue({
      id: '55555555-5555-5555-5555-555555555555',
      name: 'Uptown',
      address: null,
      city: null,
      phone: null,
      openingProjectId: '66666666-6666-6666-6666-666666666666',
    })
    renderScreen()
    await grid()

    fireEvent.click(screen.getAllByRole('button', { name: 'Add branch' })[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Uptown' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))

    const link = await screen.findByRole('link', { name: 'Open the project' })
    expect(link.getAttribute('href')).toBe('/projects/66666666-6666-6666-6666-666666666666')
  })

  it('soft-confirms an exact-name match instead of blocking, then creates on the second submit', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    const create = vi.spyOn(locationsApi, 'create').mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Downtown',
      address: null,
      city: null,
      phone: null,
      openingProjectId: null,
    })
    renderScreen()
    await grid()

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
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Downtown',
        withOpeningProject: true,
        language: 'en',
      }),
    )
  })

  // The box is a route, not a Dialog opener (rename and delete moved to the branch page in
  // round 12). One link per branch since round 13 folded the two shells into one grid, so this
  // no longer has to pick the first of two matches standing for the same branch.
  it('opens the branch page when a box is clicked', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen()
    await grid()

    fireEvent.click(screen.getByRole('link', { name: /Downtown/ }))
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
    await grid()

    expect(screen.queryByRole('button', { name: 'Add branch' })).toBeNull()
  })
})
