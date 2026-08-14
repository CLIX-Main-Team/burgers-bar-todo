import type { ThreadMessage } from '@burgers/shared'
import type { Turn } from './message-list.js'

// Map a persisted thread's messages to the local turn view the surface renders when a conversation
// is reopened from the drawer (#94). One wrinkle to iron out: a thread's opening question is stored
// twice. Creating a thread writes the first `user` turn (#90) and the answer path writes another
// `user` turn plus the reply (#91, ADR-0003), so the lazily-created first thread persists its opening
// question as two identical `user` rows before the first answer. A naive mirror would echo that
// question twice on reopen; collapsing the leading pair makes a switched-to conversation read the way
// the live surface did — each question once, each answer once.
//
// The signature is exact: two consecutive leading `user` turns with identical content only ever arise
// from create-then-answer, since every ordinary exchange alternates user→agent. A genuinely repeated
// question would be a fresh `user` turn following an `agent` reply, never two `user` rows back to
// back, so nothing a reader wrote is swallowed.
export function turnsFromMessages(messages: ThreadMessage[]): Turn[] {
  const [first, second] = messages
  const doubledOpening =
    first !== undefined &&
    second !== undefined &&
    first.role === 'user' &&
    second.role === 'user' &&
    first.content === second.content

  const ordered = doubledOpening ? messages.slice(1) : messages
  return ordered.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    // The persisted timestamp drives the conversation's day chips (The Counter, round 8) —
    // a reopened thread's turns group under Today / Yesterday / their date.
    createdAt: message.createdAt,
    // Carry the grounding docs through on reopen (#227) so a switched-to conversation shows the same
    // attribution chips the live surface did; a user turn (and a source-less answer) carries none.
    sources: message.sources,
  }))
}
