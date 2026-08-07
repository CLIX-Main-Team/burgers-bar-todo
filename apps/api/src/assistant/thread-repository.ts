import type { MessageRole, MessageSource } from '@burgers/shared'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { messages, threads } from '../db/schema.js'

// The author-scoped data-access layer for assistant conversations (ADR-0007). Every read here
// is parametrised by the owner's user_id and bakes it into the WHERE, so a thread is reachable
// only by its author — there is no unscoped "get thread by id" a handler could reach with a
// client-supplied id, and no manager/admin override. Every message write goes through
// createThread, which fixes role = 'user'; there is no method that writes an arbitrary role,
// so an `agent` turn cannot be forged from any client path (ADR-0003). The answer path's own
// `agent`-turn writer, appendAnswer (#91), likewise fixes both roles server-side; no method takes a
// caller-supplied role, so the no-forged-turn boundary holds across create and answer alike.

// The outward view of a thread row: the derived title and the ordering timestamps. The owner's
// user_id is deliberately absent — a caller only ever receives its own threads, so surfacing the
// owner would be redundant and is left off the read shape.
export interface ThreadRow {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
}

// The outward view of one turn: its author role, text, created timestamp for ordering, and — on an
// `agent` turn — the knowledge docs its answer drew on (#227). A message is only ever read through
// an already-authorised thread, so it carries no thread_id. `sources` is null on a `user` turn and
// on a legacy `agent` turn written before this column existed; the answer path writes an array
// (empty when task-grounded or a refusal) for every new `agent` turn.
export interface MessageRow {
  id: string
  role: MessageRole
  content: string
  sources: MessageSource[] | null
  createdAt: Date
}

// A thread with its full turn history in created order — what open returns and what create
// returns for the freshly started thread (its single first user turn).
export interface ThreadWithMessages {
  thread: ThreadRow
  messages: MessageRow[]
}

// Start a thread and its first user turn (#90). userId is the owner, taken from the principal
// by the caller; title is the caller-derived title; firstMessageContent is the user's message.
// The timestamps come from the injected clock, so the whole flow reads one controllable time
// source as the auth writes do.
export interface CreateThreadInput {
  userId: string
  title: string
  firstMessageContent: string
  now: Date
}

// The user question and the model's answer to persist together as one exchange (#91). Written in a
// single transaction only after a successful LLM call, so a failed answer leaves no row at all
// (ADR-0003): there is never a lone user turn without its answer, nor a persisted error turn. The
// caller (the answer service) has already resolved the thread within the owner's scope, so this
// carries only threadId — the timestamp comes from the injected clock, as every write here does.
export interface AppendAnswerInput {
  threadId: string
  userContent: string
  agentContent: string
  // The knowledge docs the answer drew on (#227), already resolved to real ingested docs by the
  // answer path. Empty for a task-grounded answer or a refusal; written only on the `agent` turn.
  agentSources: MessageSource[]
  now: Date
}

export interface ThreadRepository {
  // Create the thread and its first turn atomically, with role fixed to 'user' — the only
  // message-write path in this slice, and one that structurally cannot name the role, so no
  // `agent` turn is ever forged here (ADR-0003, ADR-0007). Returns the created thread with its
  // one message.
  createThread(input: CreateThreadInput): Promise<ThreadWithMessages>
  // The caller's own threads, most-recently-active first. Scoped to userId in the WHERE
  // (ADR-0007); there is no unscoped list path.
  listThreads(userId: string): Promise<ThreadRow[]>
  // One thread the caller owns, with its full turn history in created order — or undefined when
  // it is not the caller's (unknown id, or another user's). The userId is composed into the
  // WHERE, so a foreign id resolves nothing and reads as not-found rather than confirming the
  // row exists: a thread is visible to no one but its author, with no manager/admin override.
  getThread(userId: string, threadId: string): Promise<ThreadWithMessages | undefined>
  // Append a completed exchange — the user's question as a `user` turn and the model's reply as an
  // `agent` turn — to an already-authorised thread, and bump the thread's updated_at so it rises to
  // the top of the owner's most-recently-active list. Both turns and the bump are one transaction.
  // The `agent` role is fixed here, never taken from any caller input: this is the sole writer of an
  // `agent` turn, and it cannot be reached from a client path (ADR-0003, ADR-0007). Returns the
  // thread with its full, updated history. The caller has already resolved the thread within the
  // owner's scope (getThread), so this write is not itself the privacy boundary.
  appendAnswer(input: AppendAnswerInput): Promise<ThreadWithMessages>
  // Hard-delete one of the caller's own threads (#257); the messages cascade away with it at the
  // database layer. The userId is composed into the WHERE exactly as getThread does, so a foreign
  // or unknown id deletes nothing and is reported as a miss — the author-scoped read's delete twin,
  // and the privacy boundary for the one destructive path. Returns true iff a row was removed.
  deleteThread(userId: string, threadId: string): Promise<boolean>
}

