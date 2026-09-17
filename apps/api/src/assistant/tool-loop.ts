import type { MessageSource } from '@burgers/shared'
import type { Clock } from '../auth/clock.js'
import type {
  LlmCitation,
  LlmClient,
  LlmMessage,
  LlmTool,
  LlmToolCall,
  LlmUsage,
} from './llm-client.js'

// The bounded tool loop (#381): the model is offered a set of read-only tools and decides, round
// by round, whether it needs one before it can answer. The loop runs what it asks for, hands each
// result back as a fenced `tool` turn, and calls again — until the model answers in text, or the
// round cap or the wall-clock budget is reached, at which point the tools are withheld and the
// model is asked to answer with what it has. Every call is recorded in a trace: that trace, not
// the model's narration, is what the answer path builds provenance and the status line from — a
// model can claim it "searched" without having done so (seen live in the 2026-09-15 spike), and
// only the server knows which tools actually ran.
//
// The loop never throws for a tool's sake: an unknown tool, malformed arguments, or a tool that
// throws all become a `failed` result the model is told about by class, so it can say what it could
// not reach rather than pretend. A model failure at any round folds to the same retryable outcome a
// single-call failure always did (ADR-0003), carrying the trace so far for the log.

// How a tool call ended, as the model and the trace both see it. `empty` is a clean miss (the
// lookup ran and found nothing), `out_of_scope` a refusal (the asker may not see what they asked
// about — the tool answers so, never with narrowed rows), `failed` a fault (a throw, bad arguments,
// an unknown name).
export type ToolStatus = 'ok' | 'empty' | 'failed' | 'out_of_scope'

// What one tool run yields: its status, the text the model reads, and the sources the answer path
// may attach to the reply for this call — the documents a search surfaced, the app data a query
// read — already shaped as chips.
export interface ToolOutcome {
  status: ToolStatus
  content: string
  sources: MessageSource[]
}

// A tool the loop can run: its wire definition (the function schema the model sees), the label
// the status line shows while it runs, and the run itself, which receives the parsed arguments.
export interface AssistantTool {
  definition: Extract<LlmTool, { kind: 'function' }>
  label: { en: string; he: string }
  // True for a tool whose results carry people or their words (the people directory, the WhatsApp
  // summaries). Once one of those has handed rows back, the broker's web search is withheld for
  // the rest of the answer (#387): the privacy page promises the search engine never receives
  // company data, and a line in the prompt alone cannot keep that promise.
  personalData?: boolean
  run(args: unknown): Promise<ToolOutcome>
}

// One trace entry per call, in call order: which tool, how it ended, the arguments the model
// passed, and the sources the run yielded. The arguments are model-written text about the question
// (a search query, a branch name) and stay in memory for the response; the answer log keeps only
// the tool name and status (ADR-0011).
export interface ToolTraceEntry {
  tool: string
  status: ToolStatus
  args: unknown
  sources: MessageSource[]
}

// A finished draft as the reviewer sees it (source-guard.ts): the text, everything the model was
// shown on the way to it, what the tools did, and the two facts about the web search that decide
// what the reviewer may ask for.
export interface DraftForReview {
  content: string
  // The conversation as the model saw it, minus any earlier rejected draft and the instruction
  // that rejected it. Those two are the loop's own bookkeeping: counted as material, the site an
  // instruction quotes would "back" the very claim it was written to reject.
  messages: LlmMessage[]
  trace: ToolTraceEntry[]
  // A cited page or a billed search, in any round so far.
  webSearched: boolean
  // Whether another round could still run the broker's search.
  canSearch: boolean
}

// Returns the instruction to send the draft back with, or null to accept it.
export type DraftReview = (draft: DraftForReview) => string | null

export interface ToolLoopInput {
  llm: LlmClient
  clock: Clock
  // The per-call fence id the system prompt named, so tool results are quoted between the same
  // markers the prompt declares to be data, never instructions.
  fence: string
  messages: LlmMessage[]
  tools: AssistantTool[]
  // Broker-run tools (OpenRouter's web search) offered beside ours; their work never comes back
  // as a call, only as citations on the completion.
  serverTools?: LlmTool[]
  maxTokens: number
  maxRounds?: number
  deadlineMs?: number
  // The most web searches one answer may run across its rounds (#385); once that many have run,
  // the server tools are withheld and only ours stay on offer.
  maxWebSearches?: number
  temperature?: number
  // How long to wait before the one retry a retryable failure earns. Overridable so a test does
  // not sit through it.
  retryDelayMs?: number
  // How long one tool may take before the loop stops waiting and reports it failed. A tool that
  // never returns used to hold the whole answer open until the client gave up (LOOP-3).
  toolTimeoutMs?: number
  // Looks at each finished draft before it is returned. One objection per answer is acted on:
  // the draft goes back to the model with the reviewer's instruction, under the same budget,
  // caps and trace as every other round.
  review?: DraftReview
}

