import type { Clock } from '../auth/clock.js'
import { ANSWER_MAX_TOKENS, assembleGrounding, buildLlmMessages } from './grounding.js'
import type { LlmClient } from './llm-client.js'
import type { KnowledgeRepository } from './repository.js'
import type { ThreadRepository, ThreadWithMessages } from './thread-repository.js'

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
  // Answer a question posted to one of the owner's threads. userId is the principal (never a body
  // field); threadId is the thread the question continues; content is the question text.
  answer(userId: string, threadId: string, content: string): Promise<AnswerOutcome>
}

export interface AnswerServiceDeps {
  threads: ThreadRepository
  knowledge: KnowledgeRepository
  llm: LlmClient
  clock: Clock
}

export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  const { threads, knowledge, llm, clock } = deps
  return {
    answer: async (userId, threadId, content) => {
      // Resolve the thread scoped to the owner: an unknown id or another user's thread resolves
      // nothing and is the same non-enumerating not-found the open endpoint returns (ADR-0007). The
      // resolved history is also what is replayed to the model for context (story 7).
      const existing = await threads.getThread(userId, threadId)
      if (!existing) {
        return { status: 'not_found' }
      }

      // Ground on the ingested knowledge cache (ADR-0004): a skipped/near-empty doc carries no
      // content and is excluded by the repository read. When the corpus does not cover the question
      // — or is empty — the grounding does not answer it and the guardrail yields an honest "there
      // is no procedure for that" rather than a fabrication.
      const docs = await knowledge.listIngestedDocs()
      const grounding = assembleGrounding(docs, content)
      const messages = buildLlmMessages(grounding, existing.messages, content)

      // The single direct, synchronous call (ADR-0003). A failure — timeout, non-2xx, malformed —
      // folds to a retryable outcome; nothing is persisted, so the client re-sends the question with
      // no orphaned user turn and no error row (ADR-0003, story 8).
      const result = await llm.complete({ messages, maxTokens: ANSWER_MAX_TOKENS })
      if (!result.ok) {
        return { status: 'unavailable' }
      }

      // Success: persist the question and its answer together as one exchange, bumping the thread's
      // recency, and return the thread with its full, updated history for the response.
      const detail = await threads.appendAnswer({
        threadId,
        userContent: content,
        agentContent: result.content,
        now: clock.now(),
      })
      return { status: 'ok', detail }
    },
  }
}
