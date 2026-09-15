import type { Clock } from '../auth/clock.js'
import type { Principal } from '../auth/principal.js'
import type { AnswerLog, AnswerLogEntry } from './answer-log.js'
import {
  ANSWER_MAX_TOKENS,
  buildToolLoopMessages,
  collectSources,
  extractSources,
  formatTodayInJerusalem,
  mintFence,
} from './grounding.js'
import type { LlmClient } from './llm-client.js'
import type { ThreadRepository, ThreadWithMessages } from './thread-repository.js'
import { runToolLoop } from './tool-loop.js'
import { type AssistantToolPorts, createAssistantTools } from './tools.js'

export type { TaskContextReader } from './tools.js'

// The answer path (ADR-0003, ADR-0013, ADR-0028): the one synchronous exchange that turns a staff
// member's question into an answer in the same response. It resolves the thread within the
// owner's scope, builds the read-only tools for exactly this principal, opens the bounded tool
// loop with the persona-and-policy prompt and the recent history, and — only on success —
// persists the question and answer together as one exchange, with the sources built from what
// actually ran. A model failure at any round persists nothing and surfaces as a retryable outcome
// (an inline retry, never an error row, ADR-0003).
//
// Until #381 this path retrieved the grounding itself and pasted it into the prompt; now the model
// asks for it (search_documents), and the same retrieval runs inside that tool over the same scoped
// reads. What the model may reach is still decided by the reads, never by the prompt.

// The outcome the route maps to HTTP. `not_found` is another user's thread or an unknown id — the
// same non-enumerating 404 the open endpoint returns (ADR-0007). `unavailable` is a model failure
// the client retries in place, with nothing persisted (ADR-0003).
export type AnswerOutcome =
  | { status: 'ok'; detail: ThreadWithMessages }
  | { status: 'not_found' }
  | { status: 'unavailable' }

export interface AnswerService {
  // Answer a question posted to one of the owner's threads. The principal is the caller resolved
  // from the session (never a body field): its userId scopes the thread, and the whole principal
  // scopes every tool the model may call. threadId is the thread the question continues; content
  // is the question text.
  answer(principal: Principal, threadId: string, content: string): Promise<AnswerOutcome>
}

export interface AnswerServiceDeps {
  threads: ThreadRepository
  // The scoped reads the tools wrap (tools.ts): the knowledge index and its embeddings, the
  // ADR-0007-scoped board read, and the page reads for branches, projects and people, each the
  // one the page itself goes through. The clock is added here so the ports and the log share it.
  ports: Omit<AssistantToolPorts, 'clock'>
  llm: LlmClient
  // The per-answer log write (0038). Best-effort: a failed insert is reported and swallowed —
  // telemetry must never take an answer down with it.
  log: AnswerLog
  clock: Clock
}

