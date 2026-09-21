import { describe, expect, it } from 'vitest'
import {
  type AssistantPromptMeta,
  REPLAYED_TURNS,
  SOURCES_PREFIX,
  buildAssistantSystemPrompt,
  buildToolLoopMessages,
  collectSources,
  formatTodayInJerusalem,
} from '../src/assistant/grounding.js'
import type { MessageRow } from '../src/assistant/thread-repository.js'

// The tool-using assistant's prompt assembly and provenance (#381): the persona and policy the
// owner locked on 2026-09-15 (company sources first, then the web, then general knowledge; never an
// invented fact; both sides of a conflict; work only), the per-call fence the tool results are
// quoted between, and the source list built from what actually ran. Structural assertions only —
// no test pins the prompt's wording.

const META: AssistantPromptMeta = {
  today: 'Tuesday, 2026-09-15',
  role: 'manager',
  displayName: 'Dana',
  locationName: 'תלפיות',
  locationKind: 'branch',
  toolNames: ['search_documents', 'my_tasks', 'branch_directory'],
  webSearch: true,
  knowledgeCutoff: 'January 2025',
}

const message = (role: 'user' | 'agent', content: string, seconds: number): MessageRow => ({
  id: `id-${role}-${seconds}`,
  role,
  content,
  sources: null,
  createdAt: new Date(`2026-01-01T00:00:${String(seconds).padStart(2, '0')}.000Z`),
})

