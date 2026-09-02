import type { Clock } from '../auth/clock.js'
import { type Principal, viewScope } from '../auth/principal.js'
import type { AnswerLog, AnswerLogEntry } from './answer-log.js'
import type { EmbeddingClient } from './embedding-client.js'
import {
  ANSWER_MAX_TOKENS,
  type AssistantTaskView,
  buildLlmMessages,
  extractSources,
  renderTaskContext,
} from './grounding.js'
import type { LlmClient } from './llm-client.js'
import type { KnowledgeRepository } from './repository.js'
import { ARM_LIMIT, resolveQuery, retrieveGrounding } from './retrieval.js'
import type { ThreadRepository, ThreadWithMessages } from './thread-repository.js'

// The scoped task read the answer path grounds on (#92, ADR-0007). Deliberately the *same*
// principal-parametrized data-access method the board read uses (TaskBoardRepository.listScopedTasks
// satisfies this port structurally) — never a bespoke or unscoped query "to get context for the
// LLM", which is exactly the hole ADR-0007 forbids. Because retrieval is capped to the principal's
// own visibility, an Employee grounds on their own assigned tasks only, a Manager on their location's
// board, an Admin chain-wide; the Assistant can never surface a task the asking user could not see.
export interface TaskContextReader {
  listScopedTasks(principal: Principal): Promise<AssistantTaskView[]>
}

// The grounded answer path (Slice 2; ADR-0003, ADR-0004, ADR-0013): the one synchronous exchange
// that turns a staff member's question into a procedure-grounded answer in the same response. It
// resolves the thread within the owner's scope, assembles grounding from the knowledge cache,
// replays the recent history, makes the single direct LLM call through the injected port, and —
// only on success — persists the question and answer together as one exchange. A model failure
// persists nothing and surfaces as a retryable outcome (an inline retry, never an error row,
// ADR-0003).
//
// This is the answer half of the assistant service the thread-persistence slice (#90) anticipated:
// it owns the sole `agent`-turn write, composed over the same author-scoped thread repository so the
// privacy boundary and the no-forged-turn boundary are the ones already established, not new ones.

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
  // scopes the task grounding (#92). threadId is the thread the question continues; content is the
  // question text.
  answer(principal: Principal, threadId: string, content: string): Promise<AnswerOutcome>
}

export interface AnswerServiceDeps {
  threads: ThreadRepository
  knowledge: KnowledgeRepository
  // The ADR-0007-scoped task read the answer grounds on (#92): the principal-parametrized board read,
  // capped to the caller's own visibility — the boundary that keeps the Assistant from becoming a way
  // around the three-role model.
  tasks: TaskContextReader
  llm: LlmClient
  // The query-embedding call for chunk retrieval (ADR-0025). Best-effort: a failure downgrades
  // this one answer to keyword ranking, never to an error.
  embeddings: EmbeddingClient
  // The per-answer log write (0038). Best-effort in the other direction too: a failed insert is
  // reported and swallowed — telemetry must never take an answer down with it.
  log: AnswerLog
  clock: Clock
}

// The weekday is spelled out for the model (see PromptMeta); UTC everywhere, matching how task
// due dates are stamped and rendered.
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const formatToday = (now: Date): string =>
  `${WEEKDAYS[now.getUTCDay()]}, ${now.toISOString().slice(0, 10)}`

