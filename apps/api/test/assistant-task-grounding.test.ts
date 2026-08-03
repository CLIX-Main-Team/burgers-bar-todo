import type { ThreadDetail } from '@burgers/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type AnswerAppHarness, createAnswerAppHarness } from './helpers/answer-app.js'

// The assistant task-grounding boundary (#92, ADR-0007/0001/0013): a staff member's task question is
// answered only from the tasks that same principal may already see — an Employee from their own
// assigned tasks, a Manager from their location's board, an Admin chain-wide — and the Assistant can
// never surface a task the asking user could not open on the board itself (the backlog, another
// user's task, another location's). The retrieval rides the *same* ADR-0007 scoped board read the
// board UI uses, so this suite proves the boundary observably: the LLM is the injected fake, scripted
// to report back exactly which task titles the assembled grounding carried into its system prompt, so
// the answer's content is a faithful readout of what the scoped read admitted — no prompt-string peek,
// only external HTTP behaviour. The failure this suite exists to catch is a task leaking across the
// scope line into an answer.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const USER_PASSWORD = 'valid-password-123'
const LOC_A = '11111111-1111-1111-1111-111111111111'
const LOC_B = '22222222-2222-2222-2222-222222222222'

// Unique task-title markers, one per seeded task, so a substring check in the answer is an
// unambiguous "this task was in scope" / "this task was withheld".
const T_E1 = 'Restock the E1 grill station'
const T_E2 = 'Sweep the E2 walk-in aisle'
const T_BACKLOG_A = 'Audit the location-A backlog shelf'
const T_LOC_B = 'Defrost the location-B freezer'

// Every marker, so the scripted model can report which ones the grounding carried.
const ALL_TASKS = [T_E1, T_E2, T_BACKLOG_A, T_LOC_B]

