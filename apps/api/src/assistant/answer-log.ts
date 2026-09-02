import type { MessageSource } from '@burgers/shared'
import type { Db } from '../db/client.js'
import { type AnswerLogRetrieved, assistantAnswerLog } from '../db/schema.js'

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
  mode: 'hybrid' | 'keyword'
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
  llmMs: number | null
  vectorArmEmpty: boolean
  unembeddedChunks: number
  retrieved: AnswerLogRetrieved[]
  sources: MessageSource[]
  now: Date
}

export interface AnswerLog {
  record(entry: AnswerLogEntry): Promise<void>
}

export function createAnswerLog(db: Db): AnswerLog {
  return {
    record: async (entry) => {
      const { now, ...fields } = entry
      await db.insert(assistantAnswerLog).values({ ...fields, createdAt: now })
    },
  }
}
