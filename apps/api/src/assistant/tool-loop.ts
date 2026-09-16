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
    }
  | { ok: false; error: string; trace: ToolTraceEntry[] }

// Four rounds is room for a lookup, a follow-up lookup, and a correction; the fifth call, tools
// withheld, is the answer. Most questions take one or two.
export const MAX_TOOL_ROUNDS = 4

// One wall-clock budget across all rounds rather than a per-call timeout: the user is waiting on
// the whole answer, and a fourth round that would push past it is not started at all.
export const TOOL_LOOP_DEADLINE_MS = 40_000

// Two web searches per answer (#385, the owner's cap): one for the fact, one to try other words.
// Each is a paid Google search on top of the model call, and a question that two searches did not
// settle is answered as "not found on the web", not searched a third time.
export const MAX_WEB_SEARCHES = 2

// Fence a tool result between the markers the prompt declared: the tool's name and status ride on
// the opening marker so the model can tell a clean miss from a fault without trusting the text.
const fenceResult = (fence: string, name: string, outcome: ToolOutcome): string =>
  [
    `[TOOL-RESULT ${fence} ${name} status=${outcome.status}]`,
    outcome.content,
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
  // rides only when a search is known to have run, so "absent" keeps meaning "unknown".
  const totals = { inputTokens: 0, outputTokens: 0, webSearches: 0 }
  let usageReported = false
  let searchesReported = false
  // Set once a tool has handed back people or their words: the broker's search is not offered
  // again for this answer.
  let personalDataSeen = false
  let rounds = 0
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
    const result = await input.llm.complete({
      messages,
      maxTokens: input.maxTokens,
      ...(toolsOffered ? { tools: definitions } : {}),
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    })
    if (!result.ok) {
      return { ok: false, error: result.error, trace }
    }
    if (result.usage) {
      usageReported = true
      totals.inputTokens += result.usage.inputTokens
      totals.outputTokens += result.usage.outputTokens
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
      const usage: LlmUsage | null = usageReported
        ? {
            inputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens,
            ...(searchesReported ? { webSearches: totals.webSearches } : {}),
          }
        : null
      return {
        ok: true,
        content: result.content,
        trace,
        rounds,
        capped: !toolsOffered && anyTools,
        usage,
        citations: [...citations.values()],
        ...(result.model === undefined ? {} : { model: result.model }),
      }
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
    const ran = await Promise.all(calls.map((call) => runCall(input.tools, call)))
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
