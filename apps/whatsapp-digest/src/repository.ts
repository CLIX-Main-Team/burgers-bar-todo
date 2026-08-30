import { Pool } from 'pg'
import type { GroupSummary } from './summary.js'
import type { TranscriptGroup } from './transcript.js'

// The digest's memory (ADR-0026, amended; migration 0036). Plain parameterised SQL over `pg`, not
// drizzle: this workspace deploys as its own container and does not import apps/api, so it shares
// the DATABASE, not the code. The schema is declared in apps/api/src/db/schema.ts because the repo
// has one migration pipeline, and these statements are kept in step with it by hand.
//
// Every method here is best-effort in the same sense the rest of the job is: the store exists to
// make a retry cheap and a summary checkable, and neither of those is worth failing a digest over.
// A database that is down must not stop a digest that Green API and the model were both willing to
// produce, so persistence failures are reported and stepped over, never thrown. That asymmetry is
// the whole reason writing to the store is separate from deciding the digest.

export interface StoredMessage {
  idMessage: string
  chatId: string
  // Null on an outgoing row: the sender is the linked instance itself, which the wire omits rather
  // than naming. The column is nullable for the same reason.
  senderId: string | null
  senderName: string | null
  typeMessage: string
  textMessage: string | null
  direction: string
  sentAt: Date
}

export interface DigestRecord {
  digestDate: string
  message: string
  groupCount: number
  messageCount: number
  model: string
}

export interface DigestStore {
  // Upsert the chat directory from what getChats told us this run, so a chatId has a readable name
  // in the store even when a later run cannot reach getChats.
  saveChats(chats: readonly { chatId: string; name: string }[]): Promise<void>
  // The raw record. Conflicts are expected, not exceptional: the window is wider than the interval
  // on purpose, so consecutive runs re-present the same messages and this is where they collapse.
  saveMessages(messages: readonly StoredMessage[]): Promise<number>
  // Stage 1's output, one row per branch per day, replacing that branch's row if the day is re-run.
  saveSummaries(
    summaries: readonly GroupSummary[],
    groups: readonly TranscriptGroup[],
    summaryDate: string,
    model: string,
  ): Promise<void>
  // Stage 2's output, written BEFORE the send is attempted. Returns the row id so the send can stamp
  // it afterwards; a row whose sent_at is still null is precisely a digest that was built and never
  // delivered.
  saveDigest(record: DigestRecord): Promise<string | null>
  markDigestSent(id: string, idMessage: string): Promise<void>
  // Retention. Summaries are never purged — they are small and they are the long-term memory that
  // outlives the messages — so only the raw record ages out.
  purgeMessagesOlderThan(days: number): Promise<number>
  close(): Promise<void>
}

// The no-op store, wired when DATABASE_URL is absent. It is a real implementation of the port and
// not a null check scattered through the job: the digest ran statelessly for its whole first life
// and must still be runnable that way, by anyone who wants a summary without a database.
export function createNoopDigestStore(): DigestStore {
  return {
    saveChats: async () => {},
    saveMessages: async () => 0,
    saveSummaries: async () => {},
    saveDigest: async () => null,
    markDigestSent: async () => {},
    purgeMessagesOlderThan: async () => 0,
    close: async () => {},
  }
}

export function createPostgresDigestStore(connectionString: string): DigestStore {
  const pool = new Pool({ connectionString })

  return {
    saveChats: async (chats) => {
      if (chats.length === 0) {
        return
      }
      // updated_at moves on a rename; created_at does not, so the directory records when a group was
      // first seen as well as what it is called now.
      await pool.query(
        `INSERT INTO whatsapp_chats (chat_id, name)
         SELECT * FROM UNNEST($1::text[], $2::text[])
         ON CONFLICT (chat_id) DO UPDATE
           SET name = EXCLUDED.name, updated_at = now()
           WHERE whatsapp_chats.name IS DISTINCT FROM EXCLUDED.name`,
        [chats.map((chat) => chat.chatId), chats.map((chat) => chat.name)],
      )
    },

    saveMessages: async (messages) => {
      if (messages.length === 0) {
        return 0
      }
      // One statement over arrays rather than a row per round trip: a busy day is thousands of rows
      // and the overlap means most of them are already there.
      const result = await pool.query(
        `INSERT INTO whatsapp_messages
           (id_message, chat_id, sender_id, sender_name, type_message, text_message, direction, sent_at)
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[]
         )
         ON CONFLICT (id_message) DO NOTHING`,
        [
          messages.map((message) => message.idMessage),
          messages.map((message) => message.chatId),
          messages.map((message) => message.senderId),
          messages.map((message) => message.senderName),
          messages.map((message) => message.typeMessage),
          messages.map((message) => message.textMessage),
          messages.map((message) => message.direction),
          messages.map((message) => message.sentAt),
        ],
      )
      // What the run actually added, as opposed to what it offered — the difference is the overlap
      // doing its job, and it is the number worth logging.
      return result.rowCount ?? 0
    },

    saveSummaries: async (summaries, groups, summaryDate, model) => {
      // A failed branch's placeholder is not a summary and is deliberately not stored: a retry must
      // find that branch missing and redo it, not find an error message filed as the day's record.
      const stored = summaries.filter((summary) => summary.ok)
      if (stored.length === 0) {
        return
      }
      const counts = new Map(groups.map((group) => [group.chatId, group.lines.length]))
      await pool.query(
        `INSERT INTO whatsapp_summaries
           (chat_id, chat_name, summary_date, summary, message_count, model)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::text[])
         ON CONFLICT (chat_id, summary_date) DO UPDATE
           SET summary = EXCLUDED.summary,
               chat_name = EXCLUDED.chat_name,
               message_count = EXCLUDED.message_count,
               model = EXCLUDED.model,
               created_at = now()`,
        [
          stored.map((summary) => summary.chatId),
          stored.map((summary) => summary.name),
          stored.map(() => summaryDate),
          stored.map((summary) => summary.summary),
          stored.map((summary) => counts.get(summary.chatId) ?? 0),
          stored.map(() => model),
        ],
      )
    },

    saveDigest: async (record) => {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO whatsapp_digests
           (digest_date, message, group_count, message_count, model)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (digest_date) DO UPDATE
           SET message = EXCLUDED.message,
               group_count = EXCLUDED.group_count,
               message_count = EXCLUDED.message_count,
               model = EXCLUDED.model,
               created_at = now(),
               -- A re-run rebuilt the text, so the previous run's delivery no longer describes it.
               sent_at = NULL,
               id_message = NULL
         RETURNING id`,
        [record.digestDate, record.message, record.groupCount, record.messageCount, record.model],
      )
      return result.rows[0]?.id ?? null
    },

    markDigestSent: async (id, idMessage) => {
      await pool.query(
        'UPDATE whatsapp_digests SET sent_at = now(), id_message = $2 WHERE id = $1',
        [id, idMessage],
      )
    },

    purgeMessagesOlderThan: async (days) => {
      const result = await pool.query(
        `DELETE FROM whatsapp_messages WHERE sent_at < now() - ($1 || ' days')::interval`,
        [String(days)],
      )
      return result.rowCount ?? 0
    },

    close: async () => {
      await pool.end()
    },
  }
}
