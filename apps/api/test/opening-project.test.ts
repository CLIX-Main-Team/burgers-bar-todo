import { OPENING_CHECKLIST } from '@burgers/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The opening project a new branch can start with (owner ask 2026-08-26). Creating a branch may
// carry the chain's own forty-step opening checklist with it, filed as a project against the
// branch that was just created.
//
// What this pins down, all through the HTTP seam and never a row at rest:
//  - the flag is opt-in, so the old one-field create still makes a bare branch
//  - the project is bound to the NEW branch, not chain-wide — a chain-wide opening project would
//    put the same forty steps on every branch in the chain
//  - the checklist is written in the language the app is BEING READ IN, falling back to the
//    account's own setting; and it is written whole and in the document's order
//  - a branch is never lost to a project failure: the branch is created first, deliberately
const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const OWNER_PASSWORD = 'valid-password-123'

interface CreatedBranch {
  id: string
  name: string
  openingProjectId: string | null
}

interface ProjectDetail {
  project: {
    id: string
    name: string
    icon: string
    phase: string
    roles: string[]
    locations: { id: string; name: string }[]
    taskCount: number
    doneCount: number
  }
  checklist: { title: string; done: boolean }[]
}

describe('the opening project a new branch starts with', () => {
  let harness: TestHarness

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
  })

  const signIn = async (email: string, password: string): Promise<string> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email, password },
    })
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const createBranch = async (token: string, body: unknown): Promise<CreatedBranch> => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/locations',
      headers: { authorization: `Bearer ${token}` },
      payload: body as Record<string, unknown>,
    })
    expect(created.statusCode).toBe(201)
    return created.json<CreatedBranch>()
  }

  const readProject = async (token: string, id: string): Promise<ProjectDetail> => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/projects/${id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    return response.json<ProjectDetail>()
  }

  const listProjects = async (token: string): Promise<{ id: string }[]> => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ projects: { id: string }[] }>().projects
  }

  // The seed account is the bootstrap super_admin and carries the column's default language, `he`.
  // Everything below that wants English goes through a second owner, invited and accepted in it,
  // which is the only way a person's language is ever set.
  const englishOwner = async (): Promise<string> => {
    const seed = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${seed}` },
      payload: { email: 'owner@burgers.local', displayName: 'Chain Owner', role: 'super_admin' },
    })
    expect(invited.statusCode).toBe(201)
    const match = /token=([\w-]+)/.exec(harness.mailer.sent.at(-1)?.text ?? '')
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: {
        token: (match as RegExpExecArray)[1],
        password: OWNER_PASSWORD,
        preferredLanguage: 'en',
      },
    })
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  it('creates a bare branch when the flag is absent, exactly as before', async () => {
    const admin = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const branch = await createBranch(admin, { name: 'Dizengoff' })

    expect(branch.openingProjectId).toBeNull()
    expect(await listProjects(admin)).toEqual([])
  })

  it('creates a bare branch when the flag is explicitly off', async () => {
    const admin = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const branch = await createBranch(admin, { name: 'Dizengoff', withOpeningProject: false })

    expect(branch.openingProjectId).toBeNull()
    expect(await listProjects(admin)).toEqual([])
  })

  it('starts the opening project against the new branch, named after it', async () => {
    const owner = await englishOwner()
    const branch = await createBranch(owner, { name: 'Ramat Aviv', withOpeningProject: true })

    expect(branch.openingProjectId).toEqual(expect.any(String))
    const detail = await readProject(owner, branch.openingProjectId as string)

    expect(detail.project.name).toBe('Opening: Ramat Aviv')
    expect(detail.project.icon).toBe('opening')
    expect(detail.project.phase).toBe('planning')
    // Bound to the branch it was made for. An empty list here would mean chain-wide, which would
    // put the same forty steps on every branch the chain has.
    expect(detail.project.locations).toEqual([{ id: branch.id, name: 'Ramat Aviv' }])
  })

  it('writes the whole checklist, in the document order, all unticked', async () => {
    const owner = await englishOwner()
    const branch = await createBranch(owner, { name: 'Ramat Aviv', withOpeningProject: true })
    const detail = await readProject(owner, branch.openingProjectId as string)

    expect(detail.checklist.map((item) => item.title)).toEqual([...OPENING_CHECKLIST.en])
    expect(detail.checklist.every((item) => item.done === false)).toBe(true)
    // The counts the project card reads have to agree with the list the moment it is created.
    expect(detail.project.taskCount).toBe(OPENING_CHECKLIST.en.length)
    expect(detail.project.doneCount).toBe(0)
  })

  it('writes the checklist in the language the app is being read in', async () => {
    // The account is English (accepted that way); the app is being read in Hebrew. The screen is
    // what the person is looking at, so the screen wins — otherwise the dialog's preview would
    // show forty English steps and the project would hold forty Hebrew ones.
    const owner = await englishOwner()
    const branch = await createBranch(owner, {
      name: 'דיזנגוף',
      withOpeningProject: true,
      language: 'he',
    })
    const detail = await readProject(owner, branch.openingProjectId as string)

    expect(detail.project.name).toBe('פתיחת סניף: דיזנגוף')
    expect(detail.checklist.map((item) => item.title)).toEqual([...OPENING_CHECKLIST.he])
  })

  it("falls back to the account's own language when the caller names none", async () => {
    // The seed owner carries the column default, `he`, and this request says nothing about it.
    const hebrewOwner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const branch = await createBranch(hebrewOwner, { name: 'דיזנגוף', withOpeningProject: true })
    const detail = await readProject(hebrewOwner, branch.openingProjectId as string)

    expect(detail.project.name).toBe('פתיחת סניף: דיזנגוף')
    expect(detail.checklist.map((item) => item.title)).toEqual([...OPENING_CHECKLIST.he])
  })

  it('is refused to anyone but a super_admin, project and all', async () => {
    const seed = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const branch = await createBranch(seed, { name: 'Dizengoff' })

    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${seed}` },
      payload: {
        email: 'branch@burgers.local',
        displayName: 'Branch Admin',
        role: 'admin',
        locationId: branch.id,
      },
    })
    expect(invited.statusCode).toBe(201)
    const match = /token=([\w-]+)/.exec(harness.mailer.sent.at(-1)?.text ?? '')
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: {
        token: (match as RegExpExecArray)[1],
        password: OWNER_PASSWORD,
        preferredLanguage: 'en',
      },
    })
    expect(accepted.statusCode).toBe(200)
    const branchAdmin = accepted.json<{ token: string }>().token

    const refused = await harness.app.inject({
      method: 'POST',
      url: '/locations',
      headers: { authorization: `Bearer ${branchAdmin}` },
      payload: { name: 'Haifa Port', withOpeningProject: true },
    })
    expect(refused.statusCode).toBe(403)
    // Nothing was made on the way to the refusal — not the branch, and not a project either.
    expect(await listProjects(seed)).toEqual([])
  })
})
