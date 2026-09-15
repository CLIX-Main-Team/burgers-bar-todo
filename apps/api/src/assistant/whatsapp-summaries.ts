import { and, asc, between, desc, ilike } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { whatsappSummaries } from '../db/schema.js'

// The assistant's read of the WhatsApp group summaries (#381): the daily per-group summaries the
// digest worker writes (apps/whatsapp-digest, ADR-0026), looked up by a piece of the group's name
// over a window of days. This is the one contract the two sides agreed on 2026-09-15: the four
// columns below, matched on chat_name, kept for ten days. The worker owns the table; this module
// only reads it, and reads nothing the summaries do not already say (never the raw messages).
//
// Matched on the name rather than on a chat-to-branch mapping because no mapping exists yet
// (branch_id is null on every chat) and the group names spell the branch word in more than one
// way — "סניף תלפיות", "תלפיות - צוות" — so a substring on the branch word is what actually finds
// them.

export interface WhatsappSummaryQuery {
  nameContains: string
  // Calendar days, 'YYYY-MM-DD' in Israel local time, inclusive.
  from: string
  to: string
}

export interface WhatsappSummaryView {
  chatName: string
  summaryDate: string
  summary: string
  messageCount: number
}

export interface WhatsappSummaryReader {
  listSummaries(query: WhatsappSummaryQuery): Promise<WhatsappSummaryView[]>
}

// Enough for ten days of a handful of matching groups; a wider match is narrowed by the model
// asking again with a more specific name.
const SUMMARY_ROW_LIMIT = 50

// The name is model-written text: a `%` or `_` in it would widen the ILIKE pattern rather than
// match literally, so both are escaped (backslash is Postgres's default LIKE escape).
const escapeLikePattern = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`)

export function createWhatsappSummaryReader(db: Db): WhatsappSummaryReader {
  return {
    listSummaries: async ({ nameContains, from, to }) =>
      db
        .select({
          chatName: whatsappSummaries.chatName,
          summaryDate: whatsappSummaries.summaryDate,
          summary: whatsappSummaries.summary,
          messageCount: whatsappSummaries.messageCount,
        })
        .from(whatsappSummaries)
        .where(
          and(
            ilike(whatsappSummaries.chatName, `%${escapeLikePattern(nameContains)}%`),
            between(whatsappSummaries.summaryDate, from, to),
          ),
        )
        .orderBy(desc(whatsappSummaries.summaryDate), asc(whatsappSummaries.chatName))
        .limit(SUMMARY_ROW_LIMIT),
  }
}
