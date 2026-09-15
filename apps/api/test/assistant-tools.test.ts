import { describe, expect, it } from 'vitest'
import { createFakeEmbeddingClient } from '../src/assistant/embedding-client.js'
import type { KnowledgeChunk } from '../src/assistant/repository.js'
import { type AssistantToolPorts, createAssistantTools } from '../src/assistant/tools.js'
import { createMutableClock } from '../src/auth/clock.js'
import type { Principal } from '../src/auth/principal.js'

// The read-only tools the assistant may call (#381), each a thin wrapper over an existing
// scoped read: the document search, the caller's own task board, the branch directory, the
// projects, the people list and the WhatsApp group summaries. What is asserted is the boundary:
// a tool answers from exactly the read its page uses, says out-of-scope rather than narrowing, and
// hands back the sources a chip is built from. Ports are in-memory stubs of the repositories.

const manager: Principal = {
  userId: 'u-manager',
  displayName: 'Dana',
  role: 'manager',
  locationId: 'loc-a',
  locationName: 'תלפיות',
  status: 'active',
}

const hq: Principal = {
  userId: 'u-ceo',
  displayName: 'Liat',
  role: 'ceo',
  locationId: null,
  status: 'active',
}

const chunk = (docId: string, docTitle: string, content: string): KnowledgeChunk => ({
  id: `${docId}-0`,
  docId,
  docTitle,
  chunkIndex: 0,
  content,
  embedded: false,
  gist: null,
})

const ports = (over: Partial<AssistantToolPorts> = {}): AssistantToolPorts => ({
  knowledge: {
    listGroundingChunks: async () => [
      chunk('doc-grill', 'Closing the grill', 'Shut the gas valve, then wipe the grill.'),
      chunk('doc-fry', 'The fryer', 'Drain the fryer oil every Sunday.'),
    ],
    searchChunksByVector: async () => [],
  },
  embeddings: createFakeEmbeddingClient(),
  tasks: {
    listScopedTasks: async () => [
      {
        title: 'Clean the grill',
        status: 'not_started',
        priority: 'high',
        dueDate: new Date('2026-09-16T00:00:00.000Z'),
        assignees: [{ displayName: 'Dana' }],
      },
    ],
  },
  locations: {
    listLocations: async () => [
      {
        id: 'loc-a',
        name: 'תלפיות',
        number: 41,
        address: 'האומן 14',
        city: 'ירושלים',
        phone: null,
      },
      { id: 'loc-b', name: 'מלחה', number: 23, address: null, city: 'ירושלים', phone: '*2242' },
    ],
  },
  projects: {
    list: async () => [
      {
        id: 'p-1',
        name: 'פתיחת סניף ראשונים',
        phase: 'in_progress',
        targetDate: new Date('2026-12-01T00:00:00.000Z'),
        locations: [{ id: 'loc-c', name: 'ראשונים' }],
        doneCount: 3,
        taskCount: 10,
      },
    ],
    listChecklist: async () => [
      { id: 's-1', title: 'לחתום על חוזה', done: true, assignees: [{ displayName: 'Israel' }] },
      { id: 's-2', title: 'להזמין ציוד', done: false, assignees: [] },
    ],
  },
  users: {
    listUsers: async () => [
      { displayName: 'Dana', role: 'manager', locationName: 'תלפיות', email: 'dana@x.il' },
      { displayName: 'Yossi', role: 'employee', locationName: 'תלפיות', email: 'yossi@x.il' },
    ],
  },
  whatsapp: {
    listSummaries: async () => [
      {
        chatName: 'סניף תלפיות',
        summaryDate: '2026-09-14',
        summary: 'A supplier delivered late.',
        messageCount: 12,
      },
    ],
  },
  access: { isAllowed: async () => true },
  clock: createMutableClock(new Date('2026-09-15T10:00:00.000Z')),
  ...over,
})

