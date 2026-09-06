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
  // A photo's caption and a document's filename. Stored because the digest now reads its day from
  // this table: a column we drop is content the summary can never recover, turning every file into
  // an anonymous placeholder.
  caption: string | null
  fileName: string | null
  direction: string
  sentAt: Date
}

// The off switch, as the job reads it (migration 0037). One row in the database, consulted fresh on
// every run so that flipping it takes effect at the next 08:00 with no restart and no deploy.
export interface DigestSwitch {
  enabled: boolean
  // Why it is in this state, written by whoever last flipped it and printed back by the container
  // when it declines to run. Null when nobody left one.
  note: string | null
}

export interface DigestRecord {
  digestDate: string
  message: string
  groupCount: number
  messageCount: number
  model: string
  // Which clock produced it (0041). Only 'scheduled' is one-per-day; two on-demand summaries in an
  // afternoon are two answers to two questions and are both kept.
  kind: DigestKind
}

export type DigestKind = 'scheduled' | 'manual'

// One person asking for a summary now rather than at 08:00 (migration 0041). Written by the API's
// webhook, which is the only half of the deployment that can hear WhatsApp, and read here, which is
// the only half that can answer it.
export interface SummaryRequest {
  // The gateway's id for the message that carried the keyword, and the row's primary key: Green API
  // redelivers for 24 hours, and under any other key a redelivery is a second paid run.
  idMessage: string
  // Where the answer goes. Carried on the request rather than read from configuration at send time,
  // so an answer returns to the chat that asked even if the recipient is changed in between.
  chatId: string
  requestedBy: string | null
  requestedAt: Date
}

export type SummaryRequestOutcome = 'done' | 'failed' | 'skipped'

export interface DigestStore {
  // Upsert the chat directory from what getChats told us this run, so a chatId has a readable name
  // in the store even when a later run cannot reach getChats.
  saveChats(chats: readonly { chatId: string; name: string }[]): Promise<void>
  // The raw record. Conflicts are expected, not exceptional: the window is wider than the interval
  // on purpose, so consecutive runs re-present the same messages and this is where they collapse.
  saveMessages(messages: readonly StoredMessage[]): Promise<number>
  // The day's stored rows, in time order. `null` rather than `[]` when the store cannot read at all,
  // because the two must not be confused: an empty array is a genuinely quiet day and would have the
  // digest cheerfully report that nothing happened, which is the exact silent-empty failure the
  // gateway preflight exists to prevent.
  loadMessages(
    from: Date,
    to: Date,
    allowedGroups: readonly string[],
  ): Promise<StoredMessage[] | null>
  loadChats(): Promise<{ chatId: string; name: string }[] | null>
  // Read the off switch. Everything the digest does after this call either costs money or reaches a
  // person, so this is the last free thing that happens in a run.
  //
  // `null` means there is no store to ask, which the digest treats as off. That asymmetry is
  // deliberate and it is the opposite of how every other method here behaves: a store that cannot be
  // reached must never be the reason a paid pipeline runs.
  readSwitch(): Promise<DigestSwitch | null>
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
  // On-demand requests (0041), the half of the feature this container owns. The API's webhook hears
  // the keyword and writes the row; this claims it.
  //
  // Claiming is a state change, not a read, and it is what makes concurrency safe: a request moves
  // to 'running' before any work starts, and while one is running no other is claimed. Five taps of
  // the keyword are one run, not five sweeps of paid model calls against the same messages.
  //
  // staleAfterMs is the reclaim window. A run that dies mid-flight leaves its row marked 'running'
  // forever, and without a reclaim that corpse holds the lock and the feature is silently dead until
  // somebody thinks to look in the database.
  claimSummaryRequest(staleAfterMs: number): Promise<SummaryRequest | null>
  finishSummaryRequest(
    idMessage: string,
    outcome: SummaryRequestOutcome,
    error?: string | null,
  ): Promise<void>
  // When the last on-demand summary actually completed, for the cooldown. Only successful runs
  // count: a failed one must not lock the feature for half an hour, since the person who asked
  // still has no answer.
  lastManualRunAt(): Promise<Date | null>
  // Retention. The raw record ages out fastest: it is a verbatim copy of the client's own
  // conversations, and the digest only ever reads the last 24 hours of it.
  purgeMessagesOlderThan(days: number): Promise<number>
  // The derived layers age out too, on a longer clock. They are our words rather than anyone's chat
  // and they are small, which is why they outlive the messages — but "outlives" is not "forever",
  // and a table nobody ever deletes from is a table that quietly accumulates a year of the client's
  // operations. Returns both counts because they are two tables and a caller reporting "purged 4"
  // should be able to say which.
  purgeSummariesOlderThan(days: number): Promise<{ summaries: number; digests: number }>
  close(): Promise<void>
}

