import type { Clock } from '../auth/clock.js'
import type { ThreadRepository, ThreadRow, ThreadWithMessages } from './thread-repository.js'

// The assistant service for conversations (ADR-0003, ADR-0007): the one place a message turn is
// written. It owns thread creation — deriving the title and writing the first user turn through
// the repository — and the author-scoped reads. It is the boundary the ADRs name: "message
// writes happen only inside the assistant service", so no route reaches the repository directly
// and no client path inserts a turn. The answer path (a later slice) extends this service with
// the grounded LLM call and the `agent`-turn write, rather than re-scaffolding it.

// The longest a derived title runs before it is truncated. A scannable one-liner for the list;
// the full first message is always readable by opening the thread.
export const THREAD_TITLE_MAX_LENGTH = 80

// Derive a thread's title from its first user message (#90): a cheap, deterministic truncation,
// not a model call. Interior whitespace and newlines collapse to single spaces so a multi-line
// message yields a tidy one-liner, and an over-long message is cut to the limit with an ellipsis.
// The caller guarantees a non-empty, trimmed message (the shared min(1) rule), so the result is
// never blank.
export function deriveThreadTitle(firstUserMessage: string): string {
  const collapsed = firstUserMessage.trim().replace(/\s+/g, ' ')
  if (collapsed.length <= THREAD_TITLE_MAX_LENGTH) {
    return collapsed
  }
  // Reserve the last slot for the ellipsis and drop any trailing space the cut exposed.
  return `${collapsed.slice(0, THREAD_TITLE_MAX_LENGTH - 1).trimEnd()}…`
}

export interface ThreadService {
  // Start a thread for the owner and write its first user turn. userId comes from the principal,
  // never the request body; the title is derived here and the turn's role is fixed to 'user' in
  // the repository. Returns the new thread with its one message.
  createThread(userId: string, content: string): Promise<ThreadWithMessages>
  // The owner's own threads, most-recently-active first (author-scoped, ADR-0007).
  listThreads(userId: string): Promise<ThreadRow[]>
  // Open one of the owner's threads with its full history, or undefined when it is not theirs —
  // the privacy boundary, enforced by the scoped repository read (ADR-0007).
  getThread(userId: string, threadId: string): Promise<ThreadWithMessages | undefined>
  // Hard-delete one of the owner's threads (#257), messages and all. False when it is not theirs
  // (unknown id, or another user's) — the same author scope every read here carries.
  deleteThread(userId: string, threadId: string): Promise<boolean>
}

export function createThreadService(repo: ThreadRepository, clock: Clock): ThreadService {
  return {
    createThread: (userId, content) =>
      repo.createThread({
        userId,
        title: deriveThreadTitle(content),
        firstMessageContent: content,
        now: clock.now(),
      }),

    listThreads: (userId) => repo.listThreads(userId),

    getThread: (userId, threadId) => repo.getThread(userId, threadId),

    deleteThread: (userId, threadId) => repo.deleteThread(userId, threadId),
  }
}
