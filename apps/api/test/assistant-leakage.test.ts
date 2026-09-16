import type { Role } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { sensitivitiesVisibleTo } from '../src/assistant/document-metadata.js'
import { createFakeEmbeddingClient } from '../src/assistant/embedding-client.js'
import type { KnowledgeChunk } from '../src/assistant/repository.js'
import { type AssistantToolPorts, createAssistantTools } from '../src/assistant/tools.js'
import { createMutableClock } from '../src/auth/clock.js'
import type { Principal } from '../src/auth/principal.js'

// Who sees what, asked as five different people (PR4, roadmap group b item 11).
//
// The client's CEO put department-level permissions in writing as a requirement, and until this
// file nothing anywhere asked the same question as two different principals. The audit's D1 —
// a branch admin reads every branch's lease and franchise terms — was found by reading the role
// table, not by a failing test, which is the whole problem: there was no test to fail.
//
// This runs against in-memory ports at no cost, so it rides every PR rather than the paid battery.
// Two things are asserted, and they catch different defects:
//
//   1. The scope each tool hands its repository. A tool that forgets to pass the caller's branch
//      widens every row the SQL returns, which is exactly how projects/scope.ts leaked the chain
//      to a branch admin. The stubs record what they were handed.
//   2. The rendered result. Forbidden strings — another branch's rent, a colleague's email, the
//      head-office chatter — must be absent from the text the model is handed, not merely absent
//      from the database row.

const OTHER_BRANCH_RENT = '42,500'
const OWN_BRANCH_RENT = '31,000'

const chunk = (
  id: string,
  docTitle: string,
  content: string,
  sensitivity: 'general' | 'internal' | 'confidential',
): KnowledgeChunk & { sensitivity: typeof sensitivity } => ({
  id,
  docId: `doc-${id}`,
  docTitle,
  chunkIndex: 0,
  content,
  embedded: false,
  gist: null,
  docModifiedAt: new Date('2026-03-11T00:00:00.000Z'),
  sensitivity,
})

const CORPUS = [
  chunk('open', 'Opening the branch', 'Unlock the door, then start the fryers.', 'general'),
  chunk('staff', 'Shift handover', 'Count the till and sign the handover sheet.', 'internal'),
  chunk(
    'lease-a',
    'Lease, Talpiot',
    `The Talpiot branch pays ${OWN_BRANCH_RENT} shekel a month.`,
    'confidential',
  ),
  chunk(
    'lease-b',
    'Lease, Malha',
    `The Malha branch pays ${OTHER_BRANCH_RENT} shekel a month.`,
    'confidential',
  ),
]

interface SeenScopes {
  knowledge: { role: Role; view?: string }[]
  locations: { role: Role; locationId: string | null }[]
  users: { role: Role; locationId: string | null }[]
}

const world = (): { ports: AssistantToolPorts; seen: SeenScopes } => {
  const seen: SeenScopes = { knowledge: [], locations: [], users: [] }
  const ports: AssistantToolPorts = {
    knowledge: {
      // The corpus read, scoped the way the repository scopes it in SQL: a role reads the tiers
      // its ladder allows and nothing below them.
      listGroundingChunks: async (scope) => {
        seen.knowledge.push({ role: scope.role, view: scope.view })
        const allowed = sensitivitiesVisibleTo(scope.role, scope.view)
        return CORPUS.filter((row) => allowed.includes(row.sensitivity))
      },
      searchChunksByVector: async () => [],
    },
    embeddings: createFakeEmbeddingClient(),
    tasks: { listScopedTasks: async () => [] },
    locations: {
      listLocations: async (scope) => {
        seen.locations.push({ role: scope.role, locationId: scope.locationId })
        const rows = [
          { id: 'loc-a', name: 'תלפיות', number: 41, address: null, city: 'ירושלים', phone: null },
          { id: 'loc-b', name: 'מלחה', number: 23, address: null, city: 'ירושלים', phone: null },
        ]
        return scope.locationId ? rows.filter((row) => row.id === scope.locationId) : rows
      },
    },
    projects: { list: async () => [], listChecklist: async () => [] },
    users: {
      listUsers: async (scope) => {
        seen.users.push({ role: scope.role, locationId: scope.locationId })
        const rows = [
          {
            displayName: 'Dana',
            role: 'manager' as Role,
            locationName: 'תלפיות',
            locationId: 'loc-a',
            email: 'dana@burgers.il',
            status: 'active' as const,
          },
          {
            displayName: 'Rivka',
            role: 'manager' as Role,
            locationName: 'מלחה',
            locationId: 'loc-b',
            email: 'rivka@burgers.il',
            status: 'active' as const,
          },
        ]
        const scoped = scope.locationId
          ? rows.filter((row) => row.locationId === scope.locationId)
          : rows
        return scoped.map(({ locationId: _drop, ...row }) => row)
      },
    },
    whatsapp: {
      listSummaries: async () => [
        {
          chatName: 'מנהלי רשת',
          summaryDate: '2026-09-14',
          summary: `Head office discussed the ${OTHER_BRANCH_RENT} rent review.`,
          messageCount: 31,
        },
      ],
    },
    access: { isAllowed: async () => true },
    clock: createMutableClock(new Date('2026-09-16T10:00:00.000Z')),
  }
  return { ports, seen }
}

const principal = (role: Role, locationId: string | null): Principal => ({
  userId: `u-${role}`,
  displayName: 'Tester',
  role,
  locationId,
  locationName: locationId === 'loc-a' ? 'תלפיות' : null,
  status: 'active',
})