export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  const { threads, ports, llm, log, clock } = deps
  // The log write must never decide an answer's fate: report the class and move on (ADR-0011
  // keeps content out of the entry by construction, so there is nothing sensitive to leak here).
  const recordSafely = async (entry: AnswerLogEntry): Promise<void> => {
    try {
      await log.record(entry)
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown error'
      console.error(`assistant answer-log: write failed: ${reason}`)
    }
  }
  return {
    answer: async (principal, threadId, content) => {
      const startedAt = clock.now()
      // Resolve the thread scoped to the owner: an unknown id or another user's thread resolves
      // nothing and is the same non-enumerating not-found the open endpoint returns (ADR-0007). The
      // resolved history is also what is replayed to the model for context (story 7).
      const existing = await threads.getThread(principal.userId, threadId)
      if (!existing) {
        return { status: 'not_found' }
      }

      // The tools for this principal (tools.ts): each wraps a read already scoped to what this
      // person may see, so nothing the model can ask for reaches past their own pages (ADR-0007).
      const priorUserTurns = existing.messages
        .filter((turn) => turn.role === 'user')
        .map((turn) => turn.content)
      const tools = createAssistantTools({ principal, priorUserTurns, ports: { ...ports, clock } })
      const fence = mintFence()
      const messages = buildToolLoopMessages(
        existing.messages,
        content,
        {
          today: formatTodayInJerusalem(clock.now()),
          role: principal.role,
          displayName: principal.displayName,
          locationName: principal.locationName ?? null,
          toolNames: tools.tools.map((tool) => tool.definition.name),
        },
        fence,
      )

      // The bounded loop (tool-loop.ts): the model asks for what it needs, round by round, and
      // answers. A failure at any round folds to the retryable outcome a single-call failure
      // always did (ADR-0003); nothing is persisted, so the client re-sends the question with no
      // orphaned user turn and no error row.
      const llmStartedAt = clock.now()
      const outcome = await runToolLoop({
        llm,
        clock,
        fence,
        messages,
        tools: tools.tools,
        maxTokens: ANSWER_MAX_TOKENS,
      })
      const llmMs = clock.now().getTime() - llmStartedAt.getTime()

      // The shared half of both outcomes' log rows: what the tools did. The retrieval health
      // fields describe every document search the answer ran; an answer that searched nothing
      // reports mode 'none' rather than a mode it never used.
      const retrievals = tools.retrievals()
      const logBase = {
        userId: principal.userId,
        role: principal.role,
        threadId,
        mode:
          retrievals.length === 0
            ? ('none' as const)
            : retrievals.some((retrieval) => retrieval.mode === 'hybrid')
              ? ('hybrid' as const)
              : ('keyword' as const),
        vectorArmEmpty:
          retrievals.length > 0 && retrievals.every((retrieval) => retrieval.vectorArmEmpty),
        unembeddedChunks: Math.max(0, ...retrievals.map((retrieval) => retrieval.unembeddedChunks)),
        retrieved: retrievals.flatMap((retrieval) =>
          retrieval.selected.map(({ chunkId, docId, score, vectorScore, keywordRank }) => ({
            chunkId,
            docId,
            score,
            vectorScore,
            keywordRank,
          })),
        ),
        tools: outcome.trace.map(({ tool, status }) => ({ tool, status })),
      }
      if (!outcome.ok) {
        // The one line that says why an answer failed. The client already builds this string as
        // the error CLASS only, never the prompt or the response body (ADR-0011).
        console.error(`assistant answer: ${outcome.error}`)
        const failedAt = clock.now()
        await recordSafely({
          ...logBase,
          status: 'unavailable',
          errorClass: outcome.error,
          agentMessageId: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          latencyMs: failedAt.getTime() - startedAt.getTime(),
          llmMs,
          sources: [],
          now: failedAt,
        })
        return { status: 'unavailable' }
      }

      // Provenance from what ran, never from the model's narration (#381): the cited documents are
      // resolved against the docs the search tool actually returned (an invented title resolves to
      // nothing), the app sources come from the trace, the web pages from the broker's citations.
      // The trailer is stripped here, before the answer is persisted or shown.
      const { content: answerText, sources: documents } = extractSources(
        outcome.content,
        tools.retrievedDocs(),
      )
      const sources = collectSources({
        documents: documents.map((document) => ({ ...document, type: 'document' as const })),
        trace: outcome.trace,
        citations: outcome.citations,
      })

      // Success: persist the question and its answer together as one exchange, bumping the thread's
      // recency, and return the thread with its full, updated history for the response.
      const detail = await threads.appendAnswer({
        threadId,
        userContent: content,
        agentContent: answerText,
        agentSources: sources,
        now: clock.now(),
      })
      const finishedAt = clock.now()
      await recordSafely({
        ...logBase,
        status: 'answered',
        errorClass: null,
        // The agent turn appendAnswer just persisted is the thread's newest message.
        agentMessageId: detail.messages.at(-1)?.id ?? null,
        model: outcome.model ?? null,
        inputTokens: outcome.usage?.inputTokens ?? null,
        outputTokens: outcome.usage?.outputTokens ?? null,
        latencyMs: finishedAt.getTime() - startedAt.getTime(),
        llmMs,
        sources,
        now: finishedAt,
      })
      return { status: 'ok', detail }
    },
  }
}
