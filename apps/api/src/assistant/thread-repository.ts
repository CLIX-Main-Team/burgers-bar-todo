import type { MessageRole } from '@burgers/shared'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { messages, threads } from '../db/schema.js'

// The author-scoped data-access layer for assistant conversations (ADR-0007). Every read here
// is parametrised by the owner's user_id and bakes it into the WHERE, so a thread is reachable
// only by its author — there is no unscoped "get thread by id" a handler could reach with a
// client-supplied id, and no manager/admin override. Every message write goes through
// createThread, which fixes role = 'user'; there is no method that writes an arbitrary role,
// so an `agent` turn cannot be forged from any client path (ADR-0003). The answer path (a later
// slice) adds its own writer for the `agent` turn; this slice persists and read-scopes only.

// The outward view of a thread row: the derived title and the ordering timestamps. The owner's
// user_id is deliberately absent — a caller only ever receives its own threads, so surfacing the
// owner would be redundant and is left off the read shape.
export interface ThreadRow {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
}

// The outward view of one turn: its author role, text, and created timestamp for ordering. A
// message is only ever read through an already-authorised thread, so it carries no thread_id.
export interface MessageRow {
  id: string
  role: MessageRole
  content: string
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
  createdAt: messages.createdAt,
} as const

export function createThreadRepository(db: Db): ThreadRepository {
  // Read a thread's turns in created order. Reached only after the owning thread has been
  // resolved within the caller's scope, so this select is never the privacy boundary — the
  // thread's author-scoped read is.
  const listMessages = (threadId: string): Promise<MessageRow[]> =>
    db
      .select(messageRowColumns)
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt))

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
  }
}