const CAST: { label: string; principal: Principal }[] = [
  { label: 'employee at Talpiot', principal: principal('employee', 'loc-a') },
  { label: 'manager at Talpiot', principal: principal('manager', 'loc-a') },
  { label: 'branch admin at Talpiot', principal: principal('admin', 'loc-a') },
  { label: 'finance manager, chain-wide', principal: principal('finance_manager', null) },
  { label: 'super admin, chain-wide', principal: principal('super_admin', null) },
]

const run = async (person: Principal, toolName: string, args: unknown = {}) => {
  const { ports, seen } = world()
  const built = createAssistantTools({ principal: person, priorUserTurns: [], ports })
  const tool = built.tools.find((candidate) => candidate.definition.name === toolName)
  if (!tool) return { outcome: null, seen, offered: built.tools.map((t) => t.definition.name) }
  const outcome = await tool.run(args)
  return { outcome, seen, offered: built.tools.map((t) => t.definition.name) }
}

describe('scope reaches the repository', () => {
  it.each(CAST)(
    '$label asks people_directory with their own branch',
    async ({ principal: who }) => {
      const { seen } = await run(who, 'people_directory')
      expect(seen.users).toHaveLength(1)
      // A branch-bound caller must arrive at the read carrying their branch. Null here is the whole
      // chain, and it is how a scope leak looks one layer before anyone notices the extra rows.
      expect(seen.users[0]?.locationId).toBe(who.locationId)
    },
  )

  it.each(CAST)(
    '$label asks branch_directory with their own branch',
    async ({ principal: who }) => {
      const { seen } = await run(who, 'branch_directory')
      expect(seen.locations[0]?.locationId).toBe(who.locationId)
    },
  )

  it.each(CAST)('$label asks the corpus as their own role', async ({ principal: who }) => {
    const { seen } = await run(who, 'search_documents', { query: 'lease' })
    expect(seen.knowledge[0]?.role).toBe(who.role)
  })
})

describe('another branch never reaches a branch role', () => {
  it('keeps the other branch out of a manager branch listing', async () => {
    const { outcome } = await run(principal('manager', 'loc-a'), 'branch_directory')
    expect(outcome?.content).not.toContain('מלחה')
    expect(outcome?.content).toContain('תלפיות')
  })

  it('keeps another branch colleague out of a manager people listing', async () => {
    const { outcome } = await run(principal('manager', 'loc-a'), 'people_directory')
    expect(outcome?.content).not.toContain('Rivka')
  })

  it('does not hand a manager another branch rent, even when asked for it by name', async () => {
    const { outcome } = await run(principal('manager', 'loc-a'), 'search_documents', {
      query: 'Malha lease rent',
    })
    expect(outcome?.content ?? '').not.toContain(OTHER_BRANCH_RENT)
  })

  it('does not hand an employee any lease at all', async () => {
    const { outcome } = await run(principal('employee', 'loc-a'), 'search_documents', {
      query: 'lease rent',
    })
    expect(outcome?.content ?? '').not.toContain(OWN_BRANCH_RENT)
    expect(outcome?.content ?? '').not.toContain(OTHER_BRANCH_RENT)
  })
})

describe('the branch admin horizon, the open decision', () => {
  // Audit finding D1, and it is NOT settled: the 18-role commit put `admin` in the confidential
  // tier on purpose, and whether about 46 branch admins should read chain-wide lease and franchise
  // terms is the owner's call, not a bug to quietly fix. What this pins is today's answer, so the
  // day it changes it changes here, deliberately, with the decision written beside it.
  it('today lets a branch admin read every branch lease', async () => {
    const { outcome } = await run(principal('admin', 'loc-a'), 'search_documents', {
      query: 'Malha lease rent',
    })
    expect(outcome?.content ?? '').toContain(OTHER_BRANCH_RENT)
  })

  it('and a manager at the same branch cannot', async () => {
    expect(sensitivitiesVisibleTo('manager')).not.toContain('confidential')
  })
})

describe('head-office chatter stays at head office', () => {
  it.each([
    { label: 'employee', role: 'employee' as Role, branch: 'loc-a' },
    { label: 'manager', role: 'manager' as Role, branch: 'loc-a' },
    { label: 'branch admin', role: 'admin' as Role, branch: 'loc-a' },
  ])('refuses whatsapp_summaries to a $label', async ({ role, branch }) => {
    const { outcome, offered } = await run(principal(role, branch), 'whatsapp_summaries', {
      group: 'mnhli',
    })
    // Either the tool is not offered to this role at all, or it answers out of scope. Both are
    // safe; silently narrowing the rows would not be.
    if (offered.includes('whatsapp_summaries')) {
      expect(outcome?.status).toBe('out_of_scope')
      expect(outcome?.content ?? '').not.toContain(OTHER_BRANCH_RENT)
    }
  })

  it.each([
    { label: 'finance manager', role: 'finance_manager' as Role },
    { label: 'super admin', role: 'super_admin' as Role },
  ])('serves whatsapp_summaries to a $label', async ({ role }) => {
    const { outcome } = await run(principal(role, null), 'whatsapp_summaries', { group: 'mnhli' })
    expect(outcome?.status).toBe('ok')
  })
})

describe('a work email is contact data, not a directory column', () => {
  it('leaves the email out of an ordinary people listing', async () => {
    const { outcome } = await run(principal('manager', 'loc-a'), 'people_directory')
    expect(outcome?.content ?? '').not.toContain('dana@burgers.il')
  })

  it('adds it only when the asker wanted to reach someone', async () => {
    const { outcome } = await run(principal('manager', 'loc-a'), 'people_directory', {
      contact: true,
    })
    expect(outcome?.content ?? '').toContain('dana@burgers.il')
  })
})