export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  const { threads, knowledge, tasks, llm, embeddings, log, clock } = deps
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

      // Retrieve grounding from the chunked knowledge index (ADR-0025): embed the question (and
      // its previous-turn variant, which keeps a content-free follow-up anchored to its topic),
      // then rank the corpus's chunks by similarity. The embedding call is best-effort — a
      // failure or an embedding-less provider downgrades this answer to keyword ranking over the
      // same chunks, never to an error. When nothing relevant is found — or the corpus is empty —
      // the grounding block is empty and the guardrail yields an honest decline, not a guess.
      //
      // The read is parametrized by the caller's role AND the horizon the owner set for it
      // (knowledge.view, 2026-08-26), so the corpus an answer can be built from is already cut to
      // what this person may read: lease terms and payroll sheets never enter the ranking for an
      // employee at all. Same boundary as the task read below, in the same place — the query, not
      // the prompt.
      const knowledgeScope = {
        role: principal.role,
        view: viewScope(principal, 'knowledge.view'),
      }
      const chunks = await knowledge.listGroundingChunks(knowledgeScope)
      // Both arms search for the same thing: resolveQuery returns the question to match on AND the
      // variants to embed, so a contentless follow-up cannot end up with its vectors pointed at the
      // thread's topic while the keyword arm still matches on the word "more".
      const priorUserTurns = existing.messages
        .filter((turn) => turn.role === 'user')
        .map((turn) => turn.content)
      const { question: retrievalQuestion, texts: queryTexts } = resolveQuery(
        content,
        priorUserTurns,
      )
      const embedded = await embeddings.embed(queryTexts)
      if (!embedded.ok) {
        // This used to be discarded outright, along with the retrieval mode it decided. A sustained
        // embedding outage therefore ran the whole assistant in its measured-weaker keyword mode
        // indefinitely while every health signal stayed green — the one failure surface in the
        // system that logged nothing at all. Only the error class, never the question (ADR-0011).
        console.error(`assistant retrieval: embedding unavailable, keyword only: ${embedded.error}`)
      }
      // The cosine ranking happens where the vectors live: one exact pgvector scan per query
      // variant, over exactly the rows this role may read — the vectors themselves never travel
      // to Node, which is what keeps a question O(candidates) instead of O(corpus) as the corpus
      // grows. The variants run concurrently; retrieval fuses them by rank.
      const queryVectors = embedded.ok ? embedded.vectors : []
      const vectorRankings = await Promise.all(
        queryVectors.map((vector) =>
          knowledge.searchChunksByVector(knowledgeScope, vector, ARM_LIMIT),
        ),
      )
      const retrieval = retrieveGrounding(chunks, retrievalQuestion, vectorRankings)
      const { block: grounding, vectorArmEmpty, unembeddedChunks } = retrieval
      // The shared half of both outcomes' log rows — everything known before the model call.
      const logBase = {
        userId: principal.userId,
        role: principal.role,
        threadId,
        mode: retrieval.mode,
        vectorArmEmpty,
        unembeddedChunks,
        retrieved: retrieval.selected.map(
          ({ chunkId, docId, score, vectorScore, keywordRank }) => ({
            chunkId,
            docId,
            score,
            vectorScore,
            keywordRank,
          }),
        ),
      }
      if (vectorArmEmpty && unembeddedChunks > 0) {
        // Nothing cleared the relevance floor while part of the index is still unembedded: the
        // question may well be covered by a chunk whose vector has not been bought yet. Harmless
        // on its own, and the fingerprint of a stalled or half-finished index pass in bulk.
        console.warn(
          `assistant retrieval: vector arm empty with ${unembeddedChunks} unembedded chunk(s)`,
        )
      }

      // Ground on the caller's own tasks through the ADR-0007-scoped read (#92): the retrieval is
      // capped to what this principal may see, so the injected task block can only ever hold their
      // own assigned tasks (Employee), their location's board (Manager), or the chain (Admin). This
      // is the security boundary the ticket exists to hold — the scoping lives in the read, not in
      // the prompt, so the Assistant can never reveal the backlog, another user's, or another
      // location's tasks (ADR-0001, ADR-0013).
      const scopedTasks = await tasks.listScopedTasks(principal)
      const taskContext = renderTaskContext(scopedTasks)
      const messages = buildLlmMessages(grounding, taskContext, existing.messages, content, {
        today: formatToday(clock.now()),
        role: principal.role,
      })

      // The single direct, synchronous call (ADR-0003). A failure — timeout, non-2xx, malformed —
      // folds to a retryable outcome; nothing is persisted, so the client re-sends the question with
      // no orphaned user turn and no error row (ADR-0003, story 8).
      const llmStartedAt = clock.now()
      const result = await llm.complete({ messages, maxTokens: ANSWER_MAX_TOKENS })
      const llmMs = clock.now().getTime() - llmStartedAt.getTime()
      if (!result.ok) {
        // The one line that says why an answer failed. Without it a 503 is indistinguishable from
        // any other 503 in production, and the only record of the failure is the user's retry —
        // measured on the 2026-08-16 battery, where 28 turns failed and nothing on the server said
        // whether it was the timeout, a rate limit, or the token cap. The client already builds
        // this string as the error CLASS only, never the prompt or the response body (ADR-0011).
        console.error(`assistant answer: ${result.error}`)
        const failedAt = clock.now()
        await recordSafely({
          ...logBase,
          status: 'unavailable',
          errorClass: result.error,
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

      // Split the reply into the reader-facing answer and the docs it cited (#227): the guardrail
      // asks the model to end with a machine-read `SOURCES:` trailer, and extractSources peels it
      // off and resolves each cited title against the docs behind the retrieval index — so a
      // task-grounded answer or a refusal (which cite nothing matchable) yields an empty list, and
      // an invented title never resolves to a source. The trailer is stripped here, before the
      // answer is persisted or shown, so the reader never sees it.
      const citable = new Map<string, { id: string; title: string }>()
      for (const chunk of chunks) {
        if (!citable.has(chunk.docId)) {
          citable.set(chunk.docId, { id: chunk.docId, title: chunk.docTitle })
        }
      }
      const { content: answerText, sources } = extractSources(result.content, [...citable.values()])

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
        model: result.model ?? null,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        latencyMs: finishedAt.getTime() - startedAt.getTime(),
        llmMs,
        sources,
        now: finishedAt,
      })
      return { status: 'ok', detail }
    },
  }
}