describe('assistant: scoped task grounding (#92)', () => {
  let harness: AnswerAppHarness

  beforeAll(async () => {
    harness = await createAnswerAppHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.auth.repo, harness.auth.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
    // The two locations this suite scopes across, so the FK on users.location_id and tasks.location_id
    // resolves for both.
    await harness.seedLocation({ id: LOC_A, name: 'Location A' })
    await harness.seedLocation({ id: LOC_B, name: 'Location B' })

    // The obedient, grounded model for every case: it reads the system turn the answer path assembled
    // and answers with exactly the task markers that made it into the grounding. No procedures are
    // published in this suite, so any marker present came from the scoped task block — the answer is a
    // pure readout of what the ADR-0007 read admitted for the asking principal.
    harness.llm.respondWith((request) => {
      const system = request.messages.find((message) => message.role === 'system')?.content ?? ''
      const present = ALL_TASKS.filter((title) => system.includes(title))
      const content =
        present.length > 0 ? `Your tasks: ${present.join('; ')}.` : 'You have no tasks.'
      return { ok: true, content }
    })
  })

  // --- helpers, all driving the HTTP seam ---

  const signInToken = async (email: string, password: string): Promise<string> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email, password },
    })
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const adminToken = (): Promise<string> => signInToken(SEED_EMAIL, SEED_PASSWORD)

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    return (match as RegExpExecArray)[1]
  }

  // Provision a user of any role/location through the real invite-then-accept flow, returning their
  // sign-in token. The admin creates the invite (so the role/location pair is one it may create), and
  // accept activates it.
  const provisionUser = async (
    email: string,
    role: 'admin' | 'manager' | 'employee',
    locationId: string | null,
  ): Promise<string> => {
    const admin = await adminToken()
    const created = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: { email, displayName: `A ${role}`, role, locationId },
    })
    expect(created.statusCode).toBe(201)
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: USER_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  // Seed one task through the same board data-access a write goes through, at a given location with a
  // given assignee set (empty = backlog).
  const seedTask = async (
    title: string,
    locationId: string,
    assigneeIds: string[],
  ): Promise<void> => {
    await harness.seedTask({
      locationId,
      title,
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds,
    })
  }

  // Ask the assistant a task question as `token` and return the agent's answer text. Creating the
  // thread and posting the question both run as the asking principal, so the answer path scopes the
  // task grounding to them.
  const askAboutTasks = async (token: string): Promise<string> => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/threads',
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'What are my tasks?' },
    })
    expect(created.statusCode).toBe(201)
    const threadId = created.json<ThreadDetail>().id

    const answered = await harness.app.inject({
      method: 'POST',
      url: `/threads/${threadId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'What are my tasks?' },
    })
    expect(answered.statusCode).toBe(201)
    const detail = answered.json<ThreadDetail>()
    const agent = detail.messages.at(-1)
    expect(agent?.role).toBe('agent')
    return agent?.content ?? ''
  }

  // Seed the full cross-location, cross-user board every scope case reads against: E1's and E2's own
  // tasks and the backlog at Location A, and E3's task at Location B.
  const seedBoard = async (): Promise<{ e1: string; e2: string; e3: string }> => {
    const e1 = await harness.userIdByEmail('e1@burgers.local')
    const e2 = await harness.userIdByEmail('e2@burgers.local')
    const e3 = await harness.userIdByEmail('e3@burgers.local')
    await seedTask(T_E1, LOC_A, [e1])
    await seedTask(T_E2, LOC_A, [e2])
    await seedTask(T_BACKLOG_A, LOC_A, []) // backlog: no assignee
    await seedTask(T_LOC_B, LOC_B, [e3])
    return { e1, e2, e3 }
  }

  // --- AC: an Employee's task question is answered only from their own assigned tasks ---

  it('AC — an Employee is answered only from their own assigned tasks, never others or the backlog', async () => {
    const e1Token = await provisionUser('e1@burgers.local', 'employee', LOC_A)
    await provisionUser('e2@burgers.local', 'employee', LOC_A)
    await provisionUser('e3@burgers.local', 'employee', LOC_B)
    await seedBoard()

    const answer = await askAboutTasks(e1Token)

    // Their own assigned task is grounded on…
    expect(answer).toContain(T_E1)
    // …and nothing else the board holds: not a co-worker's task, not the unassigned backlog, not
    // another location's task. This is AC-1 and the AC-3 leak guard in one read.
    expect(answer).not.toContain(T_E2)
    expect(answer).not.toContain(T_BACKLOG_A)
    expect(answer).not.toContain(T_LOC_B)
  })

  // --- AC: a Manager's task question is scoped to their own location's board ---

  it("AC — a Manager is scoped to their own location's board, including its backlog, but never another location", async () => {
    const managerAToken = await provisionUser('manager-a@burgers.local', 'manager', LOC_A)
    await provisionUser('e1@burgers.local', 'employee', LOC_A)
    await provisionUser('e2@burgers.local', 'employee', LOC_A)
    await provisionUser('e3@burgers.local', 'employee', LOC_B)
    await seedBoard()

    const answer = await askAboutTasks(managerAToken)

    // The whole Location-A board — both employees' tasks and the location's backlog — is in scope…
    expect(answer).toContain(T_E1)
    expect(answer).toContain(T_E2)
    expect(answer).toContain(T_BACKLOG_A)
    // …but Location B's task is not: a manager never reaches across the location line (AC-2, AC-3).
    expect(answer).not.toContain(T_LOC_B)
  })

  // --- AC: an Admin's task question spans the chain ---

  it('AC — an Admin spans the chain: every location and the backlog are in scope', async () => {
    await provisionUser('e1@burgers.local', 'employee', LOC_A)
    await provisionUser('e2@burgers.local', 'employee', LOC_A)
    await provisionUser('e3@burgers.local', 'employee', LOC_B)
    await seedBoard()

    const adminToken2 = await adminToken()
    const answer = await askAboutTasks(adminToken2)

    // Chain-wide: both locations' tasks and the backlog all ground the admin's answer (AC-2).
    expect(answer).toContain(T_E1)
    expect(answer).toContain(T_E2)
    expect(answer).toContain(T_BACKLOG_A)
    expect(answer).toContain(T_LOC_B)
  })

  // --- A large in-scope board is truncated for prompt size, but the answer stays honest about it ---

  it('surfaces a truncation notice when the scoped board is too large to inject whole', async () => {
    const busy = await provisionUser('busy@burgers.local', 'employee', LOC_A)
    const busyId = await harness.userIdByEmail('busy@burgers.local')
    // Assign more own-tasks than the task-context budget can hold, so the answer path must truncate.
    // Each is in-scope (names this employee), so truncation is a size cut, never a scope decision.
    for (let i = 0; i < 150; i += 1) {
      await seedTask(`Own recurring task ${i}`, LOC_A, [busyId])
    }

    // A responder that reports only whether the assembled task block admitted it is incomplete — the
    // observable proof that a truncated list is disclosed rather than passed off as the whole set.
    harness.llm.respondWith((request) => {
      const system = request.messages.find((message) => message.role === 'system')?.content ?? ''
      return {
        ok: true,
        content: system.toLowerCase().includes('incomplete')
          ? 'Note: your task list is incomplete.'
          : 'Here is your complete task list.',
      }
    })

    const answer = await askAboutTasks(busy)
    expect(answer.toLowerCase()).toContain('incomplete')
  })

  // --- AC: with no tasks in scope, the grounding carries none — the model is told there are none ---

  it('AC — an Employee with no assigned tasks grounds on no tasks at all', async () => {
    const loner = await provisionUser('loner@burgers.local', 'employee', LOC_A)
    // Someone else's task and the backlog exist, but none names the loner.
    await provisionUser('e2@burgers.local', 'employee', LOC_A)
    const e2 = await harness.userIdByEmail('e2@burgers.local')
    await seedTask(T_E2, LOC_A, [e2])
    await seedTask(T_BACKLOG_A, LOC_A, [])

    const answer = await askAboutTasks(loner)

    // The scoped read admits nothing, so the grounding carries no task markers and the model — told
    // there are no visible tasks — answers from an empty task block. Neither foreign task leaks in.
    expect(answer).not.toContain(T_E2)
    expect(answer).not.toContain(T_BACKLOG_A)
    expect(answer).toContain('no tasks')
  })
})