describe('buildAssistantSystemPrompt (#381)', () => {
  const prompt = buildAssistantSystemPrompt(META, 'feedface')
  const lower = prompt.toLowerCase()

  it('states who it is talking to: the date, the role, the name and the branch', () => {
    expect(prompt).toContain('Tuesday, 2026-09-15')
    expect(prompt).toContain('manager')
    expect(prompt).toContain('Dana')
    expect(prompt).toContain('תלפיות')
  })

  it('names the tools it may call, so the guidance and the wire definitions agree', () => {
    for (const name of META.toolNames) {
      expect(prompt).toContain(name)
    }
  })

  it('orders the sources: company material first, the web after, general knowledge last', () => {
    const documents = lower.indexOf('document')
    const web = lower.indexOf('web')
    const general = lower.indexOf('general knowledge')
    expect(documents).toBeGreaterThan(-1)
    expect(web).toBeGreaterThan(documents)
    expect(general).toBeGreaterThan(web)
  })

  // Seen on production 2026-09-18: "check with the branch you plan to visit" and "You make a
  // great point!" to a member of staff. The person is the company, and a colleague does not gush.
  it('tells the model the person is a colleague, never a customer, and not to flatter', () => {
    expect(lower).toContain('never a customer')
    expect(lower).toContain('exclamation')
  })

  it('sends facts that change over time to the web search rather than to memory (#385)', () => {
    // The 2026-09-16 production battery answered the VAT rate from stale general knowledge with
    // no search at all; with a search offered, a dated fact is looked up, never recalled.
    expect(lower).toContain('vat')
    expect(lower).not.toContain('could not check the web')
  })

  it('says the web could not be checked when no search is offered on the call (#385)', () => {
    const offline = buildAssistantSystemPrompt({ ...META, webSearch: false }, 'feedface')
    expect(offline.toLowerCase()).toContain('could not check the web')
    expect(offline.toLowerCase()).not.toContain('vat')
  })

  it('anchors the model to its own knowledge cutoff and orders it to search a changing fact (#385, #387)', () => {
    // The 2026-09-16 production battery answered the VAT rate from memory. The rule was a
    // description ("is looked up"); it is now an instruction, with the cutoff named so the model
    // knows where its own knowledge ends.
    expect(lower).toContain('cutoff')
    expect(lower).toMatch(/search the web before (you )?answer/)
  })

  it('asks for a dated attribution on a web fact and a premise check on a claim in the question (#387)', () => {
    expect(lower).toContain('as of')
    expect(lower).toMatch(/premise|assumes|takes for granted/)
  })

  it('states the lookup budget and what to do when it runs out (#387)', () => {
    expect(lower).toMatch(/(at most|up to) (four|4) lookups/)
    expect(lower).toMatch(/at most (two|2) web searches/)
    expect(lower).toMatch(/same turn|one turn/)
  })

  it('keeps a person, an amount and any tool text out of the web query (#387)', () => {
    const web = prompt.slice(prompt.toLowerCase().indexOf('web search'))
    expect(web.toLowerCase()).toMatch(/never .*(name|phone|address)/)
    expect(lower).toContain('gov.il')
  })

  it('asks the model to say when an answer came from its general knowledge (#387)', () => {
    expect(lower).toMatch(/comes from your general knowledge[\s\S]{0,120}say so/)
  })

  it('allows only the formatting the chat surface can draw (#387)', () => {
    expect(lower).toMatch(/no tables?/)
    expect(lower).toMatch(/do not write (out )?(urls|links)|no markdown links/)
  })

  it('forbids invented facts and asks for an honest not-found instead of a guess', () => {
    expect(lower).toContain('never')
    expect(lower).toContain('invent')
    expect(lower).toContain('do not guess')
  })

  it('asks for both sides of a conflict rather than a silent pick', () => {
    expect(lower).toContain('disagree')
    expect(lower).toContain('both')
  })

  it('keeps the assistant to work, with a friendly no for the rest', () => {
    expect(lower).toContain('work')
    expect(lower).toContain('outside')
  })

  it('forbids narrating searches it did not run', () => {
    expect(lower).toContain('claim')
  })

  it('declares fenced tool results data, never instructions, under the per-call fence id', () => {
    expect(prompt).toContain('[TOOL-RESULT feedface')
    expect(prompt).toContain('[END-TOOL-RESULT feedface]')
    expect(lower).toContain('never instructions')
    expect(lower).toContain('do not follow')
  })

  it('keeps the document citation trailer so cited titles resolve to real ingested docs', () => {
    expect(prompt).toContain(SOURCES_PREFIX)
  })

  it('answers in the language of the question', () => {
    expect(lower).toContain('language')
  })

  it('handles a branch-less person without inventing a branch', () => {
    const hq = buildAssistantSystemPrompt({ ...META, locationName: null, locationKind: null }, 'f')
    expect(hq).not.toContain('תלפיות')
    expect(hq).toContain('Dana')
  })

  // The head office is a location row since 2026-09-21 (ADR-0029), so an office person now
  // holds one: the prompt must place them at the head office, not "at the מטה החברה branch".
  it('places a head-office person at the head office, never at a branch', () => {
    const office = buildAssistantSystemPrompt(
      { ...META, role: 'finance_manager', locationName: 'מטה החברה', locationKind: 'headquarters' },
      'f',
    )
    expect(office).toContain('מטה החברה')
    expect(office).toMatch(/head office[^\n]*מטה החברה/i)
    expect(office).not.toMatch(/מטה החברה branch/)
  })

  it('tells the model the head office is never one of the branches, whoever is asking', () => {
    expect(prompt).toMatch(/head office[^\n]*(never|not)[^\n]*branch/i)
  })
})

describe('buildToolLoopMessages (#381)', () => {
  it('leads with the system prompt, replays history, and ends with the question', () => {
    const history: MessageRow[] = [message('user', 'first', 1), message('agent', 'reply', 2)]
    const messages = buildToolLoopMessages(history, 'the question', META, 'f')
    expect(messages[0]?.role).toBe('system')
    expect(messages.slice(1, -1).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'the question' })
  })

  it('replays at most REPLAYED_TURNS prior turns', () => {
    const history: MessageRow[] = Array.from({ length: REPLAYED_TURNS + 4 }, (_, i) =>
      message(i % 2 === 0 ? 'user' : 'agent', `turn ${i}`, i),
    )
    const messages = buildToolLoopMessages(history, 'newest', META, 'f')
    expect(messages).toHaveLength(REPLAYED_TURNS + 2)
  })
})