// The no-op store, wired when DATABASE_URL is absent. It is a real implementation of the port and
// not a null check scattered through the job: the digest ran statelessly for its whole first life
// and must still be runnable that way, by anyone who wants a summary without a database.
export function createNoopDigestStore(): DigestStore {
  return {
    saveChats: async () => {},
    saveMessages: async () => 0,
    loadMessages: async () => null,
    loadChats: async () => null,
    readSwitch: async () => null,
    saveSummaries: async () => {},
    saveDigest: async () => null,
    markDigestSent: async () => {},
    // No store, no requests. A stateless run answers the schedule and nothing else, which is the
    // right shape: the keyword arrives through a database this deployment does not have.
    claimSummaryRequest: async () => null,
    finishSummaryRequest: async () => {},
    lastManualRunAt: async () => null,
    purgeMessagesOlderThan: async () => 0,
    purgeSummariesOlderThan: async () => ({ summaries: 0, digests: 0 }),
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
           (id_message, chat_id, sender_id, sender_name, type_message, text_message, caption, file_name, direction, sent_at)
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
           $7::text[], $8::text[], $9::text[], $10::timestamptz[]
         )
         ON CONFLICT (id_message) DO NOTHING`,
        [
          messages.map((message) => message.idMessage),
          messages.map((message) => message.chatId),
          messages.map((message) => message.senderId),
          messages.map((message) => message.senderName),
          messages.map((message) => message.typeMessage),
          messages.map((message) => message.textMessage),
          messages.map((message) => message.caption),
          messages.map((message) => message.fileName),
          messages.map((message) => message.direction),
          messages.map((message) => message.sentAt),
        ],
      )
      // What the run actually added, as opposed to what it offered — the difference is the overlap
      // doing its job, and it is the number worth logging.
      return result.rowCount ?? 0
    },

    loadMessages: async (from, to, allowedGroups) => {
      // Half-open, matching the transcript's own window test, so a message landing exactly on a
      // boundary is claimed by one day and never by both.
      //
      // Two shapes rather than one clever one: with an allowlist the chat_id = ANY(...) form uses the
      // (chat_id, sent_at) index, which is the only index this table has. Without one the query is a
      // range scan bounded by the 30-day retention, and the group suffix is applied in SQL so a
      // direct message cannot reach the digest even if one were somehow stored.
      const result =
        allowedGroups.length > 0
          ? await pool.query<StoredMessage>(
              `SELECT id_message AS "idMessage", chat_id AS "chatId", sender_id AS "senderId",
                      sender_name AS "senderName", type_message AS "typeMessage",
                      text_message AS "textMessage", caption, file_name AS "fileName",
                      direction, sent_at AS "sentAt"
                 FROM whatsapp_messages
                WHERE chat_id = ANY($3) AND sent_at >= $1 AND sent_at < $2
                ORDER BY sent_at`,
              [from, to, [...allowedGroups]],
            )
          : await pool.query<StoredMessage>(
              `SELECT id_message AS "idMessage", chat_id AS "chatId", sender_id AS "senderId",
                      sender_name AS "senderName", type_message AS "typeMessage",
                      text_message AS "textMessage", caption, file_name AS "fileName",
                      direction, sent_at AS "sentAt"
                 FROM whatsapp_messages
                WHERE sent_at >= $1 AND sent_at < $2 AND chat_id LIKE '%@g.us'
                ORDER BY sent_at`,
              [from, to],
            )
      return result.rows
    },

    loadChats: async () => {
      const result = await pool.query<{ chatId: string; name: string }>(
        'SELECT chat_id AS "chatId", name FROM whatsapp_chats',
      )
      return result.rows
    },

    readSwitch: async () => {
      // WHERE id, not WHERE id = true: the column is the singleton key and the CHECK already pins it
      // true, so this reads the one row there can be.
      const result = await pool.query<{ enabled: boolean; note: string | null }>(
        'SELECT enabled, note FROM whatsapp_digest_settings WHERE id',
      )
      const row = result.rows[0]
      if (row === undefined) {
        // The migration seeds this row, so an empty table means the schema and the deployment have
        // come apart. Read as off. The two possible wrong guesses here are not symmetrical: guessing
        // on spends real money every morning against a database nobody has looked at.
        return {
          enabled: false,
          note: 'there is no settings row at all, so the digest is treated as switched off',
        }
      }
      return row
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
      const values = [
        record.digestDate,
        record.message,
        record.groupCount,
        record.messageCount,
        record.model,
        record.kind,
      ]
      // Two shapes, because the two kinds mean different things about a second row on one day
      // (0041). A re-run of the daily job rebuilds the same briefing and replaces it; two on-demand
      // summaries in an afternoon are two answers to two questions and are both kept. The WHERE on
      // the conflict target is not optional: the unique index is partial, and Postgres will not
      // infer a partial index without its predicate.
      const sql =
        record.kind === 'scheduled'
          ? `INSERT INTO whatsapp_digests
               (digest_date, message, group_count, message_count, model, kind)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (digest_date) WHERE kind = 'scheduled' DO UPDATE
               SET message = EXCLUDED.message,
                   group_count = EXCLUDED.group_count,
                   message_count = EXCLUDED.message_count,
                   model = EXCLUDED.model,
                   created_at = now(),
                   -- A re-run rebuilt the text, so the previous run's delivery no longer describes it.
                   sent_at = NULL,
                   id_message = NULL
             RETURNING id`
          : `INSERT INTO whatsapp_digests
               (digest_date, message, group_count, message_count, model, kind)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`
      const result = await pool.query<{ id: string }>(sql, values)
      return result.rows[0]?.id ?? null
    },

    claimSummaryRequest: async (staleAfterMs) => {
      // Reclaim first. A row left 'running' by a process that died is failed here rather than left
      // to block every future request, and it is marked failed rather than returned to 'pending' on
      // purpose: whatever killed the last attempt would most likely kill the retry too, and a loop
      // that re-runs a poisonous request forever is worse than one that gives up and says so.
      await pool.query(
        `UPDATE whatsapp_summary_requests
            SET status = 'failed',
                finished_at = now(),
                error = 'the run that claimed this never finished'
          WHERE status = 'running'
            AND claimed_at < now() - make_interval(secs => $1::double precision)`,
        [staleAfterMs / 1000],
      )
      // Then claim, but only when nothing is running. The NOT EXISTS is the concurrency guard: five
      // taps of the keyword queue five rows and this turns them into one run at a time.
      const result = await pool.query<{
        id_message: string
        chat_id: string
        requested_by: string | null
        requested_at: Date
      }>(
        `UPDATE whatsapp_summary_requests
            SET status = 'running', claimed_at = now()
          WHERE id_message = (
                  SELECT id_message
                    FROM whatsapp_summary_requests
                   WHERE status = 'pending'
                   ORDER BY requested_at
                   LIMIT 1
                     FOR UPDATE SKIP LOCKED
                )
            AND NOT EXISTS (
                  SELECT 1 FROM whatsapp_summary_requests WHERE status = 'running'
                )
        RETURNING id_message, chat_id, requested_by, requested_at`,
      )
      const row = result.rows[0]
      return row === undefined
        ? null
        : {
            idMessage: row.id_message,
            chatId: row.chat_id,
            requestedBy: row.requested_by,
            requestedAt: row.requested_at,
          }
    },

    finishSummaryRequest: async (idMessage, outcome, error = null) => {
      await pool.query(
        `UPDATE whatsapp_summary_requests
            SET status = $2, finished_at = now(), error = $3
          WHERE id_message = $1`,
        [idMessage, outcome, error],
      )
    },

    lastManualRunAt: async () => {
      const result = await pool.query<{ finished_at: Date | null }>(
        `SELECT max(finished_at) AS finished_at
           FROM whatsapp_summary_requests
          WHERE status = 'done'`,
      )
      return result.rows[0]?.finished_at ?? null
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

    purgeSummariesOlderThan: async (days) => {
      // created_at, not summary_date/digest_date: those are text `YYYY-MM-DD` wall-clock labels for
      // the day being described, while this asks how long the ROW has existed, which is the question
      // retention is about. A re-run bumps created_at, so a digest that was rebuilt yesterday is
      // treated as yesterday's row even when it describes a day last week.
      const summaries = await pool.query(
        `DELETE FROM whatsapp_summaries WHERE created_at < now() - ($1 || ' days')::interval`,
        [String(days)],
      )
      const digests = await pool.query(
        `DELETE FROM whatsapp_digests WHERE created_at < now() - ($1 || ' days')::interval`,
        [String(days)],
      )
      return { summaries: summaries.rowCount ?? 0, digests: digests.rowCount ?? 0 }
    },

    close: async () => {
      await pool.end()
    },
  }
}

// --- The scriptable fake, the test double the job's tests name ---

export interface FakeDigestStore extends DigestStore {
  // What the run wrote, so a test can assert on persistence without a database.
  readonly written: StoredMessage[]
  readonly digests: DigestRecord[]
  // Seed the day the digest will read. Rows go in as they would come out of Postgres: already
  // filtered to groups, already in time order.
  seed(messages: readonly StoredMessage[]): void
  seedChats(chats: readonly { chatId: string; name: string }[]): void
  // Make reads fail the way an unreachable database does, so the run's degraded paths are exercised.
  failReads(sqlstate: string): void
  // Answer null from loadMessages: a store that cannot read at all, which the digest must not
  // confuse with a quiet day.
  cannotRead(): void
  // Position the off switch. The fake starts switched ON, so a test says nothing about the switch
  // unless the switch is what it is testing.
  setSwitch(value: DigestSwitch | null): void
  // Queue an on-demand request, as the API's webhook would have written it (0041).
  seedRequest(request: SummaryRequest): void
  // How each request ended, so a test can assert the row was closed and with what.
  readonly finished: { idMessage: string; outcome: SummaryRequestOutcome; error: string | null }[]
  // Position the cooldown clock: when the last successful on-demand run completed.
  setLastManualRunAt(at: Date | null): void
}

export function createFakeDigestStore(): FakeDigestStore {
  const written: StoredMessage[] = []
  const digests: DigestRecord[] = []
  let rows: StoredMessage[] = []
  let chats: { chatId: string; name: string }[] = []
  let readFailure: string | null = null
  let readable = true
  let digestSwitch: DigestSwitch | null = { enabled: true, note: null }
  const pending: SummaryRequest[] = []
  const finished: { idMessage: string; outcome: SummaryRequestOutcome; error: string | null }[] = []
  let lastManualRun: Date | null = null

  return {
    written,
    digests,
    finished,
    seedRequest: (request) => {
      pending.push(request)
    },
    setLastManualRunAt: (at) => {
      lastManualRun = at
    },
    seed: (messages) => {
      rows = [...messages]
    },
    seedChats: (seeded) => {
      chats = [...seeded]
    },
    failReads: (sqlstate) => {
      readFailure = sqlstate
    },
    cannotRead: () => {
      readable = false
    },
    setSwitch: (value) => {
      digestSwitch = value
    },
    saveChats: async () => {},
    saveMessages: async (messages) => {
      written.push(...messages)
      return messages.length
    },
    loadMessages: async (from, to) => {
      if (readFailure !== null) {
        throw Object.assign(new Error('read failed'), { code: readFailure })
      }
      if (!readable) {
        return null
      }
      return rows.filter((row) => row.sentAt >= from && row.sentAt < to)
    },
    loadChats: async () => (readable ? chats : null),
    readSwitch: async () => {
      if (readFailure !== null) {
        throw Object.assign(new Error('read failed'), { code: readFailure })
      }
      return digestSwitch
    },
    saveSummaries: async () => {},
    saveDigest: async (record) => {
      digests.push(record)
      return 'fake-digest-id'
    },
    markDigestSent: async () => {},
    // The queue behaves like the real one in the way that matters to a caller: a claim removes the
    // request, so the same row cannot be picked up twice by a loop that keeps polling.
    claimSummaryRequest: async () => pending.shift() ?? null,
    finishSummaryRequest: async (idMessage, outcome, error = null) => {
      finished.push({ idMessage, outcome, error })
    },
    lastManualRunAt: async () => lastManualRun,
    purgeMessagesOlderThan: async () => 0,
    purgeSummariesOlderThan: async () => ({ summaries: 0, digests: 0 }),
    close: async () => {},
  }
}
