import type { MessageSource } from '@burgers/shared'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { type AnswerLogRetrieved, type AnswerLogTool, assistantAnswerLog } from '../db/schema.js'

// The per-answer log write (0038): one row per answer attempt, inserted by the answer service
// after the outcome is known. This is the record every operational question reads from — what
// grounded an answer (audit), what it cost (tokens), how retrieval is trending (drift), and how
// often the model call fails (reliability) — bought with a single insert on a path that already
// paid for an LLM call. The entry carries references and numbers only; the question and the
// answer text stay on the thread's messages (ADR-0011) and must never be written here.

export interface AnswerLogEntry {
  userId: string
  role: string
  threadId: string
  status: 'answered' | 'unavailable'
  errorClass: string | null
  agentMessageId: string | null
  // 'none' when the answer ran no document search (#381).
  mode: 'hybrid' | 'keyword' | 'none'
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
  llmMs: number | null
  vectorArmEmpty: boolean
  unembeddedChunks: number
  retrieved: AnswerLogRetrieved[]
  sources: MessageSource[]
  // The tools the answer ran, in call order (#381): names and statuses only.
  tools: AnswerLogTool[]
  // How many model calls the answer took, and whether its lookup budget ran out (#387).
  rounds: number
  capped: boolean
  // What it cost and where it went (0048). Null throughout means the provider reported nothing,
  // which is a different fact from zero and is kept distinguishable on purpose.
  costMicroUsd: number | null
  cachedTokens: number | null
  reasoningTokens: number | null
  webSearches: number | null
  // Cited document titles that no retrieval returned: invented citations, counted.
  unresolvedCitations: number
  now: Date
}

export interface AnswerLog {
  record(entry: AnswerLogEntry): Promise<void>
  // What the answers of the Israel calendar day `now` falls in have cost so far, in dollars
  // (2026-09-20): the answered rows that carry a cost. The day is Israel's, where the questions
  // are asked, so an answer at 23:30 in Tel Aviv counts with that day.
  spentOnDay(now: Date): Promise<number>
}

export function createAnswerLog(db: Db): AnswerLog {
  return {
    record: async (entry) => {
      const { now, ...fields } = entry
      await db.insert(assistantAnswerLog).values({ ...fields, createdAt: now })
    },
    spentOnDay: async (now) => {
      const [row] = await db
        .select({ micro: sql<string | null>`sum(${assistantAnswerLog.costMicroUsd})` })
        .from(assistantAnswerLog)
        .where(
          sql`${assistantAnswerLog.status} = 'answered' and (${assistantAnswerLog.createdAt} at time zone 'Asia/Jerusalem')::date = (${now.toISOString()}::timestamptz at time zone 'Asia/Jerusalem')::date`,
        )
      return Number(row?.micro ?? 0) / 1_000_000
    },
  }
}
