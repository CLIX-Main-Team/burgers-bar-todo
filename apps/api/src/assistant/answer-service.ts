import type { Clock } from '../auth/clock.js'
import type { Principal } from '../auth/principal.js'
import type { AnswerLogTool } from '../db/schema.js'
import type { AnswerLog, AnswerLogEntry } from './answer-log.js'
import {
  ANSWER_MAX_TOKENS,
  SOURCES_PREFIX,
  buildToolLoopMessages,
  collectSources,
  extractSources,
  formatTodayInJerusalem,
  generalKnowledgeSource,
  mintFence,
} from './grounding.js'
import { createLanguageReview } from './language-review.js'
import type { LlmClient, LlmTool } from './llm-client.js'
import { createSourceGuard } from './source-guard.js'
import type { ThreadRepository, ThreadWithMessages } from './thread-repository.js'
import { composeReviews, runToolLoop } from './tool-loop.js'
import { type AssistantToolPorts, createAssistantTools } from './tools.js'

import { resolveCitations } from './web-citations.js'
export type { TaskContextReader } from './tools.js'

// How long one cited page has to say where it really lives. Short on purpose: this sits between
// the answer being written and the reader seeing it, and a slow redirect must cost a chip rather
// than the answer.
const CITATION_RESOLVE_MS = 2_000

// How many titles the answer's trailer claims. extractSources resolves them and drops the count,
// which is right for the product and blind for the log; the difference is the invented ones.
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
  // The broker's web search to offer beside the tools (#385), or null where the provider has
  // none — the prompt then says the web could not be checked.
  webSearch: LlmTool | null
  // Where the routed model's own knowledge ends, stated in the prompt (#387).
  knowledgeCutoff: string | null
  // The per-answer log write (0038). Best-effort: a failed insert is reported and swallowed —
  // telemetry must never take an answer down with it.
  log: AnswerLog
  clock: Clock
}

export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  const { threads, ports, llm, webSearch, knowledgeCutoff, log, clock } = deps
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
          webSearch: webSearch !== null,
          knowledgeCutoff,
        },
        fence,
      )

      // The bounded loop (tool-loop.ts): the model asks for what it needs, round by round, and
      // answers. A failure at any round folds to the retryable outcome a single-call failure
      // always did (ADR-0003); nothing is persisted, so the client re-sends the question with no
      // orphaned user turn and no error row.
      // The guard for an answer that names a source it never received (source-guard.ts): it
      // looks at each finished draft inside the loop, and has the last word on the text below.
      const sourceGuard = createSourceGuard()
      // And the check for an answer in the wrong language (language-review.ts), after the guard:
      // one objection per answer is acted on, and a wrong source outranks a wrong language.
      const reviews = composeReviews([
        { name: 'source_guard', review: sourceGuard.review },
        { name: 'language_check', review: createLanguageReview().review },
      ])
      const llmStartedAt = clock.now()
      const outcome = await runToolLoop({
        llm,
        clock,
        fence,
        messages,
        tools: tools.tools,
        ...(webSearch === null ? {} : { serverTools: [webSearch] }),
        maxTokens: ANSWER_MAX_TOKENS,
        review: reviews.review,
      })
      const llmMs = clock.now().getTime() - llmStartedAt.getTime()

      // The broker's search leaves no call in the trace, so it is logged from what came back:
      // a cited page means it ran and found something; a billed search with no citation means
      // it ran and found nothing; neither means it did not run (or the broker did not say).
      const webSearchRan: AnswerLogTool[] = !outcome.ok
        ? []
        : outcome.citations.length > 0
          ? [{ tool: 'web_search', status: 'ok' }]
          : (outcome.usage?.webSearches ?? 0) > 0
            ? [{ tool: 'web_search', status: 'empty' }]
            : []

      // The guard leaves no call in the trace either, so it is logged the same way: 'ok' for a
      // draft that was sent back and came back clean, 'failed' for an answer that reached the
      // reader with the fallback note because the second pass was no better. How often each
      // happens is the measure of whether the guard is earning its second model call.
      const sourceGuardRan: AnswerLogTool[] =
        outcome.ok && outcome.review !== undefined
          ? [
              {
                tool: reviews.objectedBy() ?? 'source_guard',
                status: outcome.review === 'repaired' ? 'ok' : 'failed',
              },
            ]
          : []

      const usage = outcome.ok ? outcome.usage : null

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
        tools: [
          ...outcome.trace.map(({ tool, status }) => ({ tool, status })),
          ...webSearchRan,
          ...sourceGuardRan,
        ],
        rounds: outcome.ok ? outcome.rounds : 0,
        capped: outcome.ok ? outcome.capped : false,
        // What it cost (0048). Dollars arrive as a float and are stored in millionths, because an
        // answer costs cents and money does not belong in floating point. Null all the way down
        // when the provider reported nothing: an unreported cost is not a free answer, and a
        // column that defaulted to zero would make the spend alert read an outage as a bargain.
        costMicroUsd: usage?.costUsd === undefined ? null : Math.round(usage.costUsd * 1_000_000),
        cachedTokens: usage?.cachedTokens ?? null,
        reasoningTokens: usage?.reasoningTokens ?? null,
        webSearches: usage?.webSearches ?? null,
        unresolvedCitations: 0,
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
      const settled = sourceGuard.settle(
        outcome,
        principal.preferredLanguage === 'en' ? 'en' : 'he',
      )
      const { content: answerText, sources: documents } = extractSources(
        settled,
        tools.retrievedDocs(),
      )
      // A title the answer cited that no search returned. extractSources resolves it to no chip,
      // which is the right behaviour for the reader and silence for everyone else: counting it is
      // how an invented citation becomes something anyone can notice (0048).
      const unresolvedCitations = Math.max(0, citedTitleCount(settled) - documents.length)
      // Google's engine cites every page as a grounding redirect through its own domain, so
      // until now the chip under a web answer named vertexaisearch.cloud.google.com rather than
      // the site that was read (F5). Resolved here, after the answer is written: the reader is
      // already waiting, so a redirect that will not resolve yields a worse chip and never a lost
      // or delayed answer.
      const citations = await resolveCitations(outcome.citations, {
        fetchImpl: fetch,
        timeoutMs: CITATION_RESOLVE_MS,
      })
      const grounded = collectSources({
        documents: documents.map((document) => ({ ...document, type: 'document' as const })),
        trace: outcome.trace,
        citations,
      })
      // Nothing was looked up and nothing was cited: the answer is the model's own knowledge, and
      // it is labelled as such rather than left to read like a company fact.
      const sources = [
        ...grounded,
        ...generalKnowledgeSource(
          answerText,
          grounded,
          outcome.trace,
          principal.preferredLanguage === 'en' ? 'General knowledge' : 'ידע כללי',
        ),
      ]
      // A capped loop answered with what it had. Saying so is the difference between a partial
      // answer and one the reader takes as complete.
      const shown = outcome.capped
        ? `${answerText}\n\n${
            principal.preferredLanguage === 'en'
              ? 'Partial answer: I reached the lookup limit for this question, so there may be more to find.'
              : 'תשובה חלקית: הגעתי למגבלת החיפושים לשאלה הזו, ייתכן שיש עוד מידע.'
          }`
        : answerText

      // Success: persist the question and its answer together as one exchange, bumping the thread's
      // recency, and return the thread with its full, updated history for the response.
      const detail = await threads.appendAnswer({
        threadId,
        userContent: content,
        agentContent: shown,
        agentSources: sources,
        now: clock.now(),
      })
      const finishedAt = clock.now()
      await recordSafely({
        ...logBase,
        unresolvedCitations,
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