export type ToolLoopOutcome =
  | {
      ok: true
      content: string
      trace: ToolTraceEntry[]
      // How many model calls the answer took (1 = it answered straight away).
      rounds: number
      // True when the tools were withheld on the final call because the round cap or the
      // wall-clock budget was reached: the answer is the model's best effort, not a finished search.
      capped: boolean
      usage: LlmUsage | null
      citations: LlmCitation[]
      model?: string
      // Absent when the reviewer had nothing to say (or there was none). 'repaired': a draft was
      // sent back and the one returned here passed. 'unrepaired': the draft returned here is one
      // the reviewer still objects to, because the second pass was no better, failed, or could
      // not be paid for out of the time left. The caller decides what the reader is told.
      review?: 'repaired' | 'unrepaired'
    }
  | { ok: false; error: string; trace: ToolTraceEntry[] }

// Four rounds is room for a lookup, a follow-up lookup, and a correction; the fifth call, tools
// withheld, is the answer. Most questions take one or two. A draft the reviewer sends back adds
// one more call on top of whatever round it came at, so the ceiling is six calls, before the one
// retry and the one tools-withheld re-ask.
export const MAX_TOOL_ROUNDS = 4

// One wall-clock budget across all rounds rather than a per-call timeout: the user is waiting on
// the whole answer, and a fourth round that would push past it is not started at all.
export const TOOL_LOOP_DEADLINE_MS = 40_000

// Two web searches per answer (#385, the owner's cap): one for the fact, one to try other words.
// Each is a paid Google search on top of the model call, and a question that two searches did not
// settle is answered as "not found on the web", not searched a third time.
export const MAX_WEB_SEARCHES = 2

// One retry per answer, not per round. A provider having a bad second is worth a second try; a
// provider that is down is worth stopping for, and retrying every round turns one outage into
// four times the bill (LOOP-4).
const MAX_RETRIES = 1
const RETRY_DELAY_MS = 1_500

// A tool has this long before the loop stops waiting on it. Well inside the whole-answer budget,
// so a stuck read costs one lookup rather than the answer.
const TOOL_TIMEOUT_MS = 15_000

// The most calls one round may actually run. A model that asks for twenty lookups at once is not
// working, and each one is a paid round trip. The rest are answered with a note rather than
// dropped, because a provider rejects a tool call left unanswered (LOOP-5).
const MAX_CALLS_PER_ROUND = 8

// A body may not write the markers that delimit it. The fence id is random per call and so cannot
// be guessed, but a Drive document or a WhatsApp message carrying a plausible-looking
// `[END-TOOL-RESULT ...]` still puts a second closing marker in front of the model, and whatever
// follows it reads as though the quoted data had ended. Every look-alike is bent to a round
// bracket on the way in, so exactly one opening and one closing marker can ever appear (LOOP-8).
const neutraliseMarkers = (content: string): string =>
  content.replace(/\[(?=(END-)?TOOL-RESULT)/g, '(')

// Fence a tool result between the markers the prompt declared: the tool's name and status ride on
// the opening marker so the model can tell a clean miss from a fault without trusting the text.
const fenceResult = (fence: string, name: string, outcome: ToolOutcome): string =>
  [
    `[TOOL-RESULT ${fence} ${name} status=${outcome.status}]`,
    neutraliseMarkers(outcome.content),
    `[END-TOOL-RESULT ${fence}]`,
  ].join('\n')

// Run one call: resolve the tool, parse the arguments, run it, and fold every fault to a `failed`
// outcome the model reads by class only — a driver's message never becomes prompt material.
const runCall = async (
  tools: AssistantTool[],
  call: LlmToolCall,
): Promise<{ args: unknown; outcome: ToolOutcome }> => {
  const tool = tools.find((candidate) => candidate.definition.name === call.name)
  if (!tool) {
    return { args: null, outcome: { status: 'failed', content: 'unknown tool', sources: [] } }
  }
  let args: unknown
  try {
    args = call.arguments.trim().length === 0 ? {} : JSON.parse(call.arguments)
  } catch {
    return {
      args: null,
      outcome: { status: 'failed', content: 'arguments were not valid JSON', sources: [] },
    }
  }
  try {
    return { args, outcome: await tool.run(args) }
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown error'
    return { args, outcome: { status: 'failed', content: `error: ${reason}`, sources: [] } }
  }
}

// The identity of a lookup, for spotting a repeat. Keys are sorted so the same request written
// with its arguments in a different order is still the same request.
const callKey = (name: string, rawArgs: string): string => {
  try {
    const parsed = JSON.parse(rawArgs) as Record<string, unknown>
    if (parsed === null || typeof parsed !== 'object') return `${name}:${rawArgs.trim()}`
    const sorted = Object.keys(parsed)
      .sort()
      .map((key) => `${key}=${JSON.stringify(parsed[key])}`)
      .join('&')
    return `${name}:${sorted}`
  } catch {
    return `${name}:${rawArgs.trim()}`
  }
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))

