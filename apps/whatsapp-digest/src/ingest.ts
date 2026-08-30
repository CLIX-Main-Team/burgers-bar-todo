import type { GreenApiJournalMessage } from './green-api-client.js'
import type { DigestStore, StoredMessage } from './repository.js'
import { isSelectedGroup } from './transcript.js'

// The one seam where a WhatsApp message becomes a stored row (ADR-0026, amended). Every feeder goes
// through here — today the webhook the API forwards, tomorrow anything else — so that the rules
// about WHAT may be stored live in one place instead of being re-implemented, and forgotten, per
// caller.
//
// Three things this deliberately does NOT do:
//
// It does not swallow failures. The rest of the job treats a store error as a warning, which is
// right for a batch that has already paid for its model calls. It is catastrophic here: Green API
// keeps a notification queued until it gets a 200 and re-sends it every 60 seconds until then, so a
// swallowed write error becomes a 200, an immediate dequeue, and a message that no longer exists
// anywhere. Errors propagate; the caller answers non-200 and lets the gateway redeliver.
//
// It does not filter by time window. Which messages belong to a digest is the digest's decision,
// made against its injected clock. A row arriving at 23:59 must be stored, then judged later.
//
// It does not deduplicate. whatsapp_messages has id_message as its primary key and the insert is
// ON CONFLICT DO NOTHING, so a redelivered notification collapses in the database rather than in
// application code that would have to guess.

// The allowlist gate, applied HERE rather than at read time, and that placement is the point. The
// predicate used to live only on the transcript path, so a feeder writing straight to the store
// bypassed it entirely and persisted every group the linked account belongs to — the owner's work
// team, communities, news groups — permanently, rather than for the one day a digest looked at them.
// Storing is the irreversible step, so the gate belongs in front of it.
const selected = (chatId: string, allowedGroups: readonly string[]): boolean =>
  isSelectedGroup(chatId, allowedGroups)

// A journal/webhook message as a stored row. Both feeds are normalised to GreenApiJournalMessage
// before they reach here, so this mapping is written once.
export function toStoredMessage(message: GreenApiJournalMessage): StoredMessage {
  return {
    idMessage: message.idMessage,
    chatId: message.chatId,
    senderId: message.senderId ?? null,
    // The profile name, falling back to whatever the linked phone has saved for them. Collapsed at
    // write time because the transcript's own fallback reads the same order, and a row that kept
    // both would let the two drift apart.
    senderName: message.senderName ?? message.senderContactName ?? null,
    typeMessage: message.typeMessage,
    textMessage: message.textMessage ?? message.extendedTextMessage?.text ?? null,
    caption: message.caption ?? null,
    fileName: message.fileName ?? null,
    direction: message.direction,
    // Journal and webhook timestamps are both UNIX SECONDS; the column is timestamptz.
    sentAt: new Date(message.timestamp * 1000),
  }
}

// The inverse, so the digest can read its day out of Postgres and hand it to the transcript builder
// unchanged. Keeping the transcript's input type fixed is what lets every rule it owns — the window,
// the dedup, the media labels, the busiest-group-first ordering — keep working against stored rows
// with no second implementation.
export function storedToJournal(row: StoredMessage): GreenApiJournalMessage {
  return {
    idMessage: row.idMessage,
    chatId: row.chatId,
    timestamp: Math.floor(row.sentAt.getTime() / 1000),
    typeMessage: row.typeMessage,
    // The column is a plain string because the database has no union type; anything that is not
    // literally 'outgoing' is incoming, which keeps the linked account's own messages attributed to
    // "אנחנו" rather than to nobody.
    direction: row.direction === 'outgoing' ? 'outgoing' : 'incoming',
    ...(row.senderId === null ? {} : { senderId: row.senderId }),
    ...(row.senderName === null ? {} : { senderName: row.senderName }),
    ...(row.textMessage === null ? {} : { textMessage: row.textMessage }),
    ...(row.caption === null ? {} : { caption: row.caption }),
    ...(row.fileName === null ? {} : { fileName: row.fileName }),
  }
}

export interface IngestOutcome {
  // How many rows were eligible after the gate, and how many the database actually took. The
  // difference is redelivery collapsing on the primary key, which is expected rather than a fault.
  offered: number
  stored: number
}

export async function ingestMessages(
  store: DigestStore,
  messages: readonly GreenApiJournalMessage[],
  allowedGroups: readonly string[],
): Promise<IngestOutcome> {
  const eligible = messages.filter((message) => selected(message.chatId, allowedGroups))
  if (eligible.length === 0) {
    return { offered: 0, stored: 0 }
  }
  const stored = await store.saveMessages(eligible.map(toStoredMessage))
  return { offered: eligible.length, stored }
}

// The chat directory, behind the SAME gate as the messages. Chat names looked harmless enough to
// write unconditionally, but a name is content: an unfiltered directory records that the linked
// account is in a group called "X", and whatsapp_chats is never purged, so unlike a message that
// disclosure would be permanent. One gate, both feeds, no caller able to forget it.
export async function ingestChats(
  store: DigestStore,
  chats: readonly { chatId: string; name: string }[],
  allowedGroups: readonly string[],
): Promise<void> {
  const eligible = chats.filter((chat) => selected(chat.chatId, allowedGroups))
  if (eligible.length === 0) {
    return
  }
  await store.saveChats(eligible)
}
