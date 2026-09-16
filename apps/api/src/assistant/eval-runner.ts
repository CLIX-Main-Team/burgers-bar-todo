import type { MessageSource, Role } from '@burgers/shared'
import type { Clock } from '../auth/clock.js'
import type { Principal } from '../auth/principal.js'
import {
  ANSWER_MAX_TOKENS,
  SOURCES_PREFIX,
  buildToolLoopMessages,
  extractSources,
  formatTodayInJerusalem,
  mintFence,
} from './grounding.js'
import type { LlmCitation, LlmClient, LlmTool, LlmUsage } from './llm-client.js'
import type { MessageRow } from './thread-repository.js'
import { type ToolTraceEntry, runToolLoop } from './tool-loop.js'
import { type AssistantToolPorts, createAssistantTools } from './tools.js'

// The evaluation's answer step (PR4, roadmap group b item 1).
//
// The harness used to build its own messages with buildLlmMessages, the one-shot "answer only from
// these excerpts" prompt the product retired on 2026-09-15 (#381). So every number it produced
// described a system nobody was running: the model it scored had no tools to choose between, no
// web search to reach for, no round budget to exhaust, and no trace to be graded on. Routing, tool
// choice, freshness and provenance were all unmeasured, which is finding EO-2 and the reason a
// stale VAT rate reached production with a green eval behind it.
//
// This module is the seam that fixes it: one function that answers a question exactly as the
// answer path answers it, and hands back everything the grading needs. The answer path itself is
// deliberately not reused wholesale — it persists threads and writes log rows, and an eval must
// never write to the database it is scoring (the same index has to be scoreable from two
// checkouts). What is shared is the part that decides quality: the prompt, the tools, the loop.

export interface EvalPrincipalSpec {
  role: Role
  locationId?: string | null
  locationName?: string | null
  displayName?: string
  preferredLanguage?: 'he' | 'en'
}

// The caller a graded item is asked as. Every tool the model may reach scopes itself from this, so
// an item's role is what makes a cross-role leakage test mean anything: the same question asked as
// two people has to come back differently, and until the eval could set a role it could not ask.
export function evalPrincipal(spec: EvalPrincipalSpec): Principal {
  return {
    userId: `eval-${spec.role}`,
    displayName: spec.displayName ?? 'Eval',
    role: spec.role,
    locationId: spec.locationId ?? null,
    locationName: spec.locationName ?? null,
    status: 'active',
    ...(spec.preferredLanguage ? { preferredLanguage: spec.preferredLanguage } : {}),
  }
}

export interface EvalAnswer {
  ok: boolean
  error: string | null
  // The answer as a reader sees it: the SOURCES trailer stripped, exactly as the answer path
  // strips it before persisting.
  text: string
  // The document chips the app would have shown, resolved against what the search tool actually
  // returned — an invented title resolves to nothing and is counted below instead.
  sources: MessageSource[]
  // Titles the answer cited that no retrieval returned. The count the product silently discards,
  // and the cheapest possible detector for a made-up citation.
  unresolvedCitations: number
  trace: ToolTraceEntry[]
  citations: LlmCitation[]
  rounds: number
  capped: boolean
  usage: LlmUsage | null
  model: string | null
  // The exact system prompt that produced this answer, so a run records which prompt it scored.
  systemPrompt: string
}

export interface AnswerThroughLoopInput {
  llm: LlmClient
  clock: Clock
  ports: AssistantToolPorts
  principal: Principal
  question: string
  // The thread's earlier user turns, so a follow-up anchors the way it does in the product.
  priorUserTurns: string[]
  // The turns replayed to the model, for a multi-turn item. Single-turn items pass none.
  history?: MessageRow[]
  webSearch: LlmTool | null
  knowledgeCutoff: string | null
}

// How many titles an answer's trailer claims. extractSources resolves them and throws the count
// away, which is right for the product (an unresolvable title simply becomes no chip) and wrong
// for an eval, where "cited three documents, two of which do not exist" is the finding.
function citedTitleCount(raw: string): number {
  const lines = raw.split('\n')
  let last = lines.length - 1
  while (last >= 0 && lines[last]?.trim() === '') last -= 1
  const trailer = last >= 0 ? (lines[last] as string).trim() : ''
  if (!trailer.toUpperCase().startsWith(SOURCES_PREFIX)) return 0
  return trailer
    .slice(SOURCES_PREFIX.length)
    .split('|')
    .map((title) => title.trim())
    .filter((title) => title.length > 0 && title.toLowerCase() !== 'none').length
}

export async function answerThroughLoop(input: AnswerThroughLoopInput): Promise<EvalAnswer> {
  const { llm, clock, ports, principal, question, priorUserTurns, webSearch, knowledgeCutoff } =
    input
  const tools = createAssistantTools({ principal, priorUserTurns, ports })
  const fence = mintFence()
  const messages = buildToolLoopMessages(
    input.history ?? [],
    question,
    {
      today: formatTodayInJerusalem(clock.now()),
      role: principal.role,
      displayName: principal.displayName,
      locationName: principal.locationName ?? null,
      toolNames: tools.tools.map((tool) => tool.definition.name),
      webSearch: webSearch !== null,
      knowledgeCutoff,
    },
    fence,
  )
  const systemPrompt = messages.find((message) => message.role === 'system')?.content ?? ''

  const outcome = await runToolLoop({
    llm,
    clock,
    fence,
    messages,
    tools: tools.tools,
    ...(webSearch === null ? {} : { serverTools: [webSearch] }),
    maxTokens: ANSWER_MAX_TOKENS,
  })

  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.error,
      text: '',
      sources: [],
      unresolvedCitations: 0,
      trace: outcome.trace,
      citations: [],
      rounds: 0,
      capped: false,
      usage: null,
      model: null,
      systemPrompt,
    }
  }

  const { content: text, sources } = extractSources(outcome.content, tools.retrievedDocs())
  return {
    ok: true,
    error: null,
    text,
    sources,
    unresolvedCitations: Math.max(0, citedTitleCount(outcome.content) - sources.length),
    trace: outcome.trace,
    citations: outcome.citations,
    rounds: outcome.rounds,
    capped: outcome.capped,
    usage: outcome.usage,
    model: outcome.model ?? null,
    systemPrompt,
  }
}