const toolNamed = (
  name: string,
  principal: Principal = manager,
  over?: Partial<AssistantToolPorts>,
) => {
  const built = createAssistantTools({ principal, priorUserTurns: [], ports: ports(over) })
  const tool = built.tools.find((candidate) => candidate.definition.name === name)
  if (!tool) throw new Error(`no tool named ${name}`)
  return { tool, built }
}

describe('createAssistantTools (#381)', () => {
  it('defines every tool with a unique name, a description and an object schema', () => {
    const { tools } = createAssistantTools({
      principal: manager,
      priorUserTurns: [],
      ports: ports(),
    })
    const names = tools.map((tool) => tool.definition.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(
      expect.arrayContaining([
        'search_documents',
        'my_tasks',
        'branch_directory',
        'projects',
        'people_directory',
        'whatsapp_summaries',
      ]),
    )
    for (const tool of tools) {
      expect(tool.definition.description.length).toBeGreaterThan(40)
      expect(tool.definition.parameters).toMatchObject({ type: 'object' })
      expect(tool.label.he.length).toBeGreaterThan(0)
    }
  })

  describe('search_documents', () => {
    it('returns the grounding block under exact titles and records the retrieval', async () => {
      const { tool, built } = toolNamed('search_documents')
      const outcome = await tool.run({ query: 'gas valve' })
      expect(outcome.status).toBe('ok')
      expect(outcome.content).toContain('## Closing the grill')
      expect(outcome.content).toContain('Shut the gas valve')
      expect(outcome.sources).toEqual([
        { id: 'doc-grill', title: 'Closing the grill', type: 'document' },
      ])
      // The answer path reads what was retrieved: the log row and the citation resolution both
      // depend on it, and neither may trust the model's own account.
      expect(built.retrievals()).toHaveLength(1)
      expect(built.retrievals()[0]?.mode).toBe('keyword')
      expect(built.retrievedDocs()).toEqual([{ id: 'doc-grill', title: 'Closing the grill' }])
    })

    it('reports an empty search honestly, with the corpus size so the model can say so', async () => {
      const { tool } = toolNamed('search_documents')
      const outcome = await tool.run({ query: 'zzzz nothing matches' })
      expect(outcome.status).toBe('empty')
      expect(outcome.sources).toEqual([])
    })

    it('searches through the caller’s knowledge scope, never an unscoped read', async () => {
      let seenScope: unknown = null
      const { tool } = toolNamed('search_documents', manager, {
        knowledge: {
          listGroundingChunks: async (scope) => {
            seenScope = scope
            return []
          },
          searchChunksByVector: async () => [],
        },
      })
      await tool.run({ query: 'anything' })
      expect(seenScope).toMatchObject({ role: 'manager' })
    })
  })

  describe('my_tasks', () => {
    it('renders the caller’s open tasks and names the app as the source', async () => {
      const { tool } = toolNamed('my_tasks')
      const outcome = await tool.run({})
      expect(outcome.status).toBe('ok')
      expect(outcome.content).toContain('Clean the grill')
      expect(outcome.content).toContain('2026-09-16')
      expect(outcome.sources[0]).toMatchObject({ id: 'app:tasks', type: 'app' })
    })

    it('says so when the caller has no open task', async () => {
      const { tool } = toolNamed('my_tasks', manager, {
        tasks: { listScopedTasks: async () => [] },
      })
      expect((await tool.run({})).status).toBe('empty')
    })
  })

  describe('branch_directory', () => {
    it('lists the branches the caller’s Locations page would show, with their details', async () => {
      const { tool } = toolNamed('branch_directory', hq)
      const outcome = await tool.run({})
      expect(outcome.status).toBe('ok')
      expect(outcome.content).toContain('41')
      expect(outcome.content).toContain('תלפיות')
      expect(outcome.content).toContain('האומן 14')
      expect(outcome.content).toContain('*2242')
      expect(outcome.content).toContain('2 ')
      expect(outcome.sources[0]).toMatchObject({ id: 'app:branches', type: 'app' })
    })

    it('passes the caller’s own scope to the read, exactly as the page does', async () => {
      let seen: unknown = null
      const { tool } = toolNamed('branch_directory', manager, {
        locations: {
          listLocations: async (scope) => {
            seen = scope
            return []
          },
        },
      })
      await tool.run({})
      expect(seen).toMatchObject({ role: 'manager', locationId: 'loc-a' })
    })

    it('is out of scope for a role whose pages do not include Locations', async () => {
      const { tool } = toolNamed('branch_directory', manager, {
        access: { isAllowed: async () => false },
      })
      const outcome = await tool.run({})
      expect(outcome.status).toBe('out_of_scope')
      expect(outcome.sources).toEqual([])
    })
  })

  describe('projects', () => {
    it('lists each project with its phase, branches and progress', async () => {
      const { tool } = toolNamed('projects', hq)
      const outcome = await tool.run({})
      expect(outcome.status).toBe('ok')
      expect(outcome.content).toContain('פתיחת סניף ראשונים')
      expect(outcome.content).toContain('in_progress')
      expect(outcome.content).toContain('ראשונים')
      expect(outcome.content).toContain('3/10')
      expect(outcome.content).toContain('2026-12-01')
    })

    it('adds the steps and their owners when the question names a project', async () => {
      const { tool } = toolNamed('projects', hq)
      const outcome = await tool.run({ query: 'ראשונים' })
      expect(outcome.content).toContain('לחתום על חוזה')
      expect(outcome.content).toContain('Israel')
      expect(outcome.content).toContain('להזמין ציוד')
    })

    it('is out of scope without the Projects page', async () => {
      const { tool } = toolNamed('projects', manager, { access: { isAllowed: async () => false } })
      expect((await tool.run({})).status).toBe('out_of_scope')
    })
  })

  describe('people_directory', () => {
    it('lists people with role and branch, filtered by the query', async () => {
      const { tool } = toolNamed('people_directory', hq)
      const outcome = await tool.run({ query: 'yossi' })
      expect(outcome.status).toBe('ok')
      expect(outcome.content).toContain('Yossi')
      expect(outcome.content).toContain('employee')
      expect(outcome.content).not.toContain('Dana')
    })

    it('is out of scope without the People page', async () => {
      const { tool } = toolNamed('people_directory', manager, {
        access: { isAllowed: async () => false },
      })
      expect((await tool.run({}))?.status).toBe('out_of_scope')
    })
  })

  describe('whatsapp_summaries', () => {
    it('reads the summaries of the named group for HQ roles, over the last days', async () => {
      let seen: unknown = null
      const { tool } = toolNamed('whatsapp_summaries', hq, {
        whatsapp: {
          listSummaries: async (query) => {
            seen = query
            return [
              {
                chatName: 'סניף תלפיות',
                summaryDate: '2026-09-14',
                summary: 'A supplier delivered late.',
                messageCount: 12,
              },
            ]
          },
        },
      })
      const outcome = await tool.run({ group: 'תלפיות' })
      expect(outcome.status).toBe('ok')
      expect(outcome.content).toContain('2026-09-14')
      expect(outcome.content).toContain('A supplier delivered late.')
      // Seven days ending today in Jerusalem, matched on the branch word alone.
      expect(seen).toEqual({ nameContains: 'תלפיות', from: '2026-09-09', to: '2026-09-15' })
      expect(outcome.sources[0]).toMatchObject({ id: 'app:whatsapp', type: 'app' })
    })

    it('is out of scope for a branch role, HQ only for now', async () => {
      const { tool } = toolNamed('whatsapp_summaries', manager)
      expect((await tool.run({ group: 'תלפיות' })).status).toBe('out_of_scope')
    })

    it('reports a quiet group as empty rather than missing', async () => {
      const { tool } = toolNamed('whatsapp_summaries', hq, {
        whatsapp: { listSummaries: async () => [] },
      })
      expect((await tool.run({ group: 'מלחה' })).status).toBe('empty')
    })
  })
})
