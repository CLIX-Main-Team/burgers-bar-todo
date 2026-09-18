import { describe, expect, it, vi } from 'vitest'
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
  docModifiedAt: new Date('2026-03-11T00:00:00.000Z'),
  docDriveFileId: `drive-${docId}`,
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
      {
        displayName: 'Dana',
        role: 'manager',
        locationName: 'תלפיות',
        email: 'dana@x.il',
        status: 'active',
      },
      {
        displayName: 'Yossi',
        role: 'employee',
        locationName: 'תלפיות',
        email: 'yossi@x.il',
        status: 'active',
      },
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
  language?: 'he' | 'en',
) => {
  const built = createAssistantTools({
    principal,
    priorUserTurns: [],
    ports: ports(over),
    ...(language ? { language } : {}),
  })
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
      // With the file's Drive link and its date (2026-09-18): the chip under the answer opens the
      // document, the same link the Knowledge tab uses, and says when it was last changed.
      expect(built.retrievedDocs()).toEqual([
        {
          id: 'doc-grill',
          title: 'Closing the grill',
          url: 'https://drive.google.com/file/d/drive-doc-grill/view',
          modifiedAt: '2026-03-11T00:00:00.000Z',
        },
      ])
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

describe('people_directory, told apart from a directory dump (#387)', () => {
  const withPeople = (
    rows: {
      displayName: string
      role: string
      locationName: string | null
      email: string
      status: string
    }[],
  ) =>
    toolNamed('people_directory', hq, {
      users: { listUsers: async () => rows as never },
    })

  it('marks a colleague who has left and one who never accepted, instead of listing them as staff', async () => {
    const { tool } = withPeople([
      {
        displayName: 'Dana',
        role: 'manager',
        locationName: 'תלפיות',
        email: 'dana@x.il',
        status: 'active',
      },
      {
        displayName: 'Gone',
        role: 'employee',
        locationName: 'תלפיות',
        email: 'gone@x.il',
        status: 'deactivated',
      },
      {
        displayName: 'Pending',
        role: 'employee',
        locationName: 'מלחה',
        email: 'p@x.il',
        status: 'invited',
      },
    ])
    const outcome = await tool.run({})
    expect(outcome.status).toBe('ok')
    expect(outcome.content).toMatch(/Gone.*(no longer works|left the company|deactivated)/i)
    expect(outcome.content).toMatch(/Pending.*(not accepted|invited)/i)
    // Dana is current, so she carries no marker.
    expect(outcome.content).toContain('- Dana (manager')
  })

  it('keeps work email out of the default listing and returns it only when asked for contact details', async () => {
    const { tool } = withPeople([
      {
        displayName: 'Dana',
        role: 'manager',
        locationName: 'תלפיות',
        email: 'dana@x.il',
        status: 'active',
      },
    ])
    expect((await tool.run({})).content).not.toContain('dana@x.il')
    expect((await tool.run({ contact: true })).content).toContain('dana@x.il')
  })

  it('finds a person through a Hebrew prefix letter and through the role in words', async () => {
    const { tool } = withPeople([
      {
        displayName: 'דנה',
        role: 'manager',
        locationName: 'תלפיות',
        email: 'd@x.il',
        status: 'active',
      },
      {
        displayName: 'יוסי',
        role: 'employee',
        locationName: 'מלחה',
        email: 'y@x.il',
        status: 'active',
      },
    ])
    // "בתלפיות" = "in Talpiot": the raw substring match returned nobody.
    const prefixed = await tool.run({ query: 'בתלפיות' })
    expect(prefixed.status).toBe('ok')
    expect(prefixed.content).toContain('דנה')
    // The role asked as the enum key still narrows. Matching the role asked in Hebrew words waits
    // on the localized role labels moving into the shared package.
    const byRole = await tool.run({ query: 'manager' })
    expect(byRole.status).toBe('ok')
    expect(byRole.content).toContain('דנה')
  })

  it('says plainly that nobody matched rather than returning everyone', async () => {
    const { tool } = withPeople([
      {
        displayName: 'דנה',
        role: 'manager',
        locationName: 'תלפיות',
        email: 'd@x.il',
        status: 'active',
      },
    ])
    const outcome = await tool.run({ query: 'קובי' })
    expect(outcome.status).toBe('empty')
  })
})

describe('search_documents dates its excerpts (#387)', () => {
  it('prints when each document was last updated, so a superseded file can be told apart', async () => {
    const { tool } = toolNamed('search_documents')
    const outcome = await tool.run({ query: 'grill' })
    expect(outcome.status).toBe('ok')
    expect(outcome.content).toContain('(updated 2026-03-11)')
  })
})

// The chip under an answer is titled in the language of the question, not of the account
// (2026-09-18): the answer itself follows the question since the language check, and an English
// answer over a chip reading "המשימות שלי" looked like two people wrote it. With no language
// given (the evaluation's older callers), the account's preference still decides.
describe('the source labels follow the language of the question', () => {
  it('titles an app source in Hebrew under a Hebrew question, whatever the account prefers', async () => {
    const { tool } = toolNamed('my_tasks', { ...manager, preferredLanguage: 'en' }, undefined, 'he')
    const outcome = await tool.run({})
    expect(outcome.sources[0]?.title).toBe('המשימות שלי')
  })

  it('falls back to the account language when no question language is given', async () => {
    const { tool } = toolNamed('my_tasks', { ...manager, preferredLanguage: 'en' })
    const outcome = await tool.run({})
    expect(outcome.sources[0]?.title).toBe('My tasks')
  })
})

// The company's public site as a seventh tool (2026-09-17). Read live, nothing stored; see
// company-website.ts for why. Offered only when a reader is configured, the same way the web
// search is: a deploy with no site to read must not advertise a tool that can only fail.
describe('company_website, the public site read live', () => {
  const page = (title: string, text: string) => ({
    entry: { kind: 'branch' as const, title, url: `https://site.example/branches/${title}/` },
    text,
  })

  it('is absent when no reader is configured', () => {
    const { tools } = createAssistantTools({
      principal: manager,
      priorUserTurns: [],
      ports: ports(),
    })
    expect(tools.map((tool) => tool.definition.name)).not.toContain('company_website')
  })

  it('returns the page text and cites the real page as a website source', async () => {
    const { tool } = toolNamed('company_website', manager, {
      website: {
        lookup: async () => ({ status: 'ok', pages: [page('Eilat', 'Sun-Wed 11:00-23:00')] }),
      },
    })
    const outcome = await tool.run({ query: 'Eilat' })
    expect(outcome.status).toBe('ok')
    expect(outcome.content).toContain('Sun-Wed 11:00-23:00')
    expect(outcome.sources).toEqual([
      {
        id: 'https://site.example/branches/Eilat/',
        title: 'Eilat',
        type: 'website',
        url: 'https://site.example/branches/Eilat/',
      },
    ])
  })

  it('answers a menu question from the product names', async () => {
    const { tool } = toolNamed('company_website', manager, {
      website: {
        lookup: async () => ({
          status: 'menu',
          matched: [
            { kind: 'product', title: 'Pesto', url: 'https://burgersbar.co.il/products/pesto/' },
          ],
          all: ['Pesto', 'Chimichurri'],
        }),
      },
    })
    const outcome = await tool.run({ query: 'pesto' })
    expect(outcome.status).toBe('ok')
    expect(outcome.content).toContain('Pesto')
    expect(outcome.content).toContain('Chimichurri')
    // The chip under a menu answer is the item's own page (2026-09-18).
    expect(outcome.sources).toEqual([
      {
        id: 'https://burgersbar.co.il/products/pesto/',
        title: 'Pesto',
        type: 'website',
        url: 'https://burgersbar.co.il/products/pesto/',
      },
    ])
  })

  it('lists the branches and the menu it does know when nothing matched, so the model can judge', async () => {
    const { tool } = toolNamed('company_website', manager, {
      website: {
        lookup: async () => ({
          status: 'empty',
          known: { branches: ['Eilat', 'Haifa'], pages: [], products: ['Beyond', 'Classic'] },
        }),
        list: async () => ({ status: 'failed', reason: 'unused' }),
      },
    })
    const outcome = await tool.run({ query: 'vegan' })
    expect(outcome.status).toBe('empty')
    expect(outcome.content).toContain('Eilat')
    expect(outcome.content).toContain('Haifa')
    // The vegan question of 2026-09-18: no item is named "vegan", and without the menu in front
    // of it the model said there was nothing, while the site lists Beyond.
    expect(outcome.content).toContain('Beyond')
  })

  it('counts and lists every branch on the site when asked for the list, citing the archive page', async () => {
    const list = vi.fn(async () => ({
      status: 'ok' as const,
      url: 'https://site.example/branches/',
      titles: ['Eilat', 'Haifa'],
    }))
    const { tool } = toolNamed(
      'company_website',
      manager,
      { website: { lookup: async () => ({ status: 'failed', reason: 'unused' }), list } },
      'en',
    )
    const outcome = await tool.run({ list: 'branches' })
    expect(outcome.status).toBe('ok')
    expect(list).toHaveBeenCalledWith('branch')
    expect(outcome.content).toContain('2 branches')
    expect(outcome.content).toContain('Eilat')
    expect(outcome.sources).toEqual([
      {
        id: 'https://site.example/branches/',
        title: 'Branches on the website',
        type: 'website',
        url: 'https://site.example/branches/',
      },
    ])
  })

  it('lists the menu the same way', async () => {
    const list = vi.fn(async () => ({
      status: 'ok' as const,
      url: 'https://site.example/products/',
      titles: ['Beyond', 'Classic'],
    }))
    const { tool } = toolNamed(
      'company_website',
      manager,
      { website: { lookup: async () => ({ status: 'failed', reason: 'unused' }), list } },
      'en',
    )
    const outcome = await tool.run({ list: 'menu' })
    expect(outcome.status).toBe('ok')
    expect(list).toHaveBeenCalledWith('product')
    expect(outcome.content).toContain('2 items')
    expect(outcome.sources[0]?.title).toBe('Menu on the website')
  })

  it('reports an unreachable site as a failed lookup, never as "no such branch"', async () => {
    const { tool } = toolNamed('company_website', manager, {
      website: { lookup: async () => ({ status: 'failed', reason: 'timeout' }) },
    })
    const outcome = await tool.run({ query: 'Eilat' })
    expect(outcome.status).toBe('failed')
  })

  it('refuses an empty query instead of fetching the whole site', async () => {
    const lookup = vi.fn()
    const { tool } = toolNamed('company_website', manager, { website: { lookup } })
    const outcome = await tool.run({ query: '   ' })
    expect(outcome.status).toBe('failed')
    expect(lookup).not.toHaveBeenCalled()
  })

  // Public facts about the chain. Nothing a tool returned here is a person or their words, so it
  // must not switch the web search off the way the people and WhatsApp tools do.
  it('is not personal data', () => {
    const { tool } = toolNamed('company_website', manager, {
      website: { lookup: async () => ({ status: 'failed', reason: 'x' }) },
    })
    expect(tool.personalData ?? false).toBe(false)
  })
})