// Stop waiting on a tool that will not return. The tool keeps running in the background - there is
// no way to cancel an arbitrary read - but the answer stops depending on it, and the model is told
// the lookup failed rather than being left to wait with the reader.
type RanCall = { args: unknown; outcome: ToolOutcome }

const withTimeout = (run: Promise<RanCall>, ms: number): Promise<RanCall> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<RanCall>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          args: undefined,
          outcome: { status: 'failed', content: 'the lookup timed out', sources: [] },
        }),
      ms,
    )
  })
  return Promise.race([run, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export async function runToolLoop(input: ToolLoopInput): Promise<ToolLoopOutcome> {
  const maxRounds = input.maxRounds ?? MAX_TOOL_ROUNDS
  const deadlineMs = input.deadlineMs ?? TOOL_LOOP_DEADLINE_MS
  const maxWebSearches = input.maxWebSearches ?? MAX_WEB_SEARCHES
  const functionTools: LlmTool[] = input.tools.map((tool) => tool.definition)
  const serverTools: LlmTool[] = input.serverTools ?? []
  const anyTools = functionTools.length + serverTools.length > 0
  const startedAt = input.clock.now().getTime()
  const messages: LlmMessage[] = [...input.messages]
  const trace: ToolTraceEntry[] = []
  // Every page the broker cited, in the order first seen, de-duplicated by url. Keeping only the
  // final round's annotations lost a page found while the model was still calling our tools: the
  // fact reached the reader with no chip, and the paid search was logged as having found nothing.
  const citations = new Map<string, LlmCitation>()
  // Summed across rounds; reported as null when no round carried a usage block. The search count
  // rides only when a search is known to have run, so "absent" keeps meaning "unknown". The same
  // rule holds for the cost, the cached tokens and the reasoning tokens (0048): the client reads
  // them off every completion and the answer path writes them to the log, but until 2026-09-17
  // this loop summed only the two token counts and dropped the rest, so the three columns were
  // NULL on every production row since they shipped.
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    webSearches: 0,
    costUsd: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
  }
  let usageReported = false
  let searchesReported = false
  const reported = { costUsd: false, cachedTokens: false, reasoningTokens: false }
  // Set once a tool has handed back people or their words: the broker's search is not offered
  // again for this answer.
  let personalDataSeen = false
  let rounds = 0
  // One retry and one tools-withheld re-ask, for the whole answer rather than for each round.
  let retriesLeft = MAX_RETRIES
  let truncationRetried = false
  // Every lookup already run this answer, so the same one is never bought twice.
  const alreadyRun = new Set<string>()
  const retryDelayMs = input.retryDelayMs ?? RETRY_DELAY_MS
  const toolTimeoutMs = input.toolTimeoutMs ?? TOOL_TIMEOUT_MS
  // The reviewer is a check on the answer, never a way to lose it: a fault in it accepts the
  // draft, and is reported by class only.
  const reviewSafely = (draft: DraftForReview): string | null => {
    if (input.review === undefined) return null
    try {
      return input.review(draft)
    } catch (error) {
      console.error(`tool loop: review failed: ${error instanceof Error ? error.name : 'unknown'}`)
      return null
    }
  }
  // The draft the reviewer sent back, kept because a second pass that fails must not cost the
  // reader the answer they already had; and the two turns that pass added, which the reviewer is
  // never shown.
  // A draft carries the trace and the citations as they stood when it was written. The chips
  // under an answer are built from those, and a first draft handed back after a failed second
  // pass must not sit under pages the second pass found and the first never used.
  interface Draft {
    content: string
    capped: boolean
    trace: ToolTraceEntry[]
    citations: LlmCitation[]
    model?: string
  }
  let rejected: Draft | null = null
  const reviewTurns = new Set<LlmMessage>()
  const finish = (
    draft: Draft,
    review: 'repaired' | 'unrepaired' | undefined,
  ): ToolLoopOutcome => ({
    ok: true,
    content: draft.content,
    trace: draft.trace,
    rounds,
    capped: draft.capped,
    usage: usageReported
      ? {
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          ...(searchesReported ? { webSearches: totals.webSearches } : {}),
          ...(reported.costUsd ? { costUsd: totals.costUsd } : {}),
          ...(reported.cachedTokens ? { cachedTokens: totals.cachedTokens } : {}),
          ...(reported.reasoningTokens ? { reasoningTokens: totals.reasoningTokens } : {}),
        }
      : null,
    citations: draft.citations,
    ...(draft.model === undefined ? {} : { model: draft.model }),
    ...(review === undefined ? {} : { review }),
  })
  while (true) {
    rounds += 1
    // A tool round is offered only while it can also finish: past the round cap, or once another
    // round of the size seen so far would breach the budget, the tools are withheld and the model
    // answers with what it has — a bounded answer beats a timeout the user retries. The broker's
    // search is withheld on its own once the searches it reported reach the cap.
    const elapsed = input.clock.now().getTime() - startedAt
    const perRound = rounds > 1 ? elapsed / (rounds - 1) : 0
    // The broker's search rides only while budget is left and nothing personal has been read. Its
    // own per-request cap is rewritten each round to the remainder, so a provider that honours
    // max_uses cannot spend more than the whole answer's budget in one round.
    const searchesLeft = maxWebSearches - totals.webSearches
    const offerServerTools = searchesLeft > 0 && !personalDataSeen
    const definitions: LlmTool[] = [
      ...functionTools,
      ...(offerServerTools
        ? serverTools.map((tool) =>
            tool.kind === 'server'
              ? { ...tool, parameters: { ...(tool.parameters ?? {}), max_uses: searchesLeft } }
              : tool,
          )
        : []),
    ]
    const toolsOffered =
      definitions.length > 0 && rounds <= maxRounds && elapsed + perRound < deadlineMs
    // What is left of the whole-answer budget bounds this one call, so a round can never outlive
    // the budget it is spending (LOOP-3). A second is kept as a floor: a call with no time at all
    // would abort before it was even sent.
    const callTimeoutMs = Math.max(1_000, deadlineMs - elapsed)
    const ask = (withTools: boolean) =>
      input.llm.complete({
        messages,
        maxTokens: input.maxTokens,
        timeoutMs: callTimeoutMs,
        ...(withTools && toolsOffered ? { tools: definitions } : {}),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      })
    let result = await ask(true)
    // A rate limit or a provider-side fault is worth exactly one more try, and only while the
    // budget can still pay for it.
    if (!result.ok && result.retryable === true && retriesLeft > 0) {
      const spent = input.clock.now().getTime() - startedAt
      if (spent + retryDelayMs < deadlineMs) {
        retriesLeft -= 1
        await sleep(retryDelayMs)
        result = await ask(true)
      }
    }
    // A truncated answer re-sent unchanged truncates again. Asking once more with the tools
    // withheld spends the budget on the answer rather than on another lookup.
    if (!result.ok && result.truncated === true && toolsOffered && !truncationRetried) {
      truncationRetried = true
      result = await ask(false)
    }
    if (!result.ok) {
      // A flawed answer the reader is warned about beats a retry screen: the first draft was a
      // whole answer, and only its attribution was in doubt.
      if (rejected !== null) return finish(rejected, 'unrepaired')
      return { ok: false, error: result.error, trace }
    }
    if (result.usage) {
      usageReported = true
      totals.inputTokens += result.usage.inputTokens
      totals.outputTokens += result.usage.outputTokens
      if (result.usage.costUsd !== undefined) {
        reported.costUsd = true
        totals.costUsd += result.usage.costUsd
      }
      if (result.usage.cachedTokens !== undefined) {
        reported.cachedTokens = true
        totals.cachedTokens += result.usage.cachedTokens
      }
      if (result.usage.reasoningTokens !== undefined) {
        reported.reasoningTokens = true
        totals.reasoningTokens += result.usage.reasoningTokens
      }
    }
    const roundCitations = result.citations ?? []
    for (const citation of roundCitations) {
      if (!citations.has(citation.url)) {
        citations.set(citation.url, citation)
      }
    }
    // What the broker says it spent, or, when it says nothing (Google's native engine returned no
    // server_tool_use block at all in the 2026-09-15 spike, which left the cap unenforceable), the
    // one thing the server can still see: a round that came back with citations is a round that
    // searched.
    if (result.usage?.webSearches !== undefined) {
      searchesReported = true
      totals.webSearches += result.usage.webSearches
    } else if (roundCitations.length > 0) {
      searchesReported = true
      totals.webSearches += 1
    }
    const calls = result.toolCalls ?? []
    if (calls.length === 0 || !toolsOffered) {
      const draft: Draft = {
        content: result.content,
        // A rewrite after a rejection may run past the round cap with the tools withheld; that
        // does not make the answer partial, because the draft that gathered the material had
        // its tools. Capped describes the gathering, so it is the first draft's.
        capped: rejected === null ? !toolsOffered && anyTools : rejected.capped,
        trace: [...trace],
        citations: [...citations.values()],
        ...(result.model === undefined ? {} : { model: result.model }),
      }
      const instruction = reviewSafely({
        content: result.content,
        messages: messages.filter((message) => !reviewTurns.has(message)),
        trace,
        webSearched: totals.webSearches > 0 || citations.size > 0,
        canSearch:
          serverTools.length > 0 &&
          maxWebSearches - totals.webSearches > 0 &&
          !personalDataSeen &&
          rounds < maxRounds,
      })
      if (instruction === null) return finish(draft, rejected === null ? undefined : 'repaired')
      // One objection per answer is acted on, and only while another round like the ones so far
      // still fits the budget. Past either limit the draft is returned as it stands and marked,
      // so the caller can tell the reader rather than hold them for a third attempt.
      const spent = input.clock.now().getTime() - startedAt
      if (rejected !== null || spent + spent / rounds >= deadlineMs) {
        return finish(draft, 'unrepaired')
      }
      rejected = draft
      const draftTurn: LlmMessage = {
        role: 'assistant',
        content: result.content,
        ...(result.reasoningDetails === undefined
          ? {}
          : { reasoningDetails: result.reasoningDetails }),
      }
      // A user turn, because that is the one role every provider replays faithfully in the middle
      // of a conversation. The instruction says of itself that the person did not write it.
      const instructionTurn: LlmMessage = { role: 'user', content: instruction }
      reviewTurns.add(draftTurn)
      reviewTurns.add(instructionTurn)
      messages.push(draftTurn, instructionTurn)
      continue
    }
    // Replay the model's own turn — calls and opaque reasoning intact — then answer each call by
    // id, in the order it asked. The tools are read-only, so they run concurrently.
    messages.push({
      role: 'assistant',
      content: result.content,
      toolCalls: calls,
      ...(result.reasoningDetails === undefined
        ? {}
        : { reasoningDetails: result.reasoningDetails }),
    })
    // Every call is answered - a provider rejects a tool call left unanswered - but only the ones
    // worth running are run. A repeat of a lookup already made comes back as a steer, and anything
    // past the per-round cap is told so plainly rather than silently dropped.
    const ran = await Promise.all(
      calls.map(async (call, index) => {
        if (index >= MAX_CALLS_PER_ROUND) {
          return {
            args: undefined,
            outcome: {
              status: 'empty' as const,
              content: `not run: more than ${MAX_CALLS_PER_ROUND} lookups were asked for in one turn. Ask for fewer, in the order of what matters.`,
              sources: [],
            },
          }
        }
        const key = callKey(call.name, call.arguments)
        if (alreadyRun.has(key)) {
          return {
            args: undefined,
            outcome: {
              status: 'empty' as const,
              content:
                'not run: this exact lookup already ran for this question and its result is above. Try different arguments, a different tool, or answer with what you have.',
              sources: [],
            },
          }
        }
        alreadyRun.add(key)
        return withTimeout(runCall(input.tools, call), toolTimeoutMs)
      }),
    )
    calls.forEach((call, index) => {
      const { args, outcome } = ran[index] as { args: unknown; outcome: ToolOutcome }
      const tool = input.tools.find((candidate) => candidate.definition.name === call.name)
      if (tool?.personalData && outcome.status === 'ok') {
        personalDataSeen = true
      }
      trace.push({ tool: call.name, status: outcome.status, args, sources: outcome.sources })
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: fenceResult(input.fence, call.name, outcome),
      })
    })
  }
}