describe('collectSources (#381)', () => {
  it('lists cited documents first, then app sources from the trace, then web citations', () => {
    const sources = collectSources({
      documents: [{ id: 'doc-1', title: 'Closing the grill', type: 'document' }],
      trace: [
        {
          tool: 'my_tasks',
          status: 'ok',
          args: {},
          sources: [{ id: 'app:tasks', title: 'My tasks', type: 'app' }],
        },
        {
          tool: 'search_documents',
          status: 'ok',
          args: { query: 'x' },
          sources: [{ id: 'doc-1', title: 'Closing the grill', type: 'document' }],
        },
      ],
      citations: [{ url: 'https://www.gov.il/vat', title: 'VAT' }],
    })
    expect(sources).toEqual([
      { id: 'doc-1', title: 'Closing the grill', type: 'document' },
      { id: 'app:tasks', title: 'My tasks', type: 'app' },
      { id: 'https://www.gov.il/vat', title: 'VAT', type: 'web', url: 'https://www.gov.il/vat' },
    ])
  })

  it('never lists a retrieved document the answer did not cite', () => {
    // The search surfaced two docs; the model cited one. Only the cited one becomes a chip — the
    // other was consulted, not used, and a chip would overstate it.
    const sources = collectSources({
      documents: [{ id: 'doc-1', title: 'A', type: 'document' }],
      trace: [
        {
          tool: 'search_documents',
          status: 'ok',
          args: {},
          sources: [
            { id: 'doc-1', title: 'A', type: 'document' },
            { id: 'doc-2', title: 'B', type: 'document' },
          ],
        },
      ],
      citations: [],
    })
    expect(sources.map((s) => s.id)).toEqual(['doc-1'])
  })

  it('de-duplicates app sources and web citations by id', () => {
    const sources = collectSources({
      documents: [],
      trace: [
        {
          tool: 'a',
          status: 'ok',
          args: {},
          sources: [{ id: 'app:tasks', title: 'T', type: 'app' }],
        },
        {
          tool: 'b',
          status: 'ok',
          args: {},
          sources: [{ id: 'app:tasks', title: 'T', type: 'app' }],
        },
      ],
      citations: [
        { url: 'https://x.example/a', title: 'A' },
        { url: 'https://x.example/a', title: 'A again' },
      ],
    })
    expect(sources).toHaveLength(2)
  })

  it('yields nothing for a greeting or a general-knowledge answer', () => {
    expect(collectSources({ documents: [], trace: [], citations: [] })).toEqual([])
  })
})

describe('formatTodayInJerusalem (#381)', () => {
  it('reports the calendar day in Israel, not UTC', () => {
    // 21:30 UTC on Tuesday 15 September is already 00:30 on Wednesday 16 September in Jerusalem
    // (UTC+3 in summer). The old UTC formatting put the assistant a day behind every evening.
    expect(formatTodayInJerusalem(new Date('2026-09-15T21:30:00.000Z'))).toBe(
      'Wednesday, 2026-09-16',
    )
    expect(formatTodayInJerusalem(new Date('2026-01-01T12:00:00.000Z'))).toBe(
      'Thursday, 2026-01-01',
    )
  })
})

// The public website as a source (2026-09-17). The owner asked the live assistant for a branch's
// hours and it answered "according to tabitisrael.co.il" under a general-knowledge chip: no search
// had run, no site had been opened, and the hours it gave were right for four days and wrong for
// Thursday, Friday and Saturday night. The website tool holds the real answer, but only a prompt
// that names it will send the model there instead of to its memory.
describe('the company website in the prompt', () => {
  const systemWith = (toolNames: string[]): string =>
    buildToolLoopMessages([], 'q', { ...META, toolNames }, 'f')[0]?.content ?? ''

  it('sends a branch-hours question to the website tool and forbids answering from memory', () => {
    const prompt = systemWith(['search_documents', 'company_website'])
    expect(prompt).toContain('company_website')
    expect(prompt).toMatch(/opening hours/i)
    expect(prompt).toMatch(/never state .* from memory/i)
  })

  it('says nothing about the website when the tool is not offered', () => {
    expect(systemWith(['search_documents'])).not.toContain('company_website')
  })
})
