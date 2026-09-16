import { describe, expect, it } from 'vitest'
import { createFakeEmbeddingClient } from '../src/assistant/embedding-client.js'
import { answerThroughLoop, evalPrincipal } from '../src/assistant/eval-runner.js'
import { WEB_SEARCH_TOOL, createFakeLlmClient } from '../src/assistant/llm-client.js'
import type { AssistantToolPorts } from '../src/assistant/tools.js'
import { createMutableClock } from '../src/auth/clock.js'

// The evaluation's answer step (PR4). Until #388 the harness pasted a grounding block into the
// retired one-shot prompt and called that "the assistant" — it measured a code path production had
// stopped running on 2026-09-15, so routing, tool choice, web freshness and chips were all
// unmeasured (finding EO-2). This drives the real loop instead: the real prompt, the real tools,
// the real server-side search, under the item's own role.

const clock = createMutableClock(new Date('2026-09-16T10:00:00.000Z'))

const ports = (): AssistantToolPorts => ({
  knowledge: {
    listGroundingChunks: async () => [
      {
        id: 'c-1',
        docId: 'doc-grill',
        docTitle: 'Closing the grill',
        chunkIndex: 0,
        content: 'Shut the gas valve, then wipe the grill.',
        embedded: false,
        gist: null,
        docModifiedAt: new Date('2026-03-11T00:00:00.000Z'),
      },
    ],
    searchChunksByVector: async () => [],
  },
  embeddings: createFakeEmbeddingClient(),
  tasks: { listScopedTasks: async () => [] },
  locations: { listLocations: async () => [] },
  projects: { list: async () => [], listChecklist: async () => [] },
  users: { listUsers: async () => [] },
  whatsapp: { listSummaries: async () => [] },
  access: { isAllowed: async () => true },
  clock,
})

describe('evalPrincipal', () => {
  it('builds a principal from the item role rather than a hardcoded employee', () => {
    const principal = evalPrincipal({
      role: 'manager',
      locationId: 'loc-a',
      locationName: 'תלפיות',
    })
    expect(principal.role).toBe('manager')
    expect(principal.locationId).toBe('loc-a')
    expect(principal.status).toBe('active')
  })

  it('leaves a chain-wide role with no branch', () => {
    expect(evalPrincipal({ role: 'ceo' }).locationId).toBeNull()
  })
})

describe('answerThroughLoop', () => {
  it('drives the real tool loop and hands back the trace of what ran', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) => {
      const results = request.messages.filter((message) => message.role === 'tool')
      if (results.length === 0) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_documents', arguments: '{"query":"grill"}' }],
        }
      }
      return { ok: true, content: 'Shut the gas valve.\n\nSOURCES: Closing the grill' }
    })

    const answered = await answerThroughLoop({
      llm,
      clock,
      ports: ports(),
      principal: evalPrincipal({ role: 'manager', locationId: 'loc-a' }),
      question: 'How do I close the grill?',
      priorUserTurns: [],
      webSearch: null,
      knowledgeCutoff: 'January 2025',
    })

    expect(answered.ok).toBe(true)
    expect(answered.trace.map((entry) => entry.tool)).toEqual(['search_documents'])
    // The trailer is stripped, exactly as the answer path strips it before anyone reads the answer.
    expect(answered.text).toBe('Shut the gas valve.')
    expect(answered.rounds).toBe(2)
  })

  it('resolves a cited document and counts a cited title that resolves to nothing', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) => {
      const results = request.messages.filter((message) => message.role === 'tool')
      if (results.length === 0) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_documents', arguments: '{"query":"grill"}' }],
        }
      }
      // One real title, one the search never returned: the invented-source class.
      return {
        ok: true,
        content: 'Shut the gas valve.\n\nSOURCES: Closing the grill | The 2019 safety manual',
      }
    })

    const answered = await answerThroughLoop({
      llm,
      clock,
      ports: ports(),
      principal: evalPrincipal({ role: 'manager', locationId: 'loc-a' }),
      question: 'How do I close the grill?',
      priorUserTurns: [],
      webSearch: null,
      knowledgeCutoff: null,
    })

    expect(answered.sources.map((source) => source.title)).toEqual(['Closing the grill'])
    expect(answered.unresolvedCitations).toBe(1)
  })

  it('builds the prompt under the item role and offers the web search when one is given', async () => {
    const llm = createFakeLlmClient()
    const seen: { system: string; tools: string[] }[] = []
    llm.respondWith((request) => {
      seen.push({
        system: request.messages.find((message) => message.role === 'system')?.content ?? '',
        tools: (request.tools ?? []).map((tool) =>
          tool.kind === 'server' ? tool.type : tool.name,
        ),
      })
      return { ok: true, content: 'Hello.' }
    })

    const answered = await answerThroughLoop({
      llm,
      clock,
      ports: ports(),
      principal: evalPrincipal({ role: 'ceo', locationName: null }),
      question: 'שלום',
      priorUserTurns: [],
      webSearch: WEB_SEARCH_TOOL,
      knowledgeCutoff: 'January 2025',
    })

    expect(answered.ok).toBe(true)
    // The cutoff line is the one #387 added; its presence proves the real prompt was built, not a
    // hand-rolled one that would drift from the deployed wording.
    expect(seen[0]?.system).toContain('January 2025')
    expect(seen[0]?.tools).toContain('openrouter:web_search')
    expect(answered.systemPrompt).toBe(seen[0]?.system)
  })

  it('reports a model failure instead of throwing, so one bad item cannot end a paid run', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith(() => ({ ok: false, error: 'provider 429' }))

    const answered = await answerThroughLoop({
      llm,
      clock,
      ports: ports(),
      principal: evalPrincipal({ role: 'employee', locationId: 'loc-a' }),
      question: 'anything',
      priorUserTurns: [],
      webSearch: null,
      knowledgeCutoff: null,
    })

    expect(answered.ok).toBe(false)
    expect(answered.error).toBe('provider 429')
  })
})