// The columns every ThreadRow read selects — one place, so create, list, and open return the
// identical outward shape.
const threadRowColumns = {
  id: threads.id,
  title: threads.title,
  createdAt: threads.createdAt,
  updatedAt: threads.updatedAt,
} as const

// The columns every MessageRow read selects.
const messageRowColumns = {
  id: messages.id,
  role: messages.role,
  content: messages.content,
  sources: messages.sources,
  createdAt: messages.createdAt,
} as const

// Order a thread's turns by creation time, and within the same instant put the `user` turn ahead of
// its `agent` answer. The two turns of one exchange are stamped with the same clock time (#91), so
// created_at alone is an ambiguous tiebreak; this keeps a question ahead of its reply. Applied to
// every message read so create, open, and the answer path all return one consistent order.
const messageOrder = [
  asc(messages.createdAt),
  asc(sql`case when ${messages.role} = 'agent' then 1 else 0 end`),
] as const

export function createThreadRepository(db: Db): ThreadRepository {
  // Read a thread's turns in created order. Reached only after the owning thread has been
  // resolved within the caller's scope, so this select is never the privacy boundary — the
  // thread's author-scoped read is.
  const listMessages = (threadId: string): Promise<MessageRow[]> =>
    db
      .select(messageRowColumns)
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(...messageOrder)

  return {
    createThread: async ({ userId, title, firstMessageContent, now }) => {
      // Thread and first turn in one transaction, so a thread never exists without the message
      // it derived its title from, and a partial failure leaves neither behind.
      return db.transaction(async (tx) => {
        const [thread] = await tx
          .insert(threads)
          .values({ userId, title, createdAt: now, updatedAt: now })
          .returning(threadRowColumns)
        // A single-row insert always returns its row; guard the invariant so a driver surprise
        // fails loudly rather than yielding a malformed result.
        if (!thread) {
          throw new Error('insert into threads returned no row')
        }
        const [message] = await tx
          .insert(messages)
          // role is fixed here, not taken from any caller input — the no-forged-turn boundary.
          .values({
            threadId: thread.id,
            role: 'user',
            content: firstMessageContent,
            createdAt: now,
          })
          .returning(messageRowColumns)
        if (!message) {
          throw new Error('insert into messages returned no row')
        }
        return { thread, messages: [message] }
      })
    },

    listThreads: (userId) =>
      db
        .select(threadRowColumns)
        .from(threads)
        .where(eq(threads.userId, userId))
        // Most-recently-active first: updated_at leads, created_at breaks ties so two threads
        // stamped at the same instant still order deterministically.
        .orderBy(desc(threads.updatedAt), desc(threads.createdAt)),

    getThread: async (userId, threadId) => {
      const [thread] = await db
        .select(threadRowColumns)
        .from(threads)
        // Both predicates composed into the WHERE: a thread that exists but belongs to another
        // user matches nothing, exactly as an unknown id does (ADR-0007).
        .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
        .limit(1)
      if (!thread) {
        return undefined
      }
      return { thread, messages: await listMessages(thread.id) }
    },

    appendAnswer: async ({ threadId, userContent, agentContent, agentSources, now }) => {
      // The two turns and the recency bump are one transaction, so a partial failure never leaves a
      // question without its answer or a bump without its turns. The `user` turn is inserted before
      // the `agent` turn; both share `now`, and the messageOrder tiebreak keeps the question ahead
      // of its reply on read. The `agent` role is fixed here, never taken from caller input.
      const thread = await db.transaction(async (tx) => {
        await tx.insert(messages).values([
          // The `user` question carries no sources; the `agent` reply carries the docs it drew on
          // (#227) — an empty array, not null, marking a task-grounded answer or refusal as
          // deliberately source-less rather than a legacy row that predates the column.
          { threadId, role: 'user', content: userContent, createdAt: now },
          { threadId, role: 'agent', content: agentContent, sources: agentSources, createdAt: now },
        ])
        const [row] = await tx
          .update(threads)
          .set({ updatedAt: now })
          .where(eq(threads.id, threadId))
          .returning(threadRowColumns)
        // The caller resolved this thread within the owner's scope moments ago, so its absence here
        // is a driver surprise, not a normal not-found; fail loudly rather than return a half state.
        if (!row) {
          throw new Error('appendAnswer updated no thread row')
        }
        return row
      })
      // Read the full, updated history through the shared reader — the transaction has committed, so
      // this observes both new turns in the one consistent order create and open also return.
      return { thread, messages: await listMessages(threadId) }
    },

    deleteThread: async (userId, threadId) => {
      // Both predicates in the WHERE, the same composition as getThread: a thread that is not the
      // caller's matches nothing and nothing is removed. One statement — the messages FK cascades,
      // so the turns vanish atomically with their thread and no orphan can survive a partial failure.
      const deleted = await db
        .delete(threads)
        .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
        .returning({ id: threads.id })
      return deleted.length > 0
    },
  }
}
